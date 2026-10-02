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

  describe('run apply limit', () => {
    const configureLimitGateState = async (processed: number, success: number) => {
      const state = store.getState();
      await store.updateState({
        selectedResumeHash: 'resume-1',
        resumeCandidates: [{ hash: 'resume-1', title: 'Resume', isActive: true, source: 'hh_detected', lastSeenAt: Date.now() }],
        activeProfileId: 'profile-1',
        profiles: {
          'profile-1': {
            id: 'profile-1', name: 'Profile', keywordsInclude: [], keywordsExclude: [],
            locations: [], experience: [], schedule: [], employment: [],
          },
        },
        liveMode: { ...state.liveMode, controlledTabId: 321, controlledWindowId: 1 },
        settings: { maxAutoAppliesPerRun: 1 },
        runtime: { ...state.runtime, processed, success },
      });
      vi.spyOn(store, 'resetRuntimeCounters').mockResolvedValue(undefined);
      vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 321, url: 'https://hh.ru/search/vacancy' } as chrome.tabs.Tab);
    };

    it('continues to acquisition when only processed has reached the run limit', async () => {
      await configureLimitGateState(1, 0);
      mockAcquisitionService.acquireForProfile.mockResolvedValue({ success: false, newQueued: 0 });

      await engine.start();

      expect(mockAcquisitionService.acquireForProfile).toHaveBeenCalledWith('profile-1', true);
      expect(store.getState().runtime).toMatchObject({ processed: 1, success: 0 });
    });

    it('stops before acquisition when successful applies have reached the run limit', async () => {
      await configureLimitGateState(1, 1);

      await engine.start();

      expect(mockAcquisitionService.acquireForProfile).not.toHaveBeenCalled();
      expect(store.getState().runtime).toMatchObject({ processed: 1, success: 1 });
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

  describe('questionnaire capture hook', () => {
    it('captures a rendered questionnaire before leaving the response page', async () => {
      const onQuestionnaireDetected = vi.fn().mockResolvedValue(undefined);
      engine = new LiveAutoApplyEngineV2({
        store,
        acquisitionService: mockAcquisitionService,
        sleep: mockSleep,
        log: mockLog,
        onQuestionnaireDetected,
      });
      vi.mocked(chrome.tabs.sendMessage).mockResolvedValue({ testRequired: true });

      const context = {
        vacancy: {
          vacancyId: '42',
          title: 'Developer',
          company: 'Example',
          url: 'https://hh.ru/vacancy/42',
          source: 'search_dom',
          discoveredAt: 1,
          profileId: 'profile-1',
          status: 'discovered',
        },
        state: 'handling_redirect',
        attempt: 1,
        maxAttempts: 1,
        errors: [],
        metadata: {
          startTime: 1,
          clickAttempts: 1,
          modalDetected: false,
          redirectDetected: true,
          redirectUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=42',
        },
      };

      const result = await (engine as any).handleRedirect(context, 321);

      expect(onQuestionnaireDetected).toHaveBeenCalledWith(321, '42');
      expect(result.outcome).toBe('test');
      expect(chrome.tabs.update).not.toHaveBeenCalled();
    });
  });

  describe('manual-action persistence', () => {
    it('marks a manual-action vacancy processed before pausing', async () => {
      const state = store.getState();
      await store.updateState({
        selectedResumeHash: 'resume-1',
        activeProfileId: 'profile-1',
        profiles: {
          'profile-1': {
            id: 'profile-1', name: 'Profile', keywordsInclude: [], keywordsExclude: [],
            locations: [], experience: [], schedule: [], employment: [],
          },
        },
        liveMode: { ...state.liveMode, controlledTabId: 321, controlledWindowId: 1 },
        runtimeState: 'RUNNING',
        runtime: { ...state.runtime, currentPhase: 'apply' },
        vacancyQueue: [{
          vacancyId: 'vacancy-1', title: 'Test vacancy', company: 'Test company',
          url: 'https://hh.ru/vacancy/vacancy-1', source: 'search_dom',
          discoveredAt: Date.now(), profileId: 'profile-1', status: 'discovered',
        }],
      });
      vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 321, url: 'https://hh.ru/search/vacancy' } as chrome.tabs.Tab);
      vi.spyOn(engine as any, 'processSingleVacancy').mockResolvedValue({
        success: true,
        outcome: 'manual_action',
        reason: 'test_required',
        context: { state: 'manual_action', metadata: {}, errors: [] },
      });

      await expect((engine as any).runCycle()).resolves.toBe('blocked');

      expect(store.getState().vacancyQueue[0].status).toBe('processed');
      expect(store.getState().runtime.currentPhase).toBe('paused_manual_action');
    });
  });
});
