/**
 * Backend Auto Apply Engine
 *
 * Pure HTTP mode: no tabs, only API requests.
 * Uses BackendHTTPClient for all operations.
 */

import { StateStore } from '../state/store';
import { BackendHTTPClient } from './backendHTTPClient';

export interface BackendEngineDeps {
  store: StateStore;
  httpClient: BackendHTTPClient;
  sleep: (ms: number) => Promise<void>;
  log: (...args: any[]) => void;
  debug?: boolean;
}

export class BackendAutoApplyEngine {
  private running = false;
  private stopRequested = false;
  private debug: boolean;

  constructor(private deps: BackendEngineDeps) {
    this.debug = deps.debug ?? true;
  }

  private debugLog(...args: any[]): void {
    if (this.debug) {
      this.deps.log(...args);
    }
  }

  private notify(level: 'info' | 'success' | 'warn' | 'error', message: string, sticky = false): void {
    const nm = this.deps.store.getNotificationManager();
    if (sticky) {
      nm.addSticky(level, message);
    } else {
      nm.addToast(level, message);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;

    this.deps.log('[BackendEngine] START');

    try {
      await this.deps.store.dispatch('START_REQUESTED');
      await this.deps.store.dispatch('START_CONFIRMED');
      await this.deps.store.resetRuntimeCounters();

      while (!this.stopRequested) {
        const state = this.deps.store.getState();

        if (state.runtime.processed >= state.settings.maxAutoAppliesPerRun) {
          this.deps.log('[BackendEngine] Run limit reached');
          break;
        }

        const cycleResult = await this.runCycle();

        if (cycleResult !== 'ok') {
          this.deps.log('[BackendEngine] Cycle stopped', { reason: cycleResult });
          break;
        }

        const delaySeconds = this.randomInRange(
          state.settings.delayMinSeconds,
          state.settings.delayMaxSeconds
        );

        await this.deps.store.setRuntimePhase('waiting');
        this.deps.log('[BackendEngine] Waiting', { delaySeconds });
        await this.deps.sleep(delaySeconds * 1000);
      }

      this.deps.log('[BackendEngine] Pipeline finished');
    } catch (error) {
      this.deps.log('[BackendEngine] Error:', error);
      await this.deps.store.dispatch('FAILURE');
    } finally {
      await this.stopInternal();
    }
  }

  async stop(): Promise<void> {
    this.deps.log('[BackendEngine] STOP requested');
    this.stopRequested = true;

    if (!this.running) {
      await this.stopInternal();
    }
  }

  private async stopInternal(): Promise<void> {
    const currentState = this.deps.store.getState().runtimeState;

    this.deps.log('[BackendEngine] stopInternal begin', { currentState });

    if (currentState === 'STOPPED' || currentState === 'IDLE') {
      this.running = false;
      this.stopRequested = false;
      return;
    }

    if (currentState === 'ERROR') {
      this.running = false;
      this.stopRequested = false;
      await this.deps.store.updateState({ runtimeState: 'IDLE' });
      return;
    }

    if (['RUNNING', 'PAUSED_BY_USER', 'PAUSED_MANUAL_ACTION', 'PAUSED_NO_VACANCIES', 'STARTING'].includes(currentState)) {
      try {
        if (currentState === 'STARTING') {
          await this.deps.store.dispatch('START_CONFIRMED');
        }

        await this.deps.store.dispatch('STOP_REQUESTED');
        await this.deps.store.dispatch('STOP_CONFIRMED');
      } catch (error) {
        this.deps.log('[BackendEngine] dispatch failed, forcing STOPPED', error);
        await this.deps.store.updateState({ runtimeState: 'STOPPED' });
      }
    } else {
      await this.deps.store.updateState({ runtimeState: 'STOPPED' });
    }

    this.running = false;
    this.stopRequested = false;

    this.deps.log('[BackendEngine] stopInternal done');
  }

  private async runCycle(): Promise<'ok' | 'blocked' | 'manual' | 'no_vacancies'> {
    // 1. Check session
    this.debugLog('[BackendEngine] runCycle: checkSession');
    await this.deps.store.setRuntimePhase('session_check');
    this.notify('info', 'Проверка авторизации...');

    const sessionOk = await this.checkSession();

    if (!sessionOk) {
      this.notify('error', 'Требуется авторизация на hh.ru', true);
      await this.deps.store.setRuntimePhase('paused_auth', 'auth_required');
      return 'blocked';
    }

    this.notify('success', 'Авторизация успешна');

    // 2. Check resume
    this.debugLog('[BackendEngine] runCycle: ensureResume');
    await this.deps.store.setRuntimePhase('resume_check');
    this.notify('info', 'Проверка резюме...');

    const resumeOk = await this.ensureResume();

    if (!resumeOk) {
      this.notify('warn', 'Резюме не найдено', true);
      await this.deps.store.setRuntimePhase('paused_manual_action', 'resume_not_found');
      return 'manual';
    }

    // 3. Acquire vacancies (if queue empty)
    const state = this.deps.store.getState();
    const queueCount = state.vacancyQueue.filter((v) => v.status === 'discovered').length;

    if (queueCount === 0) {
      this.debugLog('[BackendEngine] runCycle: acquireVacancies');
      await this.deps.store.setRuntimePhase('search');
      this.notify('info', 'Загрузка вакансий...');

      const acquired = await this.acquireVacancies();

      if (!acquired) {
        this.notify('warn', 'Вакансии не найдены', true);
        await this.deps.store.setRuntimePhase('paused_no_vacancies', 'no_vacancies');
        return 'no_vacancies';
      }

      const newState = this.deps.store.getState();
      const newCount = newState.vacancyQueue.filter((v) => v.status === 'discovered').length;
      this.notify('success', `Загружено вакансий: ${newCount}`);
    }

    // 4. Select next vacancy
    const nextVacancy = this.deps.store.getState().vacancyQueue.find((v) => v.status === 'discovered');

    if (!nextVacancy || !nextVacancy.vacancyId) {
      await this.deps.store.setRuntimePhase('paused_no_vacancies', 'queue_empty');
      return 'no_vacancies';
    }

    // 5. Apply
    this.debugLog('[BackendEngine] runCycle: executeApply', { vacancyId: nextVacancy.vacancyId });
    await this.deps.store.setRuntimePhase('apply');
    this.notify('info', `Отклик: ${nextVacancy.title || nextVacancy.vacancyId}`);

    const applyResult = await this.executeApply(nextVacancy.vacancyId);

    // 6. Notify result
    if (applyResult.outcome === 'success') {
      this.notify('success', `Отклик отправлен: ${nextVacancy.title || nextVacancy.vacancyId}`);
    } else if (applyResult.outcome === 'already_applied') {
      this.notify('info', `Уже откликались: ${nextVacancy.title || nextVacancy.vacancyId}`);
    } else if (applyResult.outcome === 'test_required') {
      this.notify('warn', `Требуется тест: ${nextVacancy.title || nextVacancy.vacancyId}`);
    } else if (applyResult.outcome === 'questionnaire_required') {
      this.notify('warn', `Требуется анкета: ${nextVacancy.title || nextVacancy.vacancyId}`);
    } else {
      this.notify('error', `Ошибка отклика: ${nextVacancy.title || nextVacancy.vacancyId}`);
    }

    // 7. Update counters
    await this.deps.store.incrementRuntimeCounters({
      processed: 1,
      success: applyResult.outcome === 'success' ? 1 : 0,
      manualActions: applyResult.requiresManualAction ? 1 : 0,
    });

    this.debugLog('[BackendEngine] Counters incremented', {
      processed: this.deps.store.getState().runtime.processed,
      success: this.deps.store.getState().runtime.success,
      manualActions: this.deps.store.getState().runtime.manualActions,
    });

    // Mark vacancy as processed
    await this.deps.store.markVacancyProcessed(nextVacancy.vacancyId);

    if (applyResult.requiresManualAction && this.deps.store.getState().settings.stopOnManualAction) {
      await this.deps.store.setRuntimePhase('paused_manual_action', applyResult.outcome);
      return 'manual';
    }

    return 'ok';
  }

  private async checkSession(): Promise<boolean> {
    this.debugLog('[BackendEngine] checkSession');

    try {
      const authResult = await this.deps.httpClient.checkAuth();

      if (!authResult.authorized) {
        await this.deps.store.setRuntimeBlocker('login_required', 'Not authorized');
        return false;
      }

      await this.deps.store.clearRuntimeBlocker();
      return true;
    } catch (error) {
      this.debugLog('[BackendEngine] checkSession error:', error);
      await this.deps.store.setRuntimeBlocker('session_unknown', 'Session check failed');
      return false;
    }
  }

  private async ensureResume(): Promise<boolean> {
    this.debugLog('[BackendEngine] ensureResume');

    const state = this.deps.store.getState();

    if (state.selectedResumeHash) {
      const exists = state.resumeCandidates.some((r) => r.hash === state.selectedResumeHash);
      if (exists) return true;
    }

    // Fetch resumes via API
    try {
      const resumes = await this.deps.httpClient.getMyResumes();

      if (resumes.length === 0) {
        return false;
      }

      await this.deps.store.setResumeCandidates(
        resumes.map((r) => ({
          ...r,
          source: 'hh_detected' as const,
          lastSeenAt: Date.now(),
        }))
      );

      await this.deps.store.selectResume(resumes[0].hash);

      return true;
    } catch (error) {
      this.debugLog('[BackendEngine] ensureResume error:', error);
      return false;
    }
  }

  private async acquireVacancies(): Promise<boolean> {
    this.debugLog('[BackendEngine] acquireVacancies START');

    const state = this.deps.store.getState();
    const profileId = state.activeProfileId;

    if (!profileId) {
      this.debugLog('[BackendEngine] acquireVacancies: no active profile');
      return false;
    }

    const profile = state.profiles[profileId];

    this.debugLog('[BackendEngine] acquireVacancies profile', {
      profileId,
      name: profile.name,
      keywordsInclude: profile.keywordsInclude,
      keywordsExclude: profile.keywordsExclude,
      experience: profile.experience,
      schedule: profile.schedule,
      employment: profile.employment,
    });

    try {
      const apiVacancies = await this.deps.httpClient.fetchVacancies(profile);

      this.debugLog('[BackendEngine] acquireVacancies API result', {
        count: apiVacancies.length,
      });

      if (apiVacancies.length === 0) {
        this.debugLog('[BackendEngine] acquireVacancies: NO VACANCIES FOUND', {
          profileName: profile.name,
          keywords: profile.keywordsInclude,
        });
        this.notify('warn', 'Вакансии не найдены. Проверьте параметры профиля.', true);
        return false;
      }

      const cards = apiVacancies.map((v) => ({
        vacancyId: v.id,
        title: v.name,
        company: v.employer.name,
        url: v.alternate_url,
        source: 'search_dom' as const,
        discoveredAt: Date.now(),
        profileId,
        status: 'discovered' as const,
      }));

      this.debugLog('[BackendEngine] acquireVacancies: materialized cards', {
        beforeCount: state.vacancyQueue.length,
        newCount: cards.length,
      });

      await this.deps.store.materializeVacanciesFromSearch(cards, profileId);

      const afterState = this.deps.store.getState();
      this.debugLog('[BackendEngine] acquireVacancies: after materialize', {
        afterCount: afterState.vacancyQueue.length,
        discoveredCount: afterState.vacancyQueue.filter((v) => v.status === 'discovered').length,
      });

      return true;
    } catch (error) {
      this.debugLog('[BackendEngine] acquireVacancies EXCEPTION', {
        message: (error as Error).message,
        stack: (error as Error).stack,
      });
      return false;
    }
  }

  private async executeApply(vacancyId: string): Promise<{
    outcome: string;
    requiresManualAction: boolean;
  }> {
    this.debugLog('[BackendEngine] executeApply', { vacancyId });

    const state = this.deps.store.getState();
    const profile = state.activeProfileId ? state.profiles[state.activeProfileId] : null;

    if (!state.selectedResumeHash) {
      return { outcome: 'error', requiresManualAction: false };
    }

    try {
      // 1. Preflight check
      this.debugLog('[BackendEngine] executeApply: preflight');
      const preflight = await this.deps.httpClient.preflightApply(
        vacancyId,
        state.selectedResumeHash
      );

      if (!preflight.canProceed) {
        this.debugLog('[BackendEngine] Preflight failed', { reason: preflight.reason });

        if (preflight.alreadyApplied) {
          await this.deps.store.recordLocalApplyAttempt({
            vacancyId,
            profileId: state.activeProfileId,
            resumeHash: state.selectedResumeHash,
            outcome: 'already_applied',
            message: 'Already applied',
          });

          return { outcome: 'already_applied', requiresManualAction: false };
        }

        if (preflight.requiresTest || preflight.requiresQuestionnaire) {
          const nextVacancy = state.vacancyQueue.find((v) => v.vacancyId === vacancyId);

          this.debugLog('[BackendEngine] Creating manual action', {
            type: preflight.requiresTest ? 'test' : 'questionnaire',
            vacancyId,
            vacancyTitle: nextVacancy?.title,
          });

          await this.deps.store.createManualAction({
            type: preflight.requiresTest ? 'test' : 'questionnaire',
            vacancyId,
            vacancyTitle: nextVacancy?.title || `Vacancy ${vacancyId}`,
            company: nextVacancy?.company,
            url: nextVacancy?.url || `https://hh.ru/vacancy/${vacancyId}`,
            profileId: state.activeProfileId || undefined,
            status: 'pending',
            reasonCode: preflight.requiresTest ? 'test_required' : 'questionnaire_required',
          });

          return {
            outcome: preflight.requiresTest ? 'test_required' : 'questionnaire_required',
            requiresManualAction: true,
          };
        }

        return { outcome: 'error', requiresManualAction: false };
      }

      // 2. Apply
      this.debugLog('[BackendEngine] executeApply: apply');
      const applyResult = await this.deps.httpClient.applyToVacancy(
        vacancyId,
        {
          resumeHash: state.selectedResumeHash,
          lux: true,
          ignorePostponed: true,
        },
        profile?.coverLetterTemplate
      );

      this.debugLog('[BackendEngine] Apply result', {
        success: applyResult.success,
        outcome: applyResult.outcome,
      });

      // 3. Record attempt
      await this.deps.store.recordLocalApplyAttempt({
        vacancyId,
        profileId: state.activeProfileId,
        resumeHash: state.selectedResumeHash,
        outcome: applyResult.outcome,
        message: applyResult.message || '',
      });

      return {
        outcome: applyResult.outcome,
        requiresManualAction:
          applyResult.outcome === 'test_required' || applyResult.outcome === 'questionnaire_required',
      };
    } catch (error) {
      this.debugLog('[BackendEngine] executeApply error:', error);

      return {
        outcome: 'error',
        requiresManualAction: false,
      };
    }
  }

  private randomInRange(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
