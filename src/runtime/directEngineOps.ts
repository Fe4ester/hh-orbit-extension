/**
 * Direct Engine Operations
 *
 * Internal operations layer for DirectAutoApplyEngine.
 * Abstracts low-level details from engine logic.
 */

import { StateStore } from '../state/store';
import { VacancyAcquisitionService } from './vacancyAcquisitionService';

export interface DirectEngineOps {
  ensureSessionForAutoApply: () => Promise<{ ok: boolean; blocker?: string }>;
  ensureResumeForAutoApply: () => Promise<{ ok: boolean; resumeHash?: string }>;
  acquireVacanciesForProfile: (profileId: string) => Promise<{ ok: boolean; count: number }>;
  executeNextApplyAttempt: () => Promise<{
    ok: boolean;
    outcome?: string;
    requiresManualAction?: boolean;
  }>;
}

export interface DirectEngineOpsDeps {
  store: StateStore;
  vacancyAcquisition: VacancyAcquisitionService;
  checkRuntimeBlockers: () => Promise<{ success: boolean; status?: string; blocker?: string }>;
  detectResumes: () => Promise<{ success: boolean; candidates?: any[] }>;
  observeVacancyDetail: () => Promise<{ success: boolean; observation?: any; classification?: any }>;
  executeApply: (realClick: boolean) => Promise<{ success: boolean; result?: any }>;
  log: (...args: any[]) => void;
}

export function createDirectEngineOps(deps: DirectEngineOpsDeps): DirectEngineOps {
  return {
    async ensureSessionForAutoApply() {
      deps.log('[DirectOps] ensureSessionForAutoApply START');

      const result = await deps.checkRuntimeBlockers();

      if (!result.success) {
        deps.log('[DirectOps] Session check failed');
        return { ok: false, blocker: result.blocker || 'session_check_failed' };
      }

      const state = deps.store.getState();
      if (state.runtimeBlocker) {
        deps.log('[DirectOps] Runtime blocker detected', { blocker: state.runtimeBlocker });
        return { ok: false, blocker: state.runtimeBlocker };
      }

      deps.log('[DirectOps] Session OK');
      return { ok: true };
    },

    async ensureResumeForAutoApply() {
      deps.log('[DirectOps] ensureResumeForAutoApply START');

      const state = deps.store.getState();

      // Check if resume already selected
      if (state.selectedResumeHash) {
        const exists = state.resumeCandidates.some((r) => r.hash === state.selectedResumeHash);
        if (exists) {
          deps.log('[DirectOps] Resume already selected', { hash: state.selectedResumeHash });
          return { ok: true, resumeHash: state.selectedResumeHash };
        }
      }

      // Auto-detect resumes
      deps.log('[DirectOps] Auto-detecting resumes');
      const detectResult = await deps.detectResumes();

      if (!detectResult.success || !detectResult.candidates || detectResult.candidates.length === 0) {
        deps.log('[DirectOps] Resume detection failed or empty');
        return { ok: false };
      }

      // Auto-select first resume
      const firstResume = detectResult.candidates[0];
      await deps.store.selectResume(firstResume.hash);

      deps.log('[DirectOps] Resume auto-selected', { hash: firstResume.hash });
      return { ok: true, resumeHash: firstResume.hash };
    },

    async acquireVacanciesForProfile(profileId: string) {
      deps.log('[DirectOps] acquireVacanciesForProfile START', { profileId });

      const result = await deps.vacancyAcquisition.acquireForProfile(profileId);

      deps.log('[DirectOps] Acquisition result', { ok: result.ok, count: result.count });
      return result;
    },

    async executeNextApplyAttempt() {
      deps.log('[DirectOps] executeNextApplyAttempt START');

      const state = deps.store.getState();

      // Find next vacancy
      const nextVacancy = state.vacancyQueue.find((v) => v.status === 'discovered');
      if (!nextVacancy) {
        deps.log('[DirectOps] No vacancy in queue');
        return { ok: false };
      }

      deps.log('[DirectOps] Opening vacancy', {
        vacancyId: nextVacancy.vacancyId,
        url: nextVacancy.url,
      });

      // Open vacancy in hidden tab
      const tab = await chrome.tabs.create({
        url: nextVacancy.url,
        active: false, // Hidden tab
      });

      if (!tab.id || !tab.windowId || !tab.url) {
        deps.log('[DirectOps] Tab creation failed');
        return { ok: false };
      }

      // Bind tab for operations
      await deps.store.bindControlledTab(tab.id, tab.windowId, tab.url);
      await deps.store.updateState({
        liveMode: {
          ...deps.store.getState().liveMode,
          controlledTabPurpose: 'vacancy',
        },
      });

      // Wait for page load
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Observe vacancy detail
      const observeResult = await deps.observeVacancyDetail();
      if (!observeResult.success) {
        deps.log('[DirectOps] Vacancy observation failed');
        await chrome.tabs.remove(tab.id);
        return { ok: false };
      }

      // Execute apply
      const applyResult = await deps.executeApply(true);

      // Close tab
      await chrome.tabs.remove(tab.id);

      if (!applyResult.success || !applyResult.result) {
        deps.log('[DirectOps] Apply execution failed');
        return { ok: false };
      }

      const outcome = applyResult.result.outcome;
      const requiresManualAction =
        outcome === 'questionnaire_required' || outcome === 'manual_action_required';

      deps.log('[DirectOps] Apply complete', { outcome, requiresManualAction });

      return {
        ok: true,
        outcome,
        requiresManualAction,
      };
    },
  };
}
