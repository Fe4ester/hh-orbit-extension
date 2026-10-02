import { describe, expect, it, vi } from 'vitest';
import { runSearchLoop, scanCurrentSearchPage } from '../src/background/searchLoop';
import { INITIAL_STATE } from '../src/state/types';

describe('search loop runtime operations', () => {
  it('scans through existing acquisition and records materialized counts', async () => {
    const acquireForProfile = vi.fn().mockResolvedValue({
      success: true,
      currentUrl: 'https://hh.ru/search/vacancy?page=0',
      pageType: 'search',
      cardsFound: 12,
      newQueued: 4,
      queueSizeAfter: 7,
    });
    const recordVacancyScan = vi.fn().mockResolvedValue(undefined);

    const result = await scanCurrentSearchPage({
      getState: () => ({ ...INITIAL_STATE, activeProfileId: 'profile-1' }),
      acquireForProfile,
      recordVacancyScan,
    });

    expect(acquireForProfile).toHaveBeenCalledWith('profile-1', true);
    expect(recordVacancyScan).toHaveBeenCalledWith(12, 4);
    expect(result).toEqual({
      success: true,
      foundCount: 12,
      newCount: 4,
      queueSizeAfter: 7,
      currentUrl: 'https://hh.ru/search/vacancy?page=0',
    });
  });

  it('calls scan and next page directly without runtime messaging', async () => {
    const runtimeSendMessage = vi.fn(() => {
      throw new Error('runtime messaging must not be used');
    });
    const previousSendMessage = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = runtimeSendMessage as typeof chrome.runtime.sendMessage;

    const state = {
      ...INITIAL_STATE,
      activeProfileId: 'profile-1',
      runtimeBlocker: null,
      vacancyScan: { ...INITIAL_STATE.vacancyScan, exhausted: false },
      liveMode: {
        ...INITIAL_STATE.liveMode,
        controlledTabId: 10,
        pageType: 'search' as const,
      },
    };
    const scan = vi.fn().mockResolvedValue({ success: true, foundCount: 5, newCount: 2, queueSizeAfter: 2, currentUrl: 'https://hh.ru/search/vacancy?page=0' });
    const next = vi.fn().mockResolvedValue({ success: true, nextUrl: 'https://hh.ru/search/vacancy?page=1' });

    try {
      const result = await runSearchLoop({
        getState: () => state,
        startSearchLoop: vi.fn().mockResolvedValue(undefined),
        stopSearchLoop: vi.fn().mockResolvedValue(undefined),
        incrementSearchLoopIteration: vi.fn().mockResolvedValue(undefined),
        markNoMoreVacancies: vi.fn().mockResolvedValue(undefined),
        broadcastState: vi.fn(),
        scanCurrentPage: scan,
        getHasNextPage: vi.fn().mockResolvedValue({ success: true, hasNext: true }),
        nextSearchPage: next,
      });

      expect(result).toEqual(expect.objectContaining({ success: true, stopped: false }));
      expect(scan).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
      expect(runtimeSendMessage).not.toHaveBeenCalled();
    } finally {
      chrome.runtime.sendMessage = previousSendMessage;
    }
  });

  it('returns a scan error without dereferencing an undefined response', async () => {
    const stopSearchLoop = vi.fn().mockResolvedValue(undefined);
    const state = {
      ...INITIAL_STATE,
      activeProfileId: 'profile-1',
      runtimeBlocker: null,
      liveMode: {
        ...INITIAL_STATE.liveMode,
        controlledTabId: 10,
        pageType: 'search' as const,
      },
    };

    const result = await runSearchLoop({
      getState: () => state,
      startSearchLoop: vi.fn().mockResolvedValue(undefined),
      stopSearchLoop,
      incrementSearchLoopIteration: vi.fn().mockResolvedValue(undefined),
      markNoMoreVacancies: vi.fn().mockResolvedValue(undefined),
      broadcastState: vi.fn(),
      scanCurrentPage: vi.fn().mockResolvedValue({ success: false, error: 'scan failed' }),
      getHasNextPage: vi.fn(),
      nextSearchPage: vi.fn(),
    });

    expect(result).toEqual({ success: false, error: 'scan failed' });
    expect(stopSearchLoop).toHaveBeenCalledTimes(1);
  });

  it('returns a next-page error without dereferencing an undefined response', async () => {
    const stopSearchLoop = vi.fn().mockResolvedValue(undefined);
    const state = {
      ...INITIAL_STATE,
      activeProfileId: 'profile-1',
      runtimeBlocker: null,
      liveMode: {
        ...INITIAL_STATE.liveMode,
        controlledTabId: 10,
        pageType: 'search' as const,
      },
    };

    const result = await runSearchLoop({
      getState: () => state,
      startSearchLoop: vi.fn().mockResolvedValue(undefined),
      stopSearchLoop,
      incrementSearchLoopIteration: vi.fn().mockResolvedValue(undefined),
      markNoMoreVacancies: vi.fn().mockResolvedValue(undefined),
      broadcastState: vi.fn(),
      scanCurrentPage: vi.fn().mockResolvedValue({ success: true, foundCount: 1, newCount: 1, queueSizeAfter: 1, currentUrl: 'https://hh.ru/search/vacancy?page=0' }),
      getHasNextPage: vi.fn().mockResolvedValue({ success: true, hasNext: true }),
      nextSearchPage: vi.fn().mockResolvedValue({ success: false, error: 'navigation failed' }),
    });

    expect(result).toEqual({ success: false, error: 'navigation failed' });
    expect(stopSearchLoop).toHaveBeenCalledTimes(1);
  });
});
