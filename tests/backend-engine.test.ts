import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackendAutoApplyEngine } from '../src/runtime/backendAutoApplyEngine';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';

describe('BackendAutoApplyEngine - Behavior Regression', () => {
  let store: StateStore;
  let mockHttpClient: any;
  let mockSleep: any;
  let mockLog: any;
  let engine: BackendAutoApplyEngine;
  let sleepResolvers: Array<() => void>;
  let startPromise: Promise<void> | null;

  const waitFor = async (condition: () => boolean, timeoutMs = 1000): Promise<void> => {
    const startedAt = Date.now();

    while (!condition()) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('Timed out waiting for condition');
      }

      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  const releaseAllSleeps = (): void => {
    const resolvers = sleepResolvers.splice(0);
    resolvers.forEach((resolve) => resolve());
  };

  const releaseNextSleep = async (): Promise<void> => {
    await waitFor(() => sleepResolvers.length > 0);
    sleepResolvers.shift()!();
  };

  beforeEach(async () => {
    store = new StateStore(new InMemoryStorageAdapter());
    await store.init();

    mockLog = vi.fn();
    sleepResolvers = [];
    startPromise = null;
    mockSleep = vi.fn(() => new Promise<void>((resolve) => {
      sleepResolvers.push(resolve);
    }));

    mockHttpClient = {
      checkAuth: vi.fn().mockResolvedValue({ authorized: false }),
      getMyResumes: vi.fn().mockResolvedValue([]),
      fetchVacancies: vi.fn().mockResolvedValue([]),
      preflightApply: vi.fn().mockResolvedValue({
        canProceed: false,
        alreadyApplied: false,
        requiresTest: false,
        requiresQuestionnaire: false,
      }),
      applyToVacancy: vi.fn().mockResolvedValue({
        success: false,
        outcome: 'error',
      }),
    };

    engine = new BackendAutoApplyEngine({
      store,
      httpClient: mockHttpClient,
      sleep: mockSleep,
      log: mockLog,
    });
  });

  afterEach(async () => {
    if (engine?.isRunning()) {
      await engine.stop();
    }

    releaseAllSleeps();

    if (startPromise) {
      await startPromise;
    }
  });

  describe('normal start enters cycle', () => {
    it('should enter cycle and call checkAuth when started', async () => {
      mockHttpClient.checkAuth.mockResolvedValue({ authorized: false });

      startPromise = engine.start();
      await waitFor(() => mockHttpClient.checkAuth.mock.calls.length > 0);

      await engine.stop();
      await startPromise;

      // Behavior: engine actually entered cycle and attempted auth check
      expect(mockHttpClient.checkAuth).toHaveBeenCalled();
    });

    it('should reset counters when entering cycle', async () => {
      await store.incrementRuntimeCounters({ processed: 10, success: 5, manualActions: 2 });

      startPromise = engine.start();
      await waitFor(() => store.getState().runtime.processed === 0);

      await engine.stop();
      await startPromise;

      const state = store.getState();
      // Behavior: counters were actually reset
      expect(state.runtime.processed).toBe(0);
      expect(state.runtime.success).toBe(0);
      expect(state.runtime.manualActions).toBe(0);
    });
  });

  describe('stop leads to consistent termination', () => {
    it('should reach STOPPED state after stop()', async () => {
      startPromise = engine.start();
      await waitFor(() => engine.isRunning() || store.getState().runtimeState !== 'IDLE');

      await engine.stop();
      await startPromise;

      const state = store.getState();
      // Behavior: engine actually stopped
      expect(state.runtimeState).toBe('STOPPED');
    });

    it('should not be running after stop() completes', async () => {
      startPromise = engine.start();
      await waitFor(() => engine.isRunning() || store.getState().runtimeState !== 'IDLE');

      await engine.stop();
      await startPromise;

      // Behavior: isRunning reflects actual state
      expect(engine.isRunning()).toBe(false);
    });
  });

  describe('no auth → blocked/paused behavior', () => {
    it('should pause with auth phase when not authorized', async () => {
      mockHttpClient.checkAuth.mockResolvedValue({ authorized: false });

      startPromise = engine.start();
      await waitFor(() => store.getState().runtime.currentPhase === 'paused_auth');

      await engine.stop();
      await startPromise;

      const state = store.getState();
      // Behavior: engine actually paused due to auth failure
      expect(state.runtime.currentPhase).toBe('paused_auth');
    });

    it('should not proceed to vacancy acquisition when not authorized', async () => {
      mockHttpClient.checkAuth.mockResolvedValue({ authorized: false });

      startPromise = engine.start();
      await waitFor(() => mockHttpClient.checkAuth.mock.calls.length > 0);

      await engine.stop();
      await startPromise;

      // Behavior: engine stopped at auth check, never tried to fetch vacancies
      expect(mockHttpClient.fetchVacancies).not.toHaveBeenCalled();
    });
  });

  describe('no resume / stale resume / auto-recovery semantics', () => {
    it('should call getMyResumes when no resume selected', async () => {
      mockHttpClient.checkAuth.mockResolvedValue({ authorized: true });
      mockHttpClient.getMyResumes.mockResolvedValue([
        { hash: 'recovered', title: 'Recovered Resume', isActive: true },
      ]);
      mockHttpClient.fetchVacancies.mockResolvedValue([]);

      await store.updateState({
        selectedResumeHash: null,
        resumeCandidates: [],
        activeProfileId: 'prof1',
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test Profile',
            keywordsInclude: ['test'],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        settings: { maxAutoAppliesPerRun: 1, delayMinSeconds: 1, delayMaxSeconds: 2 },
      });

      startPromise = engine.start();
      await waitFor(() => mockHttpClient.getMyResumes.mock.calls.length > 0);

      await engine.stop();
      releaseAllSleeps();
      await startPromise;

      // Behavior: engine attempted auto-recovery
      expect(mockHttpClient.getMyResumes).toHaveBeenCalled();
    });

    it('should auto-select first resume after recovery', async () => {
      mockHttpClient.checkAuth.mockResolvedValue({ authorized: true });
      mockHttpClient.getMyResumes.mockResolvedValue([
        { hash: 'auto-selected', title: 'Auto Selected', isActive: true },
      ]);
      mockHttpClient.fetchVacancies.mockResolvedValue([]);

      await store.updateState({
        selectedResumeHash: null,
        resumeCandidates: [],
        activeProfileId: 'prof1',
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test Profile',
            keywordsInclude: ['test'],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        settings: { maxAutoAppliesPerRun: 1, delayMinSeconds: 1, delayMaxSeconds: 2 },
      });

      startPromise = engine.start();
      await waitFor(() => store.getState().selectedResumeHash === 'auto-selected');

      await engine.stop();
      releaseAllSleeps();
      await startPromise;

      const state = store.getState();
      // Behavior: resume was actually auto-selected
      expect(state.selectedResumeHash).toBe('auto-selected');
    });
  });

  describe('prefilter elimination behavior', () => {
    it('should NOT terminate when all vacancies filtered by prefilter - should retry', async () => {
      mockHttpClient.checkAuth.mockResolvedValue({ authorized: true });
      mockHttpClient.getMyResumes.mockResolvedValue([
        { hash: 'test', title: 'Test', isActive: true },
      ]);

      // API returns vacancies, but prefilter will eliminate all
      mockHttpClient.fetchVacancies.mockResolvedValue([
        {
          id: '12345',
          name: 'Junior Python Developer',
          employer: { name: 'Test Company' },
          alternate_url: 'https://hh.ru/vacancy/12345',
        },
      ]);

      await store.updateState({
        selectedResumeHash: 'test',
        resumeCandidates: [
          { hash: 'test', title: 'Test', isActive: true, source: 'hh_detected', lastSeenAt: Date.now() },
        ],
        activeProfileId: 'prof1',
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test Profile',
            keywordsInclude: ['senior'], // Will filter out "Junior Python Developer"
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        vacancyQueue: [],
        settings: { maxAutoAppliesPerRun: 0, delayMinSeconds: 1, delayMaxSeconds: 2 }, // 0 = unlimited
      });

      startPromise = engine.start();
      await waitFor(() => mockHttpClient.fetchVacancies.mock.calls.length === 1 && sleepResolvers.length === 1);

      const stateAfterFirstCycle = store.getState();

      // Behavior: engine should be in 'waiting' phase, NOT terminated
      expect(stateAfterFirstCycle.runtime.currentPhase).toBe('waiting');
      expect(engine.isRunning()).toBe(true);

      // Behavior: fetchVacancies was called (acquisition attempted)
      expect(mockHttpClient.fetchVacancies).toHaveBeenCalled();

      // Behavior: queue is empty because prefilter eliminated all
      expect(stateAfterFirstCycle.vacancyQueue.length).toBe(0);

      await engine.stop();
      releaseAllSleeps();
      await startPromise;

      const finalState = store.getState();

      // Behavior: engine stopped gracefully, not due to terminal error
      expect(finalState.runtimeState).toBe('STOPPED');
    });

    it('should continue retry loop after prefilter elimination', async () => {
      mockHttpClient.checkAuth.mockResolvedValue({ authorized: true });
      mockHttpClient.getMyResumes.mockResolvedValue([
        { hash: 'test', title: 'Test', isActive: true },
      ]);

      // First call: vacancies filtered out
      // Second call: vacancies pass filter
      let callCount = 0;
      mockHttpClient.fetchVacancies.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return [
            {
              id: '11111',
              name: 'Junior Developer',
              employer: { name: 'Company A' },
              alternate_url: 'https://hh.ru/vacancy/11111',
            },
          ];
        } else {
          return [
            {
              id: '22222',
              name: 'Senior Python Developer',
              employer: { name: 'Company B' },
              alternate_url: 'https://hh.ru/vacancy/22222',
            },
          ];
        }
      });

      await store.updateState({
        selectedResumeHash: 'test',
        resumeCandidates: [
          { hash: 'test', title: 'Test', isActive: true, source: 'hh_detected', lastSeenAt: Date.now() },
        ],
        activeProfileId: 'prof1',
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test Profile',
            keywordsInclude: ['senior', 'python'],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        vacancyQueue: [],
        settings: { maxAutoAppliesPerRun: 1, delayMinSeconds: 1, delayMaxSeconds: 2 },
      });

      startPromise = engine.start();
      await waitFor(() => mockHttpClient.fetchVacancies.mock.calls.length === 1 && sleepResolvers.length === 1);
      await releaseNextSleep();
      await waitFor(() => mockHttpClient.fetchVacancies.mock.calls.length === 2);

      await engine.stop();
      releaseAllSleeps();
      await startPromise;

      // Behavior: fetchVacancies was called multiple times (retry happened)
      expect(mockHttpClient.fetchVacancies).toHaveBeenCalledTimes(2);
    });
  });

  describe('no vacancies / queue empty outcomes', () => {
    it('should pause when no vacancies found', async () => {
      mockHttpClient.checkAuth.mockResolvedValue({ authorized: true });
      mockHttpClient.getMyResumes.mockResolvedValue([
        { hash: 'test', title: 'Test', isActive: true },
      ]);
      mockHttpClient.fetchVacancies.mockResolvedValue([]);

      await store.updateState({
        selectedResumeHash: 'test',
        resumeCandidates: [
          { hash: 'test', title: 'Test', isActive: true, source: 'hh_detected', lastSeenAt: Date.now() },
        ],
        activeProfileId: 'prof1',
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test Profile',
            keywordsInclude: ['test'],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        vacancyQueue: [],
        settings: { maxAutoAppliesPerRun: 1, delayMinSeconds: 1, delayMaxSeconds: 2 },
      });

      startPromise = engine.start();
      await waitFor(() => mockHttpClient.fetchVacancies.mock.calls.length === 1 && sleepResolvers.length === 1);
      await releaseNextSleep();
      await waitFor(() => mockHttpClient.fetchVacancies.mock.calls.length === 2 && sleepResolvers.length === 1);
      await releaseNextSleep();
      await waitFor(() => mockHttpClient.fetchVacancies.mock.calls.length === 3);

      await engine.stop();
      releaseAllSleeps();
      await startPromise;

      const state = store.getState();
      expect(state.runtime.currentPhase).toBe('exhausted');
    });

    it('should call fetchVacancies when queue is empty', async () => {
      mockHttpClient.checkAuth.mockResolvedValue({ authorized: true });
      mockHttpClient.getMyResumes.mockResolvedValue([
        { hash: 'test', title: 'Test', isActive: true },
      ]);
      mockHttpClient.fetchVacancies.mockResolvedValue([]);

      await store.updateState({
        selectedResumeHash: 'test',
        resumeCandidates: [
          { hash: 'test', title: 'Test', isActive: true, source: 'hh_detected', lastSeenAt: Date.now() },
        ],
        activeProfileId: 'prof1',
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test Profile',
            keywordsInclude: ['test'],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        vacancyQueue: [],
        settings: { maxAutoAppliesPerRun: 1, delayMinSeconds: 1, delayMaxSeconds: 2 },
      });

      startPromise = engine.start();
      await waitFor(() => mockHttpClient.fetchVacancies.mock.calls.length > 0);

      await engine.stop();
      releaseAllSleeps();
      await startPromise;

      // Behavior: engine attempted to acquire vacancies
      expect(mockHttpClient.fetchVacancies).toHaveBeenCalled();
    });
  });
});
