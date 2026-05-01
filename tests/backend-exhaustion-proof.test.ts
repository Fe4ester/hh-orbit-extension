import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackendAutoApplyEngine } from '../src/runtime/backendAutoApplyEngine';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';

describe('Backend Exhaustion Policy - Runtime Proof', () => {
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

    const startPromise = engine.start();
    await new Promise((resolve) => setTimeout(resolve, 200));

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

    const startPromise = engine.start();
    await new Promise((resolve) => setTimeout(resolve, 400));

    // PROOF: Backend continued through multiple pages despite prefilter eliminating all
    expect(callCount).toBeGreaterThanOrEqual(5);

    const state = store.getState();

    // PROOF: Eventually reached exhausted state
    expect(state.runtime.currentPhase).toBe('exhausted');

    await engine.stop();
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
    const startPromise1 = engine.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await engine.stop();
    await startPromise1;

    const stateAfterFirstRun = store.getState();
    expect(stateAfterFirstRun.runtime.currentPhase).toBe('exhausted');
    expect(stateAfterFirstRun.runtime.currentSearchPage).toBeGreaterThan(0);

    // Reset and second run
    mockHttpClient.fetchVacancies.mockClear();
    const startPromise2 = engine.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // PROOF: Pagination was reset - starts from page 0 again
    expect(mockHttpClient.fetchVacancies).toHaveBeenCalledWith(expect.anything(), 0);

    await engine.stop();
    await startPromise2;
  });
});
