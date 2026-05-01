/**
 * Backend Auto Apply Engine
 *
 * Pure HTTP mode: no tabs, only API requests.
 * Uses BackendHTTPClient for all operations.
 */

import { StateStore } from '../state/store';
import { BackendHTTPClient } from './backendHTTPClient';
import { FileLogger } from '../utils/fileLogger';

export interface BackendEngineDeps {
  store: StateStore;
  httpClient: BackendHTTPClient;
  sleep: (ms: number) => Promise<void>;
  log: (...args: any[]) => void;
}

export class BackendAutoApplyEngine {
  private running = false;
  private stopRequested = false;

  constructor(private deps: BackendEngineDeps) {}

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
    if (this.running) {
      FileLogger.log('service_worker', 'warn', 'BackendEngine already running, ignoring duplicate start');
      return;
    }
    this.running = true;
    this.stopRequested = false;

    FileLogger.log('service_worker', 'info', 'BackendEngine start');

    try {
      await this.deps.store.dispatch('START_REQUESTED');
      await this.deps.store.dispatch('START_CONFIRMED');
      await this.deps.store.resetRuntimeCounters();

      while (!this.stopRequested) {
        const state = this.deps.store.getState();

        // Проверка лимита: 0 = без лимита
        if (state.settings.maxAutoAppliesPerRun > 0 && state.runtime.processed >= state.settings.maxAutoAppliesPerRun) {
          FileLogger.log('service_worker', 'info', 'Run limit reached', {
            limit: state.settings.maxAutoAppliesPerRun,
            processed: state.runtime.processed
          });
          break;
        }

        const cycleResult = await this.runCycle();

        if (cycleResult !== 'ok') {
          FileLogger.log('service_worker', 'info', 'Cycle stopped', { reason: cycleResult });
          break;
        }

        const delaySeconds = this.randomInRange(
          state.settings.delayMinSeconds,
          state.settings.delayMaxSeconds
        );

        await this.deps.store.setRuntimePhase('waiting');
        FileLogger.log('service_worker', 'info', 'Waiting between cycles', { delaySeconds });
        await this.deps.sleep(delaySeconds * 1000);
      }

      FileLogger.log('service_worker', 'info', 'Pipeline finished');
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Engine error', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      await this.deps.store.dispatch('FAILURE');
    } finally {
      await this.stopInternal();
    }
  }

  async stop(): Promise<void> {
    FileLogger.log('service_worker', 'info', 'BackendEngine stop requested');
    this.stopRequested = true;

    if (!this.running) {
      await this.stopInternal();
    }
  }

  private async stopInternal(): Promise<void> {
    const currentState = this.deps.store.getState().runtimeState;

    FileLogger.log('service_worker', 'info', 'BackendEngine stopInternal', { currentState });

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
        FileLogger.log('service_worker', 'error', 'Dispatch failed, forcing STOPPED', {
          error: (error as Error).message
        });
        await this.deps.store.updateState({ runtimeState: 'STOPPED' });
      }
    } else {
      await this.deps.store.updateState({ runtimeState: 'STOPPED' });
    }

    this.running = false;
    this.stopRequested = false;

    FileLogger.log('service_worker', 'info', 'BackendEngine stopped');
  }

  private async runCycle(): Promise<'ok' | 'blocked' | 'manual' | 'no_vacancies'> {
    FileLogger.log('service_worker', 'info', 'Cycle start');

    // 1. Check session
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

    FileLogger.log('service_worker', 'info', 'Cycle complete', {
      vacancyId: nextVacancy.vacancyId,
      outcome: applyResult.outcome,
      processed: this.deps.store.getState().runtime.processed,
      success: this.deps.store.getState().runtime.success,
      manualActions: this.deps.store.getState().runtime.manualActions,
    });

    // Mark vacancy as processed
    await this.deps.store.markVacancyProcessed(nextVacancy.vacancyId);

    if (applyResult.requiresManualAction && this.deps.store.getState().settings.stopOnManualAction) {
      FileLogger.log('service_worker', 'info', 'Manual action detected, stopOnManualAction enabled - pausing', {
        vacancyId: nextVacancy.vacancyId
      });
      await this.deps.store.setRuntimePhase('paused_manual_action', applyResult.outcome);
      return 'manual';
    }

    return 'ok';
  }

  private async checkSession(): Promise<boolean> {
    try {
      const authResult = await this.deps.httpClient.checkAuth();

      if (!authResult.authorized) {
        await this.deps.store.setRuntimeBlocker('login_required', 'Not authorized');
        FileLogger.log('service_worker', 'warn', 'Session check failed: not authorized');
        return false;
      }

      await this.deps.store.clearRuntimeBlocker();
      FileLogger.log('service_worker', 'info', 'Session check passed');
      return true;
    } catch (error) {
      await this.deps.store.setRuntimeBlocker('session_unknown', 'Session check failed');
      FileLogger.log('service_worker', 'error', 'Session check error', {
        error: (error as Error).message
      });
      return false;
    }
  }

  private async ensureResume(): Promise<boolean> {
    const state = this.deps.store.getState();

    // Check if current selection is valid
    if (state.selectedResumeHash) {
      const exists = state.resumeCandidates.some((r) => r.hash === state.selectedResumeHash);
      if (exists) {
        FileLogger.log('service_worker', 'info', 'Resume already valid', {
          hash: state.selectedResumeHash
        });
        return true;
      }
      FileLogger.log('service_worker', 'warn', 'Selected resume not in candidates, refreshing', {
        hash: state.selectedResumeHash
      });
    }

    // Try to select from existing candidates first
    if (!state.selectedResumeHash && state.resumeCandidates.length > 0) {
      FileLogger.log('service_worker', 'info', 'Auto-selecting from existing candidates', {
        count: state.resumeCandidates.length
      });
      await this.deps.store.selectResume(state.resumeCandidates[0].hash);
      return true;
    }

    // Fetch resumes via API
    FileLogger.log('service_worker', 'info', 'Resume auto-refresh started');
    try {
      const resumes = await this.deps.httpClient.getMyResumes();

      if (resumes.length === 0) {
        FileLogger.log('service_worker', 'warn', 'Resume recovery failed: no resumes found');
        return false;
      }

      FileLogger.log('service_worker', 'info', 'Resumes re-detected', {
        count: resumes.length
      });

      await this.deps.store.setResumeCandidates(
        resumes.map((r) => ({
          ...r,
          source: 'hh_detected' as const,
          lastSeenAt: Date.now(),
        }))
      );

      await this.deps.store.selectResume(resumes[0].hash);

      FileLogger.log('service_worker', 'info', 'Resume auto-selected', {
        hash: resumes[0].hash,
        title: resumes[0].title
      });

      return true;
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Resume recovery failed: API error', {
        error: (error as Error).message
      });
      return false;
    }
  }

  private async acquireVacancies(): Promise<boolean> {
    const state = this.deps.store.getState();
    const profileId = state.activeProfileId;

    if (!profileId) {
      FileLogger.log('service_worker', 'warn', 'No active profile');
      return false;
    }

    const profile = state.profiles[profileId];

    FileLogger.log('service_worker', 'info', 'Acquiring vacancies', {
      profileId,
      profileName: profile.name,
      keywords: profile.keywordsInclude.join(', '),
    });

    try {
      const apiVacancies = await this.deps.httpClient.fetchVacancies(profile);

      FileLogger.log('service_worker', 'info', 'API vacancies fetched', {
        count: apiVacancies.length,
      });

      if (apiVacancies.length === 0) {
        FileLogger.log('service_worker', 'warn', 'No vacancies found', {
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

      const beforeCount = state.vacancyQueue.length;
      await this.deps.store.materializeVacanciesFromSearch(cards, profileId);

      const afterState = this.deps.store.getState();
      const afterCount = afterState.vacancyQueue.length;
      const discoveredCount = afterState.vacancyQueue.filter((v) => v.status === 'discovered').length;

      FileLogger.log('service_worker', 'info', 'Vacancies materialized', {
        beforeCount,
        afterCount,
        newCount: afterCount - beforeCount,
        discoveredCount,
      });

      return true;
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Acquisition failed', {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
      return false;
    }
  }

  private async executeApply(vacancyId: string): Promise<{
    outcome: string;
    requiresManualAction: boolean;
  }> {
    const state = this.deps.store.getState();
    const profile = state.activeProfileId ? state.profiles[state.activeProfileId] : null;

    if (!state.selectedResumeHash) {
      FileLogger.log('service_worker', 'error', 'No resume selected');
      return { outcome: 'error', requiresManualAction: false };
    }

    try {
      // 1. Preflight check
      const preflight = await this.deps.httpClient.preflightApply(
        vacancyId,
        state.selectedResumeHash
      );

      FileLogger.log('service_worker', 'info', 'Preflight result', {
        vacancyId,
        canProceed: preflight.canProceed,
        reason: preflight.reason,
        alreadyApplied: preflight.alreadyApplied,
        requiresTest: preflight.requiresTest,
        requiresQuestionnaire: preflight.requiresQuestionnaire,
      });

      if (!preflight.canProceed) {
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

          FileLogger.log('service_worker', 'warn', 'Manual action required', {
            type: preflight.requiresTest ? 'test' : 'questionnaire',
            vacancyId,
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

        FileLogger.log('service_worker', 'warn', 'Preflight blocked', {
          vacancyId,
          reason: preflight.reason
        });
        return { outcome: 'error', requiresManualAction: false };
      }

      // 2. Apply
      const applyResult = await this.deps.httpClient.applyToVacancy(
        vacancyId,
        {
          resumeHash: state.selectedResumeHash,
          lux: true,
          ignorePostponed: true,
        },
        profile?.coverLetterTemplate
      );

      FileLogger.log('service_worker', 'info', 'Apply result', {
        vacancyId,
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
      FileLogger.log('service_worker', 'error', 'Apply error', {
        vacancyId,
        error: (error as Error).message,
      });

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
