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
      await waitFor(() => mockHttpClient.fetchVacancies.mock.calls.length >= 2);

      await engine.stop();
      releaseAllSleeps();
      await startPromise;

      // Behavior: fetchVacancies was called multiple times (retry happened)
      expect(mockHttpClient.fetchVacancies.mock.calls.length).toBeGreaterThanOrEqual(2);
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

  describe('backend cover letter modal handling', () => {
    it('attempts HTTP apply when preflight requires cover letter and profile has template', async () => {
      await store.updateState({
        selectedResumeHash: 'resume123',
        activeProfileId: 'prof1',
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test Profile',
            coverLetterTemplate: 'Template text',
            keywordsInclude: ['test'],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        vacancyQueue: [
          {
            vacancyId: 'vac-1',
            title: 'Backend Engineer',
            company: 'HH',
            url: 'https://hh.ru/vacancy/vac-1',
            source: 'search_dom',
            discoveredAt: Date.now(),
            profileId: 'prof1',
            status: 'discovered',
          },
        ],
      });

      mockHttpClient.preflightApply.mockResolvedValue({
        canProceed: false,
        reason: 'cover_letter_required',
        requiresCoverLetter: true,
        letterMaxLength: 4000,
      });

      mockHttpClient.applyToVacancy.mockResolvedValue({
        success: true,
        outcome: 'success',
        message: 'Application sent successfully',
      });

      const result = await (engine as any).executeApply('vac-1');
      const state = store.getState();

      expect(result).toEqual({
        outcome: 'success',
        requiresManualAction: false,
        coverLetterFlow: true,
      });
      expect(mockHttpClient.applyToVacancy).toHaveBeenCalledWith(
        'vac-1',
        expect.objectContaining({ resumeHash: 'resume123' }),
        'Template text'
      );
      expect(state.manualActions).toHaveLength(0);
    });

    it('creates manual action and skips HTTP apply when cover letter template is missing', async () => {
      await store.updateState({
        selectedResumeHash: 'resume123',
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
        vacancyQueue: [
          {
            vacancyId: 'vac-1',
            title: 'Backend Engineer',
            company: 'HH',
            url: 'https://hh.ru/vacancy/vac-1',
            source: 'search_dom',
            discoveredAt: Date.now(),
            profileId: 'prof1',
            status: 'discovered',
          },
        ],
      });

      mockHttpClient.preflightApply.mockResolvedValue({
        canProceed: false,
        reason: 'cover_letter_required',
        requiresCoverLetter: true,
      });

      const result = await (engine as any).executeApply('vac-1');
      const state = store.getState();

      expect(result).toEqual({
        outcome: 'cover_letter_required',
        requiresManualAction: true,
        coverLetterFlow: true,
      });
      expect(mockHttpClient.applyToVacancy).not.toHaveBeenCalled();
      expect(state.manualActions).toHaveLength(1);
      expect(state.manualActions[0].type).toBe('cover_letter_missing');
      expect(state.manualActions[0].reasonCode).toBe('cover_letter_template_missing');
    });

    it('creates manual action and skips HTTP apply when the template exceeds the preflight limit', async () => {
      await store.updateState({
        selectedResumeHash: 'resume123',
        activeProfileId: 'prof1',
        profiles: {
          prof1: {
            id: 'prof1', name: 'Test Profile', coverLetterTemplate: 'Too long',
            keywordsInclude: ['test'], keywordsExclude: [], locations: [], experience: [], schedule: [], employment: [],
          },
        },
        vacancyQueue: [{
          vacancyId: 'vac-1', title: 'Backend Engineer', company: 'HH', url: 'https://hh.ru/vacancy/vac-1',
          source: 'search_dom', discoveredAt: Date.now(), profileId: 'prof1', status: 'discovered',
        }],
      });
      mockHttpClient.preflightApply.mockResolvedValue({
        canProceed: false, reason: 'cover_letter_required', requiresCoverLetter: true, letterMaxLength: 3,
      });

      const result = await (engine as any).executeApply('vac-1');
      const state = store.getState();

      expect(result).toEqual({ outcome: 'cover_letter_required', requiresManualAction: true, coverLetterFlow: true });
      expect(mockHttpClient.applyToVacancy).not.toHaveBeenCalled();
      expect(state.manualActions[0]).toMatchObject({
        reasonCode: 'cover_letter_template_too_long',
        details: { letterLength: 8, letterMaxLength: 3 },
      });
    });

    it('does not report false success when HTTP apply still returns cover letter blocker', async () => {
      await store.updateState({
        selectedResumeHash: 'resume123',
        activeProfileId: 'prof1',
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test Profile',
            coverLetterTemplate: 'Template text',
            keywordsInclude: ['test'],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        vacancyQueue: [
          {
            vacancyId: 'vac-1',
            title: 'Backend Engineer',
            company: 'HH',
            url: 'https://hh.ru/vacancy/vac-1',
            source: 'search_dom',
            discoveredAt: Date.now(),
            profileId: 'prof1',
            status: 'discovered',
          },
        ],
      });

      mockHttpClient.preflightApply.mockResolvedValue({
        canProceed: false,
        reason: 'cover_letter_required',
        requiresCoverLetter: true,
      });

      mockHttpClient.applyToVacancy.mockResolvedValue({
        success: false,
        outcome: 'cover_letter_required',
        message: 'Cover letter required',
      });

      const result = await (engine as any).executeApply('vac-1');
      const state = store.getState();

      expect(result).toEqual({
        outcome: 'cover_letter_required',
        requiresManualAction: true,
        coverLetterFlow: true,
      });
      expect(mockHttpClient.applyToVacancy).toHaveBeenCalledTimes(1);
      expect(state.manualActions).toHaveLength(1);
      expect(state.manualActions[0].reasonCode).toBe('cover_letter_required_after_http_apply');
    });

    it('routes structured { error: \"letter-required\" } apply response into explicit cover letter blocker path', async () => {
      await store.updateState({
        selectedResumeHash: 'resume123',
        activeProfileId: 'prof1',
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test Profile',
            coverLetterTemplate: 'Template text',
            keywordsInclude: ['test'],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        vacancyQueue: [
          {
            vacancyId: 'vac-1',
            title: 'Backend Engineer',
            company: 'HH',
            url: 'https://hh.ru/vacancy/vac-1',
            source: 'search_dom',
            discoveredAt: Date.now(),
            profileId: 'prof1',
            status: 'discovered',
          },
        ],
      });

      mockHttpClient.preflightApply.mockResolvedValue({
        canProceed: false,
        reason: 'cover_letter_required',
        requiresCoverLetter: true,
      });

      mockHttpClient.applyToVacancy.mockResolvedValue({
        success: false,
        outcome: 'cover_letter_required',
        message: 'Cover letter required (server validation)',
        diagnostics: {
          responseKind: 'json',
          status: 400,
          keys: ['error'],
          errorSignal: 'letter-required',
          preview: '{"error":"letter-required"}',
        },
      });

      const result = await (engine as any).executeApply('vac-1');
      const state = store.getState();

      expect(result).toEqual({
        outcome: 'cover_letter_required',
        requiresManualAction: true,
        coverLetterFlow: true,
      });
      expect(state.manualActions).toHaveLength(1);
      expect(state.manualActions[0].reasonCode).toBe('cover_letter_required_after_http_apply');
      expect(state.applyAttempts[0].metadata).toEqual(
        expect.objectContaining({
          diagnostics: expect.objectContaining({
            errorSignal: 'letter-required',
          }),
        })
      );
    });

    it('creates manual action when cover letter HTTP path ends in unrecognized error', async () => {
      await store.updateState({
        selectedResumeHash: 'resume123',
        activeProfileId: 'prof1',
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test Profile',
            coverLetterTemplate: 'Template text',
            keywordsInclude: ['test'],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        vacancyQueue: [
          {
            vacancyId: 'vac-1',
            title: 'Backend Engineer',
            company: 'HH',
            url: 'https://hh.ru/vacancy/vac-1',
            source: 'search_dom',
            discoveredAt: Date.now(),
            profileId: 'prof1',
            status: 'discovered',
          },
        ],
      });

      mockHttpClient.preflightApply.mockResolvedValue({
        canProceed: false,
        reason: 'cover_letter_required',
        requiresCoverLetter: true,
      });

      mockHttpClient.applyToVacancy.mockResolvedValue({
        success: false,
        outcome: 'error',
        message: 'HTTP 400 (unrecognized text apply response)',
        error: '<html>unknown modal handshake</html>',
        diagnostics: {
          responseKind: 'text',
          status: 400,
          preview: '<html>unknown modal handshake</html>',
        },
      });

      const result = await (engine as any).executeApply('vac-1');
      const state = store.getState();

      expect(result).toEqual({
        outcome: 'error',
        requiresManualAction: true,
        coverLetterFlow: true,
      });
      expect(state.manualActions).toHaveLength(1);
      expect(state.manualActions[0].reasonCode).toBe('cover_letter_http_protocol_gap');
      expect(state.manualActions[0].details).toEqual(
        expect.objectContaining({
          applyOutcome: 'error',
          diagnostics: expect.objectContaining({
            responseKind: 'text',
          }),
        })
      );
    });
  });

  describe('apply decision counters and stop semantics', () => {
    const configureQueuedVacancy = async (
      stopOnManualAction = false,
      vacancyIds = ['vac-1'],
      maxAutoAppliesPerRun = 0
    ) => {
      await store.updateState({
        selectedResumeHash: 'resume123',
        resumeCandidates: [{ hash: 'resume123', title: 'Resume', isActive: true, source: 'hh_detected', lastSeenAt: Date.now() }],
        activeProfileId: 'prof1',
        profiles: {
          prof1: {
            id: 'prof1', name: 'Test Profile', keywordsInclude: ['test'], keywordsExclude: [],
            locations: [], experience: [], schedule: [], employment: [],
          },
        },
        vacancyQueue: vacancyIds.map((vacancyId) => ({
          vacancyId, title: 'Backend Engineer', company: 'HH', url: `https://hh.ru/vacancy/${vacancyId}`,
          source: 'search_dom', discoveredAt: Date.now(), profileId: 'prof1', status: 'discovered',
        })),
        settings: { maxAutoAppliesPerRun, delayMinSeconds: 1, delayMaxSeconds: 1, stopOnManualAction },
      });
      mockHttpClient.checkAuth.mockResolvedValue({ authorized: true });
    };

    it('counts a successful apply without creating a manual action', async () => {
      await configureQueuedVacancy();
      mockHttpClient.preflightApply.mockResolvedValue({ canProceed: true });
      mockHttpClient.applyToVacancy.mockResolvedValue({ success: true, outcome: 'success' });

      startPromise = engine.start();
      await waitFor(() => sleepResolvers.length === 1);

      expect(store.getState().runtime).toMatchObject({ processed: 1, success: 1, manualActions: 0 });
      expect(store.getState().manualActions).toHaveLength(0);
      expect(mockSleep).toHaveBeenCalledTimes(1);
      await engine.stop();
      releaseAllSleeps();
      await startPromise;
    });

    it.each([
      ['test_required', { requiresTest: true }],
      ['questionnaire_required', { requiresQuestionnaire: true }],
      ['cover_letter_required', { requiresCoverLetter: true }],
    ])('continues immediately after preflight %s when manual actions do not stop the run', async (outcome, blocker) => {
      await configureQueuedVacancy(false, ['vac-1', 'vac-2'], 1);
      mockHttpClient.preflightApply
        .mockResolvedValueOnce({ canProceed: false, reason: outcome, ...blocker })
        .mockResolvedValueOnce({ canProceed: true });
      mockHttpClient.applyToVacancy.mockResolvedValue({ success: true, outcome: 'success' });

      startPromise = engine.start();
      await waitFor(() => mockHttpClient.preflightApply.mock.calls.length === 2 && sleepResolvers.length === 1);

      expect(store.getState().runtime).toMatchObject({ processed: 2, success: 1, manualActions: 1 });
      expect(store.getState().manualActions).toHaveLength(1);
      expect(mockHttpClient.applyToVacancy).toHaveBeenCalledTimes(1);
      expect(mockSleep).toHaveBeenCalledTimes(1);
      await engine.stop();
      releaseAllSleeps();
      await startPromise;
    });

    it.each(['error', 'unknown', 'failed'])('continues immediately after apply outcome %s', async (outcome) => {
      await configureQueuedVacancy(false, ['vac-1', 'vac-2'], 1);
      mockHttpClient.preflightApply.mockResolvedValue({ canProceed: true });
      mockHttpClient.applyToVacancy
        .mockResolvedValueOnce({ success: false, outcome })
        .mockResolvedValueOnce({ success: true, outcome: 'success' });

      startPromise = engine.start();
      await waitFor(() => mockHttpClient.applyToVacancy.mock.calls.length === 2 && sleepResolvers.length === 1);

      expect(store.getState().runtime).toMatchObject({ processed: 2, success: 1 });
      expect(mockSleep).toHaveBeenCalledTimes(1);
      await engine.stop();
      releaseAllSleeps();
      await startPromise;
    });

    it('continues immediately after already_applied', async () => {
      await configureQueuedVacancy(false, ['vac-1', 'vac-2'], 1);
      mockHttpClient.preflightApply
        .mockResolvedValueOnce({ canProceed: false, alreadyApplied: true })
        .mockResolvedValueOnce({ canProceed: true });
      mockHttpClient.applyToVacancy.mockResolvedValue({ success: true, outcome: 'success' });

      startPromise = engine.start();
      await waitFor(() => mockHttpClient.preflightApply.mock.calls.length === 2 && sleepResolvers.length === 1);

      expect(store.getState().runtime).toMatchObject({ processed: 2, success: 1, manualActions: 0 });
      expect(mockHttpClient.applyToVacancy).toHaveBeenCalledTimes(1);
      expect(mockSleep).toHaveBeenCalledTimes(1);
      await engine.stop();
      releaseAllSleeps();
      await startPromise;
    });

    it('stops before a second vacancy after the successful apply reaches the run limit', async () => {
      await configureQueuedVacancy(false, ['vac-1', 'vac-2'], 1);
      mockHttpClient.preflightApply.mockResolvedValue({ canProceed: true });
      mockHttpClient.applyToVacancy.mockResolvedValue({ success: true, outcome: 'success' });

      startPromise = engine.start();
      await waitFor(() => sleepResolvers.length === 1);
      await releaseNextSleep();
      await startPromise;

      expect(store.getState().runtime).toMatchObject({ processed: 1, success: 1, manualActions: 0 });
      expect(mockHttpClient.applyToVacancy).toHaveBeenCalledTimes(1);
      expect(engine.isRunning()).toBe(false);
    });

    it('pauses after a manual blocker when stopOnManualAction is enabled', async () => {
      await configureQueuedVacancy(true);
      mockHttpClient.preflightApply.mockResolvedValue({ canProceed: false, reason: 'test_required', requiresTest: true });

      await engine.start();

      expect(store.getState().runtime).toMatchObject({ processed: 1, success: 0, manualActions: 1, currentPhase: 'paused_manual_action' });
      expect(mockSleep).not.toHaveBeenCalled();
      expect(engine.isRunning()).toBe(false);
    });
  });
});
