import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiveAutoApplyEngineV2 } from '../src/runtime/liveAutoApplyEngineV2';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';

describe('LiveAutoApplyEngineV2 - Behavior Regression', () => {
  let store: StateStore;
  let mockAcquisitionService: any;
  let mockSleep: any;
  let mockLog: any;
  let engine: LiveAutoApplyEngineV2;

  beforeEach(async () => {
    store = new StateStore(new InMemoryStorageAdapter());
    await store.init();

    mockLog = vi.fn();
    mockSleep = vi.fn().mockResolvedValue(undefined);

    mockAcquisitionService = {
      acquireForProfile: vi.fn().mockResolvedValue({
        success: false,
        vacanciesAdded: 0,
        error: 'No vacancies',
      }),
    };

    engine = new LiveAutoApplyEngineV2({
      store,
      acquisitionService: mockAcquisitionService,
      sleep: mockSleep,
      log: mockLog,
    });
  });

  describe('failed controlled tab init → no acquisition attempt', () => {
    it('should not attempt acquisition when tab init fails', async () => {
      vi.mocked(chrome.tabs.create).mockRejectedValue(new Error('Tab creation failed'));

      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await engine.stop();
      await startPromise;

      // Behavior: acquisition never attempted when init fails
      expect(mockAcquisitionService.acquireForProfile).not.toHaveBeenCalled();
    });
  });

  describe('stop cleanup and running flag consistency', () => {
    it('should reach STOPPED state after stop()', async () => {
      vi.mocked(chrome.tabs.create).mockResolvedValue({
        id: 123,
        url: 'https://hh.ru/search/vacancy',
        status: 'complete',
      } as any);
      vi.mocked(chrome.tabs.update).mockResolvedValue({} as any);
      vi.mocked(chrome.scripting.executeScript).mockResolvedValue([{ result: 'complete' }] as any);

      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await engine.stop();
      await startPromise;

      const state = store.getState();
      // Behavior: engine actually stopped
      expect(state.runtimeState).toBe('STOPPED');
    });

    it('should not be running after stop() completes', async () => {
      vi.mocked(chrome.tabs.create).mockResolvedValue({
        id: 123,
        url: 'https://hh.ru/search/vacancy',
        status: 'complete',
      } as any);
      vi.mocked(chrome.tabs.update).mockResolvedValue({} as any);
      vi.mocked(chrome.scripting.executeScript).mockResolvedValue([{ result: 'complete' }] as any);

      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await engine.stop();
      await startPromise;

      // Behavior: isRunning reflects actual state
      expect(engine.isRunning()).toBe(false);
    });

    it('should reset counters when entering cycle', async () => {
      await store.incrementRuntimeCounters({ processed: 10, success: 5, manualActions: 2 });

      vi.mocked(chrome.tabs.create).mockResolvedValue({
        id: 123,
        url: 'https://hh.ru/search/vacancy',
        status: 'complete',
      } as any);
      vi.mocked(chrome.tabs.update).mockResolvedValue({} as any);
      vi.mocked(chrome.scripting.executeScript).mockResolvedValue([{ result: 'complete' }] as any);

      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await engine.stop();
      await startPromise;

      const state = store.getState();
      // Behavior: counters were actually reset
      expect(state.runtime.processed).toBe(0);
      expect(state.runtime.success).toBe(0);
      expect(state.runtime.manualActions).toBe(0);
    });

    it('should set phase to idle after stop', async () => {
      vi.mocked(chrome.tabs.create).mockResolvedValue({
        id: 123,
        url: 'https://hh.ru/search/vacancy',
        status: 'complete',
      } as any);
      vi.mocked(chrome.tabs.update).mockResolvedValue({} as any);
      vi.mocked(chrome.scripting.executeScript).mockResolvedValue([{ result: 'complete' }] as any);

      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await engine.stop();
      await startPromise;

      const state = store.getState();
      // Behavior: phase reset to idle
      expect(state.runtime.currentPhase).toBe('idle');
    });
  });
});
