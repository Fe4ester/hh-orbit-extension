/**
 * Live Auto Apply Engine
 *
 * Live mode: user sees all actions in CURRENT tab.
 * Uses controlledTabId (user's active tab), all actions visible.
 */

import { StateStore } from '../state/store';
import { AcquisitionService } from './acquisitionService';
import { FileLogger } from '../utils/fileLogger';
import { clickRespondButtonOnCard } from '../live/searchCardApplyExecutor';

export interface LiveEngineOps {
  checkRuntimeBlockers: () => Promise<{ success: boolean; blocker?: string }>;
  detectResumes: () => Promise<{ success: boolean; candidates?: any[] }>;
  observeVacancyDetail: () => Promise<{ success: boolean; observation?: any; classification?: any }>;
  executeApply: (realClick: boolean) => Promise<{ success: boolean; result?: any }>;
}

export interface LiveEngineDeps {
  store: StateStore;
  acquisitionService: AcquisitionService;
  ops: LiveEngineOps;
  sleep: (ms: number) => Promise<void>;
  log: (...args: any[]) => void;
}

export class LiveAutoApplyEngine {
  private running = false;
  private stopRequested = false;

  constructor(private deps: LiveEngineDeps) {}

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;

    this.deps.log('[LiveEngine] START');
    FileLogger.log('service_worker', 'info', 'LiveEngine START');

    try {
      await this.deps.store.dispatch('START_REQUESTED');
      await this.deps.store.dispatch('START_CONFIRMED');
      await this.deps.store.resetRuntimeCounters();

      // Initialize controlled tab
      const initResult = await this.initializeControlledTab();
      if (!initResult.success) {
        this.deps.log('[LiveEngine] Failed to initialize controlled tab', { error: initResult.error });
        FileLogger.log('service_worker', 'error', 'Failed to initialize controlled tab', { error: initResult.error });
        await this.deps.store.setRuntimePhase('paused_manual_action', initResult.error || 'controlled_tab_init_failed');
        return;
      }

      this.deps.log('[LiveEngine] Controlled tab initialized', {
        tabId: initResult.tabId,
        url: initResult.url
      });
      FileLogger.log('service_worker', 'info', 'Controlled tab initialized', { tabId: initResult.tabId, url: initResult.url });

      while (!this.stopRequested) {
        const state = this.deps.store.getState();
        if (state.runtime.processed >= state.settings.maxAutoAppliesPerRun) {
          this.deps.log('[LiveEngine] Run limit reached');
          break;
        }

        const cycleResult = await this.runCycle();
        if (cycleResult === 'blocked' || cycleResult === 'manual' || cycleResult === 'no_vacancies') {
          this.deps.log('[LiveEngine] Cycle stopped', { reason: cycleResult });
          break;
        }

        const delaySeconds = this.randomInRange(
          state.settings.delayMinSeconds,
          state.settings.delayMaxSeconds
        );
        this.deps.log('[LiveEngine] Waiting', { delaySeconds });
        await this.deps.store.setRuntimePhase('waiting');
        await this.deps.sleep(delaySeconds * 1000);
      }

      this.deps.log('[LiveEngine] Pipeline finished');
    } catch (error) {
      this.deps.log('[LiveEngine] Error:', error);
    } finally {
      await this.stopInternal();
    }
  }

  async stop(): Promise<void> {
    this.deps.log('[LiveEngine] STOP requested');
    this.stopRequested = true;
    if (!this.running) {
      await this.stopInternal();
    }
  }

  private async stopInternal(): Promise<void> {
    const currentState = this.deps.store.getState().runtimeState;

    this.deps.log('[LiveEngine] stopInternal', { currentState });

    if (currentState === 'STOPPED') {
      this.running = false;
      this.stopRequested = false;
      await this.deps.store.setRuntimePhase('idle', null);
      return;
    }

    if (currentState === 'ERROR') {
      this.running = false;
      this.stopRequested = false;
      await this.deps.store.updateState({ runtimeState: 'IDLE' });
      await this.deps.store.setRuntimePhase('idle', null);
      return;
    }

    if (['RUNNING', 'PAUSED_BY_USER', 'PAUSED_MANUAL_ACTION', 'PAUSED_NO_VACANCIES'].includes(currentState)) {
      await this.deps.store.dispatch('STOP_REQUESTED');
      await this.deps.store.dispatch('STOP_CONFIRMED');
    } else {
      await this.deps.store.updateState({ runtimeState: 'STOPPED' });
    }

    this.running = false;
    this.stopRequested = false;
    await this.deps.store.setRuntimePhase('idle', null);
  }

  private async runCycle(): Promise<'ok' | 'blocked' | 'manual' | 'no_vacancies'> {
    this.deps.log('[LiveEngine] Cycle start');
    FileLogger.log('service_worker', 'info', 'Cycle START');

    // Get controlled tab
    const state = this.deps.store.getState();
    let controlledTabId = state.liveMode.controlledTabId;

    this.deps.log('[LiveEngine] Controlled tab state', {
      controlledTabId,
      controlledTabPurpose: state.liveMode.controlledTabPurpose
    });

    if (!controlledTabId) {
      this.deps.log('[LiveEngine] No controlled tab, attempting reinit');
      const initResult = await this.initializeControlledTab();
      if (!initResult.success) {
        this.deps.log('[LiveEngine] ERROR: Failed to reinitialize controlled tab');
        await this.deps.store.setRuntimePhase('paused_manual_action', 'controlled_tab_lost');
        return 'blocked';
      }
      controlledTabId = initResult.tabId!;
    }

    // 1. Check session
    await this.deps.store.setRuntimePhase('session_check');
    const blockerResult = await this.deps.ops.checkRuntimeBlockers();

    if (!blockerResult.success || this.deps.store.getState().runtimeBlocker) {
      this.deps.log('[LiveEngine] Blocked', { blocker: this.deps.store.getState().runtimeBlocker });
      FileLogger.log('service_worker', 'warn', 'Cycle blocked by auth', { blocker: this.deps.store.getState().runtimeBlocker });
      await this.deps.store.setRuntimePhase('paused_auth', this.deps.store.getState().runtimeBlocker || 'auth required');
      return 'blocked';
    }

    // 2. Check resume
    await this.deps.store.setRuntimePhase('resume_check');
    let currentState = this.deps.store.getState();
    const selectedExists =
      !!currentState.selectedResumeHash &&
      currentState.resumeCandidates.some((r) => r.hash === currentState.selectedResumeHash);

    if (!selectedExists) {
      await this.deps.ops.detectResumes();
      currentState = this.deps.store.getState();
      if (!currentState.selectedResumeHash && currentState.resumeCandidates.length > 0) {
        await this.deps.store.selectResume(currentState.resumeCandidates[0].hash);
      }
      currentState = this.deps.store.getState();
      if (!currentState.selectedResumeHash) {
        await this.deps.store.setRuntimePhase('paused_manual_action', 'resume_not_found');
        return 'manual';
      }
    }

    // 3. Acquire vacancies
    const activeProfileId = currentState.activeProfileId;
    if (!activeProfileId) {
      await this.deps.store.setRuntimePhase('paused_manual_action', 'no_active_profile');
      return 'no_vacancies';
    }

    // Clean processed vacancies from queue
    currentState = this.deps.store.getState();
    const currentQueue = currentState.vacancyQueue;
    const processedCount = currentQueue.filter(v => v.status === 'processed').length;

    if (processedCount > 0) {
      FileLogger.log('service_worker', 'info', 'Cleaning processed vacancies', { count: processedCount });

      const cleanedQueue = currentQueue.filter(v => v.status !== 'processed');
      await this.deps.store.updateState({
        vacancyQueue: cleanedQueue
      });
    }

    // Check if we have discovered vacancies in queue
    currentState = this.deps.store.getState();
    const hasDiscovered = currentState.vacancyQueue.some(v => v.status === 'discovered');

    if (!hasDiscovered) {
      // Queue empty, need to acquire new vacancies
      FileLogger.log('service_worker', 'info', 'Queue empty, acquiring new vacancies');
      await this.deps.store.setRuntimePhase('search');

      const acquisitionResult = await this.deps.acquisitionService.acquireForProfile(activeProfileId);

      if (!acquisitionResult.success) {
        await this.deps.store.setRuntimePhase('paused_manual_action', acquisitionResult.error || 'acquisition_failed');
        return 'no_vacancies';
      }

      if (acquisitionResult.newQueued === 0) {
        // No new vacancies on current page, try next page
        FileLogger.log('service_worker', 'info', 'No new vacancies, trying next page');

        try {
          const nextPageResult = await chrome.tabs.sendMessage(controlledTabId, {
            type: 'CLICK_NEXT_PAGE'
          });

          if (nextPageResult.clicked) {
            FileLogger.log('service_worker', 'info', 'Clicked next page, waiting for load');
            await this.deps.sleep(3000);

            // Try acquisition again on new page
            return 'ok';
          } else {
            FileLogger.log('service_worker', 'info', 'No next page button, end of results');
            await this.deps.store.setRuntimePhase('paused_no_vacancies', 'end_of_results');
            return 'no_vacancies';
          }
        } catch (error) {
          FileLogger.log('service_worker', 'error', 'Failed to click next page', {
            error: (error as Error).message
          });
          await this.deps.store.setRuntimePhase('paused_no_vacancies', 'no_new_vacancies');
          return 'no_vacancies';
        }
      }
    } else {
      FileLogger.log('service_worker', 'info', 'Using cached vacancies from queue');
    }

    // 4. Get next vacancy
    currentState = this.deps.store.getState();
    const nextVacancy = currentState.vacancyQueue.find((item) => item.status === 'discovered');
    if (!nextVacancy) {
      FileLogger.log('service_worker', 'warn', 'Queue empty');
      await this.deps.store.setRuntimePhase('paused_no_vacancies', 'queue_empty');
      return 'no_vacancies';
    }

    this.deps.log('[LiveEngine] Processing vacancy', { vacancyId: nextVacancy.vacancyId, url: nextVacancy.url });
    FileLogger.log('service_worker', 'info', 'Processing vacancy on search page', { vacancyId: nextVacancy.vacancyId });

    // 5. Click respond button on card (NO NAVIGATION)
    await this.deps.store.setRuntimePhase('apply');

    const clickResult = await clickRespondButtonOnCard(
      controlledTabId,
      nextVacancy.cardIndex || 0,
      nextVacancy.vacancyId || ''
    );

    if (!clickResult.success) {
      this.deps.log('[LiveEngine] Failed to click respond button', clickResult);
      FileLogger.log('service_worker', 'warn', 'Failed to click respond button', clickResult);
      await this.deps.store.markVacancyProcessed(nextVacancy.vacancyId || '');
      return 'ok';
    }

    // 6. Wait for modal to appear
    FileLogger.log('service_worker', 'info', 'Waiting for modal (500ms)');
    await this.deps.sleep(500);

    // 7. Try to handle modal
    let modalHandled = false;
    try {
      currentState = this.deps.store.getState();
      const profile = Object.values(currentState.profiles).find(p => p.id === nextVacancy.profileId);
      const coverLetterText = profile?.coverLetterTemplate || 'Здравствуйте! Заинтересован в данной вакансии.';

      FileLogger.log('service_worker', 'info', 'Calling HANDLE_ANY_MODAL');

      const modalCheck = await chrome.tabs.sendMessage(controlledTabId, {
        type: 'HANDLE_ANY_MODAL',
        coverLetter: coverLetterText
      });

      FileLogger.log('service_worker', 'info', 'Modal check result', modalCheck);

      if (modalCheck?.handled) {
        modalHandled = true;
        FileLogger.log('service_worker', 'info', 'Modal handled', {
          hadTextarea: modalCheck.hadTextarea,
          buttonClicked: modalCheck.buttonClicked
        });

        // Wait for modal to close
        await this.deps.sleep(500);
      }
    } catch (error) {
      FileLogger.log('service_worker', 'warn', 'Modal check failed', {
        error: (error as Error).message
      });
    }

    if (modalHandled) {
      // Success - modal was handled
      FileLogger.log('service_worker', 'info', 'Apply success (modal)');

      await this.deps.store.incrementRuntimeCounters({
        processed: 1,
        success: 1,
      });

      await this.deps.store.markVacancyProcessed(nextVacancy.vacancyId || '');
      return 'ok';
    }

    // 8. No modal - check for redirect (wait longer for redirect to happen)
    FileLogger.log('service_worker', 'info', 'No modal, checking redirect');

    // Wait for redirect to happen (1.5 seconds)
    await this.deps.sleep(1500);

    const tab = await chrome.tabs.get(controlledTabId);
    let currentUrl = tab.url || '';

    FileLogger.log('service_worker', 'info', 'Current URL after wait', { url: currentUrl });

    // Check if redirected away from search page
    let isSearchPage = currentUrl.includes('hh.ru/search/vacancy') ||
                       currentUrl.includes('hh.ru/applicant/vacancy_search');

    // If still on search page, wait a bit more and check again
    if (isSearchPage) {
      FileLogger.log('service_worker', 'info', 'Still on search page, waiting more');
      await this.deps.sleep(1000);

      const tab2 = await chrome.tabs.get(controlledTabId);
      currentUrl = tab2.url || '';
      isSearchPage = currentUrl.includes('hh.ru/search/vacancy') ||
                     currentUrl.includes('hh.ru/applicant/vacancy_search');

      FileLogger.log('service_worker', 'info', 'URL after second check', { url: currentUrl, isSearchPage });
    }

    if (!isSearchPage) {
      // Redirected - check if it's a test/questionnaire
      FileLogger.log('service_worker', 'info', 'Redirect detected, checking type');

      try {
        const testCheck = await chrome.tabs.sendMessage(controlledTabId, {
          type: 'CHECK_TEST_REQUIRED'
        });

        FileLogger.log('service_worker', 'info', 'Test check result', testCheck);

        if (testCheck?.testRequired) {
          // Test/questionnaire - add to manual actions
          FileLogger.log('service_worker', 'warn', 'Test required, adding to manual');

          await this.deps.store.createManualAction({
            type: 'questionnaire',
            vacancyId: nextVacancy.vacancyId,
            vacancyTitle: nextVacancy.title,
            company: nextVacancy.company,
            url: currentUrl,
            profileId: nextVacancy.profileId,
            reasonCode: 'questionnaire_required',
            status: 'pending',
          });

          await this.deps.store.addToSkipList(
            nextVacancy.vacancyId || '',
            24 * 60 * 60 * 1000,
            'test'
          );

          await this.deps.store.incrementRuntimeCounters({
            processed: 1,
            manualActions: 1,
          });

          // Go back to search page
          await chrome.tabs.sendMessage(controlledTabId, { type: 'GO_BACK' });
          await this.deps.sleep(2000);

          await this.deps.store.markVacancyProcessed(nextVacancy.vacancyId || '');
          return 'ok';
        }

        // Not a test - it's a normal response page, check for cover letter
        FileLogger.log('service_worker', 'info', 'Normal response page, checking cover letter');

        const coverLetterCheck = await chrome.tabs.sendMessage(controlledTabId, {
          type: 'DETECT_COVER_LETTER_UI'
        });

        if (coverLetterCheck?.visible || coverLetterCheck?.textareaFound) {
          // Fill and submit
          FileLogger.log('service_worker', 'info', 'Cover letter UI found, filling');

          currentState = this.deps.store.getState();
          const profile = Object.values(currentState.profiles).find(p => p.id === nextVacancy.profileId);
          const coverLetterText = profile?.coverLetterTemplate || 'Здравствуйте! Заинтересован в данной вакансии.';

          await chrome.tabs.sendMessage(controlledTabId, {
            type: 'FILL_COVER_LETTER',
            text: coverLetterText
          });

          await this.deps.sleep(300);

          await chrome.tabs.sendMessage(controlledTabId, {
            type: 'CLICK_SUBMIT'
          });

          await this.deps.sleep(1000);
        }

        // Success
        FileLogger.log('service_worker', 'info', 'Apply success (redirect)');

        await this.deps.store.incrementRuntimeCounters({
          processed: 1,
          success: 1,
        });

        await this.deps.store.markVacancyProcessed(nextVacancy.vacancyId || '');

        // Go back
        await chrome.tabs.sendMessage(controlledTabId, { type: 'GO_BACK' });
        await this.deps.sleep(2000);

        return 'ok';

      } catch (error) {
        FileLogger.log('service_worker', 'error', 'Redirect handling failed', {
          error: (error as Error).message
        });

        // Go back anyway
        try {
          await chrome.tabs.sendMessage(controlledTabId, { type: 'GO_BACK' });
          await this.deps.sleep(2000);
        } catch (e) {
          // ignore
        }

        await this.deps.store.markVacancyProcessed(nextVacancy.vacancyId || '');
        return 'ok';
      }
    }

    // Still on search page - no modal, no redirect
    // This means the click didn't do anything (maybe already applied)
    FileLogger.log('service_worker', 'warn', 'No modal and no redirect - marking as processed');

    await this.deps.store.markVacancyProcessed(nextVacancy.vacancyId || '');
    return 'ok';
  }

  private async waitForPageLoad(tabId: number): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.deps.log('[LiveEngine] Page load timeout');
        resolve();
      }, 10000);

      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          this.deps.log('[LiveEngine] Page loaded');
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  private randomInRange(min: number, max: number): number {
    const lo = Math.max(1, Math.min(min, max));
    const hi = Math.max(min, max);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }

  private async initializeControlledTab(): Promise<{ success: boolean; tabId?: number; url?: string; error?: string }> {
    this.deps.log('[LiveEngine] Initializing controlled tab');

    // Check if already have controlled tab
    const state = this.deps.store.getState();
    if (state.liveMode.controlledTabId) {
      try {
        const tab = await chrome.tabs.get(state.liveMode.controlledTabId);
        if (tab && tab.url?.includes('hh.ru')) {
          const url = tab.url || '';
          const isSearchPage = url.includes('/search/vacancy') || url.includes('/applicant/vacancy_search');

          if (!isSearchPage) {
            FileLogger.log('service_worker', 'warn', 'Not on search page, navigating', { url });

            // Get search URL from active profile
            const activeProfileId = state.activeProfileId;
            const profile = activeProfileId ? state.profiles[activeProfileId] : null;
            const searchUrl = profile ? `https://hh.ru/search/vacancy?text=${encodeURIComponent(profile.keywordsInclude.join(' '))}` : 'https://hh.ru/search/vacancy';

            await chrome.tabs.update(tab.id!, { url: searchUrl, active: true });
            await this.waitForPageLoad(tab.id!);

            FileLogger.log('service_worker', 'info', 'Navigated to search page', { searchUrl });
            return { success: true, tabId: tab.id, url: searchUrl };
          }

          this.deps.log('[LiveEngine] Using existing controlled tab', { tabId: tab.id, url: tab.url });
          return { success: true, tabId: tab.id, url: tab.url };
        }
      } catch (error) {
        this.deps.log('[LiveEngine] Existing controlled tab not found', error);
      }
    }

    // Get active profile for search URL
    const activeProfileId = state.activeProfileId;
    if (!activeProfileId) {
      return { success: false, error: 'no_active_profile' };
    }

    const profile = state.profiles[activeProfileId];
    if (!profile) {
      return { success: false, error: 'profile_not_found' };
    }

    // Build search URL using existing helper
    const searchUrl = `https://hh.ru/search/vacancy?text=${encodeURIComponent(profile.keywordsInclude.join(' '))}`;

    // Try to get current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tabs.length > 0) {
      const tab = tabs[0];
      if (!tab.id || tab.windowId === undefined) {
        this.deps.log('[LiveEngine] Active tab missing id or windowId');
        // Fallback to creating new tab
      } else {
        const tabId = tab.id;
        const windowId = tab.windowId;

        this.deps.log('[LiveEngine] Found active tab', { tabId, url: tab.url });

        // If already on HH.ru, bind it
        if (tab.url?.includes('hh.ru')) {
          await this.deps.store.bindControlledTab(tabId, windowId, tab.url);
          this.deps.log('[LiveEngine] Bound existing HH.ru tab');
          return { success: true, tabId, url: tab.url };
        }

        // Navigate current tab to search
        await chrome.tabs.update(tabId, { url: searchUrl, active: true });
        await this.waitForPageLoad(tabId);

        await this.deps.store.bindControlledTab(tabId, windowId, searchUrl);
        this.deps.log('[LiveEngine] Navigated active tab to search');
        return { success: true, tabId, url: searchUrl };
      }
    }

    // Fallback: create new tab
    this.deps.log('[LiveEngine] No active tab, creating new one');
    const newTab = await chrome.tabs.create({ url: searchUrl, active: true });

    if (!newTab.id || !newTab.windowId) {
      return { success: false, error: 'failed_to_create_tab' };
    }

    await this.waitForPageLoad(newTab.id);

    await this.deps.store.bindControlledTab(newTab.id, newTab.windowId, searchUrl);
    this.deps.log('[LiveEngine] Created new controlled tab');
    return { success: true, tabId: newTab.id, url: searchUrl };
  }
}
