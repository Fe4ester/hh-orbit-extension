/**
 * File Logger
 *
 * Persistent logging to chrome.storage.local
 * Logs are available across sessions and can be exported
 */

export interface LogEntry {
  timestamp: string; // ISO 8601
  source: 'service_worker' | 'content_script' | 'sidepanel' | 'popup' | 'parser';
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, any>;
  screenshot?: string; // base64 data URL
}

const STORAGE_KEY = 'extension_logs';
const MAX_LOGS = 2000; // Rotate after 2k entries
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 2000;

export class FileLogger {
  private static pending: LogEntry[] = [];
  private static flushTimer: ReturnType<typeof setTimeout> | null = null;
  // Chains flushes so concurrent callers can't interleave a
  // storage.get/set read-modify-write and clobber each other's entries.
  private static flushChain: Promise<void> = Promise.resolve();

  static async log(
    source: LogEntry['source'],
    level: LogEntry['level'],
    message: string,
    context?: Record<string, any>,
    screenshot?: string
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      source,
      level,
      message,
      context,
      screenshot,
    };

    this.pending.push(entry);

    if (this.pending.length >= BATCH_SIZE) {
      await this.flush();
      return;
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        void this.flush();
      }, FLUSH_INTERVAL_MS);
    }
  }

  static flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.flushChain = this.flushChain.then(() => this.flushPending());
    return this.flushChain;
  }

  private static async flushPending(): Promise<void> {
    if (this.pending.length === 0) return;

    const batch = this.pending;
    this.pending = [];

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const logs: LogEntry[] = result[STORAGE_KEY] || [];

      logs.push(...batch);

      // Rotation: keep only last MAX_LOGS
      if (logs.length > MAX_LOGS) {
        logs.splice(0, logs.length - MAX_LOGS);
      }

      await chrome.storage.local.set({ [STORAGE_KEY]: logs });
    } catch (err) {
      console.error('[FileLogger] Failed to write log:', err);
    }
  }

  /**
   * Capture screenshot of active tab
   * DISABLED: Causes quota errors and slows down processing
   */
  static async captureScreenshot(): Promise<string | undefined> {
    // Скриншоты отключены из-за ошибок квоты Chrome API
    return undefined;
  }

  static async readLogs(limit?: number): Promise<LogEntry[]> {
    await this.flush();

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const logs: LogEntry[] = result[STORAGE_KEY] || [];

      if (limit) {
        return logs.slice(-limit);
      }

      return logs;
    } catch (err) {
      console.error('[FileLogger] Failed to read logs:', err);
      return [];
    }
  }
}
