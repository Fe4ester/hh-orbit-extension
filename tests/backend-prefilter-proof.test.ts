import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackendAutoApplyEngine } from '../src/runtime/backendAutoApplyEngine';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';

describe('Backend Explicit Acquisition Outcome - Runtime Proof', () => {
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

  it('PROOF: explicit outcome for prefilter_eliminated_all triggers retry', async () => {
    // Setup: API returns vacancies, but profile keywords will filter them all out
    mockHttpClient.fetchVacancies.mockResolvedValue([
      {
        id: '111',
        name: 'Junior Python Developer',
        employer: { name: 'Company A' },
        alternate_url: 'https://hh.ru/vacancy/111',
      },
      {
        id: '222',
        name: 'Intern Backend Developer',
        employer: { name: 'Company B' },
        alternate_url: 'https://hh.ru/vacancy/222',
      },
    ]);

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
          keywordsInclude: ['senior', 'lead'], // Will filter out "Junior" and "Intern"
          keywordsExclude: [],
          locations: [],
          experience: [],
          schedule: [],
          employment: [],
        },
      },
      vacancyQueue: [],
      settings: {
        maxAutoAppliesPerRun: 0, // 0 = unlimited
        delayMinSeconds: 1,
        delayMaxSeconds: 2,
        stopOnManualAction: false,
      },
    });

    const startPromise = engine.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const stateAfterCycle = store.getState();

    // PROOF 1: Engine is still running (not terminated)
    expect(engine.isRunning()).toBe(true);

    // PROOF 2: Engine is in 'waiting' phase (preparing for retry)
    expect(stateAfterCycle.runtime.currentPhase).toBe('waiting');

    // PROOF 3: fetchVacancies was called (acquisition happened)
    expect(mockHttpClient.fetchVacancies).toHaveBeenCalledTimes(1);

    // PROOF 4: Queue is empty (prefilter eliminated all)
    expect(stateAfterCycle.vacancyQueue.length).toBe(0);

    // PROOF 5: Runtime state is RUNNING, not STOPPED or ERROR
    expect(stateAfterCycle.runtimeState).toBe('RUNNING');

    await engine.stop();
    await startPromise;

    const finalState = store.getState();

    // PROOF 6: Engine stopped gracefully via user stop, not terminal error
    expect(finalState.runtimeState).toBe('STOPPED');
  });

  it('PROOF: explicit outcome for api_returned_zero triggers retry', async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 100));

    const stateAfterCycle = store.getState();

    // PROOF: Engine continues with retry, not terminal stop
    expect(engine.isRunning()).toBe(true);
    expect(stateAfterCycle.runtime.currentPhase).toBe('waiting');
    expect(mockHttpClient.fetchVacancies).toHaveBeenCalledTimes(1);

    await engine.stop();
    await startPromise;
  });

  it('PROOF: backend retries multiple times with explicit outcomes', async () => {
    let fetchCallCount = 0;

    mockHttpClient.fetchVacancies.mockImplementation(async () => {
      fetchCallCount++;
      // Always return vacancies that will be filtered out
      return [
        {
          id: `vac-${fetchCallCount}`,
          name: 'Junior Developer',
          employer: { name: 'Company' },
          alternate_url: `https://hh.ru/vacancy/vac-${fetchCallCount}`,
        },
      ];
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
          keywordsInclude: ['senior'],
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
    await new Promise((resolve) => setTimeout(resolve, 300));

    // PROOF: fetchVacancies was called multiple times (retry loop works)
    expect(fetchCallCount).toBeGreaterThanOrEqual(2);

    // PROOF: Engine is still running
    expect(engine.isRunning()).toBe(true);

    await engine.stop();
    await startPromise;
  });
});
