// FileLogger batching/flush tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FileLogger as FileLoggerType, LogEntry } from '../src/utils/fileLogger';

interface FakeStorage {
  data: Record<string, unknown>;
  getDelayMs: number;
}

function installFakeStorage(): FakeStorage {
  const fake: FakeStorage = { data: {}, getDelayMs: 0 };

  (global as any).chrome = {
    ...(global as any).chrome,
    storage: {
      local: {
        get: (key: string) =>
          new Promise((resolve) => {
            const respond = () => resolve({ [key]: fake.data[key] });
            if (fake.getDelayMs > 0) {
              setTimeout(respond, fake.getDelayMs);
            } else {
              respond();
            }
          }),
        set: (items: Record<string, unknown>) => {
          Object.assign(fake.data, items);
          return Promise.resolve();
        },
      },
    },
  };

  return fake;
}

async function loadFileLogger(): Promise<typeof FileLoggerType> {
  const mod = await import('../src/utils/fileLogger');
  return mod.FileLogger;
}

describe('FileLogger', () => {
  let fake: FakeStorage;
  let FileLogger: typeof FileLoggerType;

  beforeEach(async () => {
    fake = installFakeStorage();
    // Fresh static state per test - FileLogger buffers in module-level fields.
    vi.resetModules();
    FileLogger = await loadFileLogger();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches multiple log calls into a single storage write', async () => {
    let setCalls = 0;
    const originalSet = (chrome.storage.local as any).set;
    (chrome.storage.local as any).set = (items: Record<string, unknown>) => {
      setCalls++;
      return originalSet(items);
    };

    await Promise.all([
      FileLogger.log('service_worker', 'info', 'one'),
      FileLogger.log('service_worker', 'info', 'two'),
      FileLogger.log('service_worker', 'info', 'three'),
    ]);
    await FileLogger.flush();

    const logs = fake.data['extension_logs'] as LogEntry[];
    expect(logs).toHaveLength(3);
    expect(setCalls).toBe(1);
  });

  it('flushes immediately once the batch size threshold is reached', async () => {
    const calls = Array.from({ length: 50 }, (_, i) =>
      FileLogger.log('service_worker', 'info', `entry-${i}`)
    );
    await Promise.all(calls);

    const logs = fake.data['extension_logs'] as LogEntry[];
    expect(logs).toHaveLength(50);
  });

  it('does not lose entries when log() is called concurrently under a slow storage read (race regression)', async () => {
    fake.getDelayMs = 5;

    const total = 120;
    const calls = Array.from({ length: total }, (_, i) =>
      FileLogger.log('service_worker', 'info', `entry-${i}`)
    );
    await Promise.all(calls);
    await FileLogger.flush();

    const logs = fake.data['extension_logs'] as LogEntry[];
    expect(logs).toHaveLength(total);
    const messages = new Set(logs.map((l) => l.message));
    expect(messages.size).toBe(total);
  });

  it('flushes sub-threshold entries automatically after the flush interval', async () => {
    vi.useFakeTimers();

    void FileLogger.log('service_worker', 'info', 'delayed');
    expect(fake.data['extension_logs']).toBeUndefined();

    await vi.advanceTimersByTimeAsync(2000);

    const logs = fake.data['extension_logs'] as LogEntry[];
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('delayed');
  });

  it('readLogs flushes pending sub-threshold entries before reading', async () => {
    await FileLogger.log('service_worker', 'info', 'buffered-1');
    await FileLogger.log('service_worker', 'info', 'buffered-2');

    // Nothing written yet - below BATCH_SIZE and timer hasn't fired.
    expect(fake.data['extension_logs']).toBeUndefined();

    const logs = await FileLogger.readLogs();
    expect(logs.map((l) => l.message)).toEqual(['buffered-1', 'buffered-2']);
  });

  it('rotates logs beyond MAX_LOGS, keeping the most recent entries', async () => {
    const existing: LogEntry[] = Array.from({ length: 1990 }, (_, i) => ({
      timestamp: new Date(0).toISOString(),
      source: 'service_worker',
      level: 'info',
      message: `old-${i}`,
    }));
    fake.data['extension_logs'] = existing;

    const calls = Array.from({ length: 50 }, (_, i) =>
      FileLogger.log('service_worker', 'info', `new-${i}`)
    );
    await Promise.all(calls);
    await FileLogger.flush();

    const logs = fake.data['extension_logs'] as LogEntry[];
    expect(logs).toHaveLength(2000);
    expect(logs[0].message).toBe('old-40');
    expect(logs[logs.length - 1].message).toBe('new-49');
  });
});
