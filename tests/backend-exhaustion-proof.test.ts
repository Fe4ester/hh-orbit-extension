import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackendAutoApplyEngine } from '../src/runtime/backendAutoApplyEngine';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';

describe('Backend Exhaustion Policy - Runtime Proof', () => {
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

  const driveUntil = async (condition: () => boolean, maxReleases = 10): Promise<void> => {
    for (let i = 0; i < maxReleases; i++) {
      if (condition()) {
        return;
      }

      await releaseNextSleep();
      await waitFor(() => condition() || sleepResolvers.length > 0);
    }

    if (!condition()) {
      throw new Error('Condition not reached after releasing controlled sleeps');
    }
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
      checkAuth: vi.fn().mockResolvedValue({ authorized: true }),
      getMyResumes: vi.fn().mockResolvedValue([
        { hash: 'test-resume', title: 'Test Resume', isActive: true },
      ]),
      fetchVacancies: vi.fn(),
      preflightApply: vi.fn(),
      applyToVacancy: vi.fn(),
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

  it('PROOF: backend advances through pages when API returns 0', async () => {
    // Setup: API returns 0 vacancies on all pages
    mockHttpClient.fetchVacancies.mockResolvedValue([]);

    await store.updateState({
      selectedResumeHash: 'test-resume',
      resumeCandidates: [
        {
          hash: 'test-resume',
          title: 'Test Resume',
          isActive: true,
          source: 'hh_detected',
          lastSeenAt: Date.now(),
        },
      ],
      activeProfileId: 'prof1',
      profiles: {
        prof1: {
          id: 'prof1',
          name: 'Test Profile',
          keywordsInclude: ['python'],
          keywordsExclude: [],
          locations: [],
          experience: [],
          schedule: [],
          employment: [],
        },
      },
      vacancyQueue: [],
      settings: {
        maxAutoAppliesPerRun: 0,
        delayMinSeconds: 1,
        delayMaxSeconds: 2,
        stopOnManualAction: false,
      },
    });

    startPromise = engine.start();
    await waitFor(() => mockHttpClient.fetchVacancies.mock.calls.length === 1 && sleepResolvers.length === 1);
    await releaseNextSleep();
    await waitFor(() => mockHttpClient.fetchVacancies.mock.calls.length === 2 && sleepResolvers.length === 1);
    await releaseNextSleep();
    await waitFor(() => mockHttpClient.fetchVacancies.mock.calls.length === 3);

    // PROOF: fetchVacancies called multiple times with different pages
    expect(mockHttpClient.fetchVacancies).toHaveBeenCalledTimes(3);
    expect(mockHttpClient.fetchVacancies).toHaveBeenNthCalledWith(1, expect.anything(), 0);
    expect(mockHttpClient.fetchVacancies).toHaveBeenNthCalledWith(2, expect.anything(), 1);
    expect(mockHttpClient.fetchVacancies).toHaveBeenNthCalledWith(3, expect.anything(), 2);

    const state = store.getState();

    // PROOF: Engine reached exhausted state after 3 empty pages
    expect(state.runtime.currentPhase).toBe('exhausted');
    expect(state.runtime.consecutiveEmptyPages).toBe(3);

    await engine.stop();
    releaseAllSleeps();
    await startPromise;
  });

  it('PROOF: backend continues through pages when prefilter eliminates all', async () => {
    let callCount = 0;

    mockHttpClient.fetchVacancies.mockImplementation(async (_profile: any, page: number) => {
      callCount++;

      // Return vacancies on pages 0-2, then empty on page 3+
      if (page < 3) {
        return [
          {
            id: `vac-${page}-${callCount}`,
            name: 'Junior Developer', // Will be filtered by "senior" keyword
            employer: { name: 'Company' },
            alternate_url: `https://hh.ru/vacancy/vac-${page}`,
          },
        ];
      }
      return [];
    });

    await store.updateState({
      selectedResumeHash: 'test-resume',
      resumeCandidates: [
        {
          hash: 'test-resume',
          title: 'Test Resume',
          isActive: true,
          source: 'hh_detected',
          lastSeenAt: Date.now(),
        },
      ],
      activeProfileId: 'prof1',
      profiles: {
        prof1: {
          id: 'prof1',
          name: 'Senior Profile',
          keywordsInclude: ['senior'], // Filters out "Junior"
          keywordsExclude: [],
          locations: [],
          experience: [],
          schedule: [],
          employment: [],
        },
      },
      vacancyQueue: [],
      settings: {
        maxAutoAppliesPerRun: 0,
        delayMinSeconds: 1,
        delayMaxSeconds: 2,
        stopOnManualAction: false,
      },
    });

    startPromise = engine.start();
    await driveUntil(() => store.getState().runtime.currentPhase === 'exhausted');

    // PROOF: Backend continued through multiple pages despite prefilter eliminating all
    expect(callCount).toBeGreaterThanOrEqual(5);

    const state = store.getState();

    // PROOF: Eventually reached exhausted state
    expect(state.runtime.currentPhase).toBe('exhausted');

    await engine.stop();
    releaseAllSleeps();
    await startPromise;
  });

  it('PROOF: backend resets pagination on new run', async () => {
    mockHttpClient.fetchVacancies.mockResolvedValue([]);

    await store.updateState({
      selectedResumeHash: 'test-resume',
      resumeCandidates: [
        {
          hash: 'test-resume',
          title: 'Test Resume',
          isActive: true,
          source: 'hh_detected',
          lastSeenAt: Date.now(),
        },
      ],
      activeProfileId: 'prof1',
      profiles: {
        prof1: {
          id: 'prof1',
          name: 'Test Profile',
          keywordsInclude: ['python'],
          keywordsExclude: [],
          locations: [],
          experience: [],
          schedule: [],
          employment: [],
        },
      },
      vacancyQueue: [],
      settings: {
        maxAutoAppliesPerRun: 0,
        delayMinSeconds: 1,
        delayMaxSeconds: 2,
        stopOnManualAction: false,
      },
    });

    // First run
    startPromise = engine.start();
    await driveUntil(() => store.getState().runtime.currentPhase === 'exhausted');
    await engine.stop();
    releaseAllSleeps();
    await startPromise;

    const stateAfterFirstRun = store.getState();
    expect(stateAfterFirstRun.runtime.currentPhase).toBe('exhausted');
    expect(stateAfterFirstRun.runtime.currentSearchPage).toBeGreaterThan(0);

    // Reset and second run
    mockHttpClient.fetchVacancies.mockClear();
    startPromise = engine.start();
    await waitFor(() => mockHttpClient.fetchVacancies.mock.calls.length > 0);

    // PROOF: Pagination was reset - starts from page 0 again
    expect(mockHttpClient.fetchVacancies).toHaveBeenCalledWith(expect.anything(), 0);

    await engine.stop();
    releaseAllSleeps();
    await startPromise;
  });
});
