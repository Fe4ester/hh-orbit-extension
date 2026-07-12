import { describe, expect, it, vi } from 'vitest';
import { createStoreReadyGate } from '../src/background/storeReadiness';

describe('createStoreReadyGate', () => {
  it('does not initialize the store until readiness is requested', () => {
    const initStore = vi.fn().mockResolvedValue(undefined);
    const ensureReady = createStoreReadyGate(initStore);

    expect(initStore).not.toHaveBeenCalled();
    expect(ensureReady).toBeTypeOf('function');
  });

  it('runs concurrent readiness calls through one init and one onReady callback', async () => {
    let resolveInit!: () => void;
    const initStore = vi.fn(() => new Promise<void>((resolve) => {
      resolveInit = resolve;
    }));
    const onReady = vi.fn();
    const ensureReady = createStoreReadyGate(initStore, onReady);

    const first = ensureReady();
    const second = ensureReady();

    expect(initStore).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();

    resolveInit();
    await Promise.all([first, second]);
    await ensureReady();

    expect(initStore).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('retries initialization after a failed attempt', async () => {
    const initStore = vi.fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined);
    const onReady = vi.fn();
    const ensureReady = createStoreReadyGate(initStore, onReady);

    await expect(ensureReady()).rejects.toThrow('storage unavailable');
    await expect(ensureReady()).resolves.toBeUndefined();

    expect(initStore).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('does not run onReady when initialization fails', async () => {
    const initStore = vi.fn().mockRejectedValue(new Error('storage unavailable'));
    const onReady = vi.fn();
    const ensureReady = createStoreReadyGate(initStore, onReady);

    await expect(ensureReady()).rejects.toThrow('storage unavailable');

    expect(onReady).not.toHaveBeenCalled();
  });
});
