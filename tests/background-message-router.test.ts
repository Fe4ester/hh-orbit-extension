import { describe, expect, it, vi } from 'vitest';
import { createBackgroundMessageListener } from '../src/background/messageRouter';

function createHarness() {
  const ensureStoreReady = vi.fn().mockResolvedValue(undefined);
  const isCoreMessage = vi.fn((message: unknown) =>
    Boolean(message && typeof message === 'object' && 'type' in message && message.type === 'CORE')
  );
  const coreHandler = vi.fn().mockReturnValue(false);
  const handlers = {
    startAutoApply: vi.fn().mockResolvedValue({ success: true, runtimeState: 'RUNNING' }),
    checkRuntimeBlockers: vi.fn().mockResolvedValue(undefined),
    clearRuntimeBlocker: vi.fn().mockResolvedValue({ success: true }),
    nextSearchPage: vi.fn().mockResolvedValue({ success: true, nextUrl: 'https://hh.ru/search?page=2' }),
    runSearchLoop: vi.fn().mockResolvedValue({ success: true, stopped: false }),
  };
  const listener = createBackgroundMessageListener({
    ensureStoreReady,
    isCoreMessage,
    coreHandler,
    handlers,
    onDetachedError: vi.fn(),
  });

  return { ensureStoreReady, isCoreMessage, coreHandler, handlers, listener };
}

describe('background message router', () => {
  it('returns false for unknown messages without initializing readiness', () => {
    const { listener, ensureStoreReady, coreHandler } = createHarness();
    const sendResponse = vi.fn();

    expect(listener({ type: 'UNKNOWN' }, {}, sendResponse)).toBe(false);
    expect(coreHandler).not.toHaveBeenCalled();
    expect(ensureStoreReady).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it.each([
    ['AUTO_APPLY_START', 'startAutoApply'],
    ['CLEAR_RUNTIME_BLOCKER', 'clearRuntimeBlocker'],
    ['LIVE_MODE_NEXT_SEARCH_PAGE', 'nextSearchPage'],
    ['LIVE_MODE_RUN_SEARCH_LOOP', 'runSearchLoop'],
  ] as const)('gives %s one owner and one response', async (type, handlerName) => {
    const { listener, ensureStoreReady, coreHandler, handlers } = createHarness();
    const sendResponse = vi.fn();

    expect(listener({ type }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));

    expect(ensureStoreReady).toHaveBeenCalledTimes(1);
    expect(handlers[handlerName]).toHaveBeenCalledTimes(1);
    expect(coreHandler).not.toHaveBeenCalled();
  });

  it('acknowledges CHECK_RUNTIME_BLOCKERS once and runs its side effect once', async () => {
    const { listener, ensureStoreReady, coreHandler, handlers } = createHarness();
    const sendResponse = vi.fn();

    expect(listener({ type: 'CHECK_RUNTIME_BLOCKERS' }, {}, sendResponse)).toBe(false);
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
    await vi.waitFor(() => expect(handlers.checkRuntimeBlockers).toHaveBeenCalledTimes(1));

    expect(ensureStoreReady).toHaveBeenCalledTimes(1);
    expect(coreHandler).not.toHaveBeenCalled();
  });

  it('normalizes a CLEAR_RUNTIME_BLOCKER rejection into one error response', async () => {
    const { listener, handlers } = createHarness();
    handlers.clearRuntimeBlocker.mockRejectedValue(new Error('storage unavailable'));
    const sendResponse = vi.fn();

    expect(listener({ type: 'CLEAR_RUNTIME_BLOCKER' }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'storage unavailable',
    });
  });
});
