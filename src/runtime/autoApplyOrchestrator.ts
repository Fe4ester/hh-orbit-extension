import { StateStore } from '../state/store';
import { AcquisitionService } from './acquisitionService';

interface BackgroundOperations {
  checkRuntimeBlockers: () => Promise<{ success: boolean; status?: string; blocker?: string; reason?: string }>;
  detectResumes: () => Promise<{ success: boolean; candidates?: any[]; reason?: string }>;
  observeVacancyDetail: () => Promise<{ success: boolean; observation?: any; classification?: any; error?: string }>;
  executeApply: (realClick: boolean) => Promise<{ success: boolean; result?: any; error?: string }>;
}

interface OrchestratorDeps {
  store: StateStore;
  ops: BackgroundOperations;
  acquisitionService: AcquisitionService;
  sleep: (ms: number) => Promise<void>;
  log: (...args: any[]) => void;
}

export class AutoApplyOrchestrator {
  private running = false;
  private stopRequested = false;

  constructor(private deps: OrchestratorDeps) {}

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;

    this.deps.log('[Orchestrator] AUTO_APPLY_START: Starting pipeline');

    try {
      await this.deps.store.dispatch('START_REQUESTED');
      await this.deps.store.dispatch('START_CONFIRMED');
      await this.deps.store.resetRuntimeCounters();

      while (!this.stopRequested) {
        const state = this.deps.store.getState();
        if (state.runtime.processed >= state.settings.maxAutoAppliesPerRun) {
          this.deps.log('[Orchestrator] AUTO_APPLY_START: Run limit reached', {
            processed: state.runtime.processed,
            limit: state.settings.maxAutoAppliesPerRun,
          });
          break;
        }

        const cycleResult = await this.runCycle();
        if (cycleResult === 'blocked' || cycleResult === 'manual' || cycleResult === 'no_vacancies' || cycleResult === 'search_open_failed') {
          this.deps.log('[Orchestrator] AUTO_APPLY_START: Cycle stopped', { reason: cycleResult });
          break;
        }

        const delaySeconds = randomInRange(
          state.settings.delayMinSeconds,
          state.settings.delayMaxSeconds
        );
        this.deps.log('[Orchestrator] AUTO_APPLY_START phase=waiting', { delaySeconds });
        await this.deps.store.setRuntimePhase('waiting');
        await this.deps.sleep(delaySeconds * 1000);
      }

      this.deps.log('[Orchestrator] AUTO_APPLY_START: Pipeline finished');
    } catch (error) {
      this.deps.log('[Orchestrator] AUTO_APPLY_START failed:', error);
      this.deps.log('[Orchestrator] AUTO_APPLY_START cleanup begin');

      // Log error but don't set phase to 'error' (not a valid phase type)
      // Store will handle state transition in stopInternal

      this.deps.log('[Orchestrator] AUTO_APPLY_START cleanup done');
    } finally {
      await this.stopInternal();
    }
  }

  async stop(): Promise<void> {
    this.deps.log('[Orchestrator] AUTO_APPLY_STOP: Stop requested');
    this.stopRequested = true;
    if (!this.running) {
      this.deps.log('[Orchestrator] AUTO_APPLY_STOP: Not running, forcing cleanup');
      await this.stopInternal();
    }
  }

  private async stopInternal(): Promise<void> {
    const currentState = this.deps.store.getState().runtimeState;

    this.deps.log('[Orchestrator] AUTO_APPLY_STOP: stopInternal begin', {
      running: this.running,
      currentState,
    });

    // Already stopped - no FSM transitions needed
    if (currentState === 'STOPPED') {
      this.deps.log('[Orchestrator] AUTO_APPLY_STOP: Already STOPPED, cleanup only');
      this.running = false;
      this.stopRequested = false;

      try {
        await this.deps.store.setRuntimePhase('idle', null);
      } catch (error) {
        this.deps.log('[Orchestrator] AUTO_APPLY_STOP: setRuntimePhase failed', error);
      }

      this.deps.log('[Orchestrator] AUTO_APPLY_STOP: stopInternal done (no dispatch)');
      return;
    }

    // ERROR state - reset to IDLE without FSM transitions
    if (currentState === 'ERROR') {
      this.deps.log('[Orchestrator] AUTO_APPLY_STOP: ERROR state, forcing IDLE');
      this.running = false;
      this.stopRequested = false;

      try {
        await this.deps.store.updateState({ runtimeState: 'IDLE' });
        await this.deps.store.setRuntimePhase('idle', null);
      } catch (error) {
        this.deps.log('[Orchestrator] AUTO_APPLY_STOP: force IDLE failed', error);
      }

      this.deps.log('[Orchestrator] AUTO_APPLY_STOP: stopInternal done (ERROR->IDLE)');
      return;
    }

    // Valid running/paused states - dispatch stop transitions
    if (['RUNNING', 'PAUSED_BY_USER', 'PAUSED_MANUAL_ACTION', 'PAUSED_NO_VACANCIES'].includes(currentState)) {
      this.deps.log('[Orchestrator] AUTO_APPLY_STOP: Dispatching STOP_REQUESTED');

      try {
        await this.deps.store.dispatch('STOP_REQUESTED');
        this.deps.log('[Orchestrator] AUTO_APPLY_STOP: Dispatching STOP_CONFIRMED');
        await this.deps.store.dispatch('STOP_CONFIRMED');
      } catch (error) {
        this.deps.log('[Orchestrator] AUTO_APPLY_STOP: dispatch failed, forcing STOPPED', error);
        try {
          await this.deps.store.updateState({ runtimeState: 'STOPPED' });
        } catch (forceError) {
          this.deps.log('[Orchestrator] AUTO_APPLY_STOP: force STOPPED failed', forceError);
        }
      }
    } else {
      // Unexpected state - log and force STOPPED
      this.deps.log('[Orchestrator] AUTO_APPLY_STOP: Unexpected state, forcing STOPPED', { currentState });
      try {
        await this.deps.store.updateState({ runtimeState: 'STOPPED' });
      } catch (error) {
        this.deps.log('[Orchestrator] AUTO_APPLY_STOP: force STOPPED failed', error);
      }
    }

    this.running = false;
    this.stopRequested = false;

    try {
      await this.deps.store.setRuntimePhase('idle', null);
    } catch (error) {
      this.deps.log('[Orchestrator] AUTO_APPLY_STOP: setRuntimePhase failed', error);
    }

    const finalState = this.deps.store.getState().runtimeState;
    this.deps.log('[Orchestrator] AUTO_APPLY_STOP: stopInternal done', {
      running: this.running,
      stopRequested: this.stopRequested,
      finalState,
    });
  }

  private async runCycle(): Promise<'ok' | 'blocked' | 'manual' | 'no_vacancies' | 'search_open_failed'> {
    this.deps.log('[Orchestrator] AUTO_APPLY_START phase=session_check');
    await this.deps.store.setRuntimePhase('session_check');
    const blockerResult = await this.deps.ops.checkRuntimeBlockers();

    if (!blockerResult.success || this.deps.store.getState().runtimeBlocker) {
      this.deps.log('[Orchestrator] AUTO_APPLY_START phase=paused_auth', {
        blocker: this.deps.store.getState().runtimeBlocker,
      });
      await this.deps.store.setRuntimePhase('paused_auth', this.deps.store.getState().runtimeBlocker || 'auth required');
      return 'blocked';
    }

    this.deps.log('[Orchestrator] AUTO_APPLY_START phase=resume_check');
    await this.deps.store.setRuntimePhase('resume_check');
    let state = this.deps.store.getState();
    const selectedExists =
      !!state.selectedResumeHash &&
      state.resumeCandidates.some((r) => r.hash === state.selectedResumeHash);

    if (!selectedExists) {
      this.deps.log('[Orchestrator] AUTO_APPLY_START phase=resume_detection');
      await this.deps.ops.detectResumes();
      state = this.deps.store.getState();
      if (!state.selectedResumeHash && state.resumeCandidates.length > 0) {
        await this.deps.store.selectResume(state.resumeCandidates[0].hash);
      }
      state = this.deps.store.getState();
      if (!state.selectedResumeHash) {
        this.deps.log('[Orchestrator] AUTO_APPLY_START phase=paused_manual_action: resume_not_found');
        await this.deps.store.setRuntimePhase('paused_manual_action', 'resume_not_found');
        return 'manual';
      }
    }

    this.deps.log('[Orchestrator] AUTO_APPLY_START phase=acquisition');
    await this.deps.store.setRuntimePhase('search');

    const activeProfileId = state.activeProfileId;
    if (!activeProfileId) {
      this.deps.log('[Orchestrator] AUTO_APPLY_START: No active profile');
      await this.deps.store.setRuntimePhase('paused_manual_action', 'no_active_profile');
      return 'search_open_failed';
    }

    const acquisitionResult = await this.deps.acquisitionService.acquireForProfile(activeProfileId);

    if (!acquisitionResult.success) {
      this.deps.log('[Orchestrator] AUTO_APPLY_START: Acquisition failed', {
        error: acquisitionResult.error,
      });
      await this.deps.store.setRuntimePhase('paused_manual_action', acquisitionResult.error || 'acquisition_failed');
      return 'search_open_failed';
    }

    this.deps.log('[Orchestrator] AUTO_APPLY_START: Acquisition success', {
      cardsFound: acquisitionResult.cardsFound,
      newQueued: acquisitionResult.newQueued,
      queueSizeAfter: acquisitionResult.queueSizeAfter,
    });

    if (acquisitionResult.newQueued === 0) {
      this.deps.log('[Orchestrator] AUTO_APPLY_START phase=paused_no_vacancies: no_new_vacancies');
      await this.deps.store.setRuntimePhase('paused_no_vacancies', 'no_new_vacancies');
      return 'no_vacancies';
    }

    state = this.deps.store.getState();
    const nextVacancy = state.vacancyQueue.find((item) => item.status === 'discovered');
    if (!nextVacancy) {
      this.deps.log('[Orchestrator] AUTO_APPLY_START phase=paused_no_vacancies: queue_empty');
      await this.deps.store.setRuntimePhase('paused_no_vacancies', 'queue_empty');
      return 'no_vacancies';
    }

    this.deps.log('[Orchestrator] AUTO_APPLY_START phase=vacancy_open', {
      vacancyId: nextVacancy.vacancyId,
      url: nextVacancy.url,
    });
    await this.deps.store.setRuntimePhase('vacancy_analysis');
    const tab = await chrome.tabs.create({ url: nextVacancy.url, active: true });
    if (tab.id && tab.windowId && tab.url) {
      await this.deps.store.bindControlledTab(tab.id, tab.windowId, tab.url);
      await this.deps.store.updateState({
        liveMode: {
          ...this.deps.store.getState().liveMode,
          controlledTabPurpose: 'vacancy',
        },
      });
    }
    await this.deps.ops.observeVacancyDetail();

    this.deps.log('[Orchestrator] AUTO_APPLY_START phase=apply');
    await this.deps.store.setRuntimePhase('apply');
    const applyResult = await this.deps.ops.executeApply(true);

    const outcome = applyResult?.result?.outcome;
    this.deps.log('[Orchestrator] AUTO_APPLY_START phase=apply_result', { outcome });

    await this.deps.store.incrementRuntimeCounters({
      processed: 1,
      success: outcome === 'success' ? 1 : 0,
      manualActions:
        outcome === 'questionnaire_required' || outcome === 'manual_action_required' ? 1 : 0,
    });

    if (
      (outcome === 'questionnaire_required' || outcome === 'manual_action_required') &&
      this.deps.store.getState().settings.stopOnManualAction
    ) {
      this.deps.log('[Orchestrator] AUTO_APPLY_START phase=paused_manual_action', { outcome });
      await this.deps.store.setRuntimePhase('paused_manual_action', outcome);
      return 'manual';
    }

    this.deps.log('[Orchestrator] AUTO_APPLY_START phase=cycle_complete');
    return 'ok';
  }
}

function randomInRange(min: number, max: number): number {
  const lo = Math.max(1, Math.min(min, max));
  const hi = Math.max(min, max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}
