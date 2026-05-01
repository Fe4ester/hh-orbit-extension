import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackendAutoApplyEngine } from '../src/runtime/backendAutoApplyEngine';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';

describe('BackendAutoApplyEngine - Behavior Regression', () => {
  let store: StateStore;
  let mockHttpClient: any;
  let mockSleep: any;
  let mockLog: any;
  let engine: BackendAutoApplyEngine;

  beforeEach(async () => {
    store = new StateStore(new InMemoryStorageAdapter());
    await store.init();

    mockLog = vi.fn();
    mockSleep = vi.fn().mockResolvedValue(undefined);

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

  describe('normal start enters cycle', () => {
    it('should enter cycle and call checkAuth when started', async () => {
      mockHttpClient.checkAuth.mockResolvedValue({ authorized: false });

      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await engine.stop();
      await startPromise;

      // Behavior: engine actually entered cycle and attempted auth check
      expect(mockHttpClient.checkAuth).toHaveBeenCalled();
    });

    it('should reset counters when entering cycle', async () => {
      await store.incrementRuntimeCounters({ processed: 10, success: 5, manualActions: 2 });

      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

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
      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      await engine.stop();
      await startPromise;

      const state = store.getState();
      // Behavior: engine actually stopped
      expect(state.runtimeState).toBe('STOPPED');
    });

    it('should not be running after stop() completes', async () => {
      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      await engine.stop();
      await startPromise;

      // Behavior: isRunning reflects actual state
      expect(engine.isRunning()).toBe(false);
    });
  });

  describe('no auth → blocked/paused behavior', () => {
    it('should pause with auth phase when not authorized', async () => {
      mockHttpClient.checkAuth.mockResolvedValue({ authorized: false });

      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await engine.stop();
      await startPromise;

      const state = store.getState();
      // Behavior: engine actually paused due to auth failure
      expect(state.runtime.currentPhase).toBe('paused_auth');
    });

    it('should not proceed to vacancy acquisition when not authorized', async () => {
      mockHttpClient.checkAuth.mockResolvedValue({ authorized: false });

      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

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

      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 150));

      await engine.stop();
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

      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 150));

      await engine.stop();
      await startPromise;

      const state = store.getState();
      // Behavior: resume was actually auto-selected
      expect(state.selectedResumeHash).toBe('auto-selected');
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

      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 150));

      await engine.stop();
      await startPromise;

      const state = store.getState();
      // Behavior: engine paused due to no vacancies
      expect(state.runtime.currentPhase).toBe('paused_no_vacancies');
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

      const startPromise = engine.start();
      await new Promise((resolve) => setTimeout(resolve, 150));

      await engine.stop();
      await startPromise;

      // Behavior: engine attempted to acquire vacancies
      expect(mockHttpClient.fetchVacancies).toHaveBeenCalled();
    });
  });
});
