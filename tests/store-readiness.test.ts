import { describe, expect, it, vi } from 'vitest';
import { createStoreReadyGate } from '../src/background/storeReadiness';

describe('createStoreReadyGate', () => {
  it('runs store init once and shares the same readiness promise', async () => {
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

    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
