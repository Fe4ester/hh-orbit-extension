/**
 * Live Auto Apply Engine V2
 *
 * Production-grade architecture with state machine, retry logic, and clear error handling.
 */

import { StateStore } from '../state/store';
import { AcquisitionService } from './acquisitionService';
import { FileLogger } from '../utils/fileLogger';
import { VacancyQueueItem } from '../state/types';

// State machine states
type VacancyState =
  | 'pending'
  | 'validating'
  | 'clicking'
  | 'waiting_response'
  | 'handling_modal'
  | 'handling_redirect'
  | 'success'
  | 'manual_action'
  | 'failed'
  | 'skipped';

// Processing context for a single vacancy
interface VacancyContext {
  vacancy: VacancyQueueItem;
  state: VacancyState;
  attempt: number;
  maxAttempts: number;
  errors: string[];
  metadata: {
    startTime: number;
    clickAttempts: number;
    modalDetected: boolean;
    redirectDetected: boolean;
    redirectUrl?: string;
  };
}

// Result of processing
interface ProcessingResult {
  success: boolean;
  outcome: 'success' | 'manual_action' | 'skipped' | 'failed';
  reason?: string;
  context: VacancyContext;
}

export interface LiveEngineV2Deps {
  store: StateStore;
  acquisitionService: AcquisitionService;
  sleep: (ms: number) => Promise<void>;
  log: (...args: any[]) => void;
}

export class LiveAutoApplyEngineV2 {
  private running = false;
  private stopRequested = false;

  constructor(private deps: LiveEngineV2Deps) {}

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;

    FileLogger.log('service_worker', 'info', 'LiveEngineV2 START');

    try {
      await this.deps.store.dispatch('START_REQUESTED');
      await this.deps.store.dispatch('START_CONFIRMED');
      await this.deps.store.resetRuntimeCounters();

      // Initialize controlled tab
      const initResult = await this.initializeControlledTab();
      if (!initResult.success) {
        FileLogger.log('service_worker', 'error', 'Failed to initialize controlled tab', { error: initResult.error });
        await this.deps.store.setRuntimePhase('paused_manual_action', initResult.error || 'controlled_tab_init_failed');
        return;
      }

      FileLogger.log('service_worker', 'info', 'Controlled tab initialized', { tabId: initResult.tabId });

      // Main loop
      while (!this.stopRequested) {
        const state = this.deps.store.getState();
        if (state.runtime.processed >= state.settings.maxAutoAppliesPerRun) {
          FileLogger.log('service_worker', 'info', 'Run limit reached');
          break;
        }

        const cycleResult = await this.runCycle();
        if (cycleResult === 'blocked' || cycleResult === 'no_vacancies') {
          FileLogger.log('service_worker', 'info', 'Cycle stopped', { reason: cycleResult });
          break;
        }

        // Delay between vacancies
        const delaySeconds = this.randomInRange(
          state.settings.delayMinSeconds,
          state.settings.delayMaxSeconds
        );
        FileLogger.log('service_worker', 'info', 'Waiting between vacancies', { delaySeconds });
        await this.deps.store.setRuntimePhase('waiting');
        await this.deps.sleep(delaySeconds * 1000);
      }

      FileLogger.log('service_worker', 'info', 'Pipeline finished');
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Engine error', { error: (error as Error).message });
    } finally {
      await this.stopInternal();
    }
  }

  async stop(): Promise<void> {
    FileLogger.log('service_worker', 'info', 'STOP requested');
    this.stopRequested = true;
    if (!this.running) {
      await this.stopInternal();
    }
  }

  private async stopInternal(): Promise<void> {
    const currentState = this.deps.store.getState().runtimeState;

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

  private async runCycle(): Promise<'ok' | 'blocked' | 'no_vacancies'> {
    FileLogger.log('service_worker', 'info', 'Cycle START');

    // Get controlled tab
    const state = this.deps.store.getState();
    let controlledTabId = state.liveMode.controlledTabId;

    if (!controlledTabId) {
      FileLogger.log('service_worker', 'error', 'No controlled tab');
      await this.deps.store.setRuntimePhase('paused_manual_action', 'controlled_tab_lost');
      return 'blocked';
    }

    // Check session
    await this.deps.store.setRuntimePhase('session_check');
    if (this.deps.store.getState().runtimeBlocker) {
      FileLogger.log('service_worker', 'warn', 'Blocked by auth');
      await this.deps.store.setRuntimePhase('paused_auth', this.deps.store.getState().runtimeBlocker || 'auth required');
      return 'blocked';
    }

    // Check resume
    await this.deps.store.setRuntimePhase('resume_check');
    const currentState = this.deps.store.getState();
    if (!currentState.selectedResumeHash) {
      await this.deps.store.setRuntimePhase('paused_manual_action', 'resume_not_found');
      return 'blocked';
    }

    // Acquire vacancies if needed
    const activeProfileId = currentState.activeProfileId;
    if (!activeProfileId) {
      await this.deps.store.setRuntimePhase('paused_manual_action', 'no_active_profile');
      return 'no_vacancies';
    }

    // Clean processed vacancies
    const processedCount = currentState.vacancyQueue.filter(v => v.status === 'processed').length;
    if (processedCount > 0) {
      FileLogger.log('service_worker', 'info', 'Cleaning processed vacancies', { count: processedCount });
      const cleanedQueue = currentState.vacancyQueue.filter(v => v.status !== 'processed');
      await this.deps.store.updateState({ vacancyQueue: cleanedQueue });
    }

    // Check if we have discovered vacancies
    const hasDiscovered = this.deps.store.getState().vacancyQueue.some(v => v.status === 'discovered');

    if (!hasDiscovered) {
      FileLogger.log('service_worker', 'info', 'Queue empty, acquiring');
      await this.deps.store.setRuntimePhase('search');

      const acquisitionResult = await this.deps.acquisitionService.acquireForProfile(activeProfileId);

      if (!acquisitionResult.success || acquisitionResult.newQueued === 0) {
        FileLogger.log('service_worker', 'info', 'No new vacancies');
        await this.deps.store.setRuntimePhase('paused_no_vacancies', 'no_new_vacancies');
        return 'no_vacancies';
      }
    }

    // Get next vacancy
    const nextVacancy = this.deps.store.getState().vacancyQueue.find(item => item.status === 'discovered');
    if (!nextVacancy) {
      FileLogger.log('service_worker', 'warn', 'Queue empty');
      await this.deps.store.setRuntimePhase('paused_no_vacancies', 'queue_empty');
      return 'no_vacancies';
    }

    // Process vacancy
    await this.deps.store.setRuntimePhase('apply');
    const result = await this.processSingleVacancy(nextVacancy, controlledTabId);

    // Update counters
    if (result.outcome === 'success') {
      await this.deps.store.incrementRuntimeCounters({ processed: 1, success: 1 });
    } else if (result.outcome === 'manual_action') {
      await this.deps.store.incrementRuntimeCounters({ processed: 1, manualActions: 1 });
    } else {
      await this.deps.store.incrementRuntimeCounters({ processed: 1 });
    }

    // Mark as processed
    FileLogger.log('service_worker', 'info', 'Marking vacancy as processed', {
      vacancyId: nextVacancy.vacancyId,
      outcome: result.outcome
    });

    await this.deps.store.markVacancyProcessed(nextVacancy.vacancyId || '');

    FileLogger.log('service_worker', 'info', 'Vacancy marked as processed', {
      vacancyId: nextVacancy.vacancyId
    });

    return 'ok';
  }

  /**
   * Main pipeline: process single vacancy
   */
  private async processSingleVacancy(vacancy: VacancyQueueItem, tabId: number): Promise<ProcessingResult> {
    const context: VacancyContext = {
      vacancy,
      state: 'pending',
      attempt: 0,
      maxAttempts: 2,
      errors: [],
      metadata: {
        startTime: Date.now(),
        clickAttempts: 0,
        modalDetected: false,
        redirectDetected: false,
      },
    };

    FileLogger.log('service_worker', 'info', 'Processing vacancy', {
      vacancyId: vacancy.vacancyId,
      title: vacancy.title?.substring(0, 50),
    });

    try {
      // Step 1: Validate
      context.state = 'validating';
      const validationResult = await this.validateVacancy(context, tabId);
      if (!validationResult.valid) {
        context.state = 'skipped';
        FileLogger.log('service_worker', 'info', 'Vacancy skipped', {
          vacancyId: vacancy.vacancyId,
          reason: validationResult.reason,
        });
        return { success: false, outcome: 'skipped', reason: validationResult.reason, context };
      }

      // Step 2: Click with retry
      context.state = 'clicking';
      const clickResult = await this.clickWithRetry(context, tabId);
      if (!clickResult.success) {
        context.state = 'skipped';
        FileLogger.log('service_worker', 'warn', 'Click failed after retries', { vacancyId: vacancy.vacancyId });
        return { success: false, outcome: 'skipped', reason: 'click_failed', context };
      }

      // Step 3: Detect response
      context.state = 'waiting_response';
      const responseType = await this.detectResponse(context, tabId);

      // Step 4: Handle response
      if (responseType === 'modal') {
        context.state = 'handling_modal';
        const modalResult = await this.handleModal(context, tabId);
        if (modalResult.success) {
          context.state = 'success';
          FileLogger.log('service_worker', 'info', 'Vacancy processed: success (modal)', { vacancyId: vacancy.vacancyId });
          return { success: true, outcome: 'success', context };
        }
        // Fallback to redirect check if modal handling failed
        FileLogger.log('service_worker', 'warn', 'Modal handling failed, checking redirect', { vacancyId: vacancy.vacancyId });
      }

      if (responseType === 'redirect' || responseType === 'unknown') {
        context.state = 'handling_redirect';
        const redirectResult = await this.handleRedirect(context, tabId);

        if (redirectResult.outcome === 'test') {
          context.state = 'manual_action';
          FileLogger.log('service_worker', 'info', 'Vacancy processed: manual_action (test)', { vacancyId: vacancy.vacancyId });
          return { success: true, outcome: 'manual_action', reason: 'test_required', context };
        } else if (redirectResult.outcome === 'success') {
          context.state = 'success';
          FileLogger.log('service_worker', 'info', 'Vacancy processed: success (redirect)', { vacancyId: vacancy.vacancyId });
          return { success: true, outcome: 'success', context };
        }
      }

      // No response detected
      context.state = 'skipped';
      FileLogger.log('service_worker', 'info', 'Vacancy processed: skipped (no response)', { vacancyId: vacancy.vacancyId });
      return { success: false, outcome: 'skipped', reason: 'no_response', context };

    } catch (error) {
      context.state = 'failed';
      context.errors.push((error as Error).message);
      FileLogger.log('service_worker', 'error', 'Vacancy processing failed', {
        vacancyId: vacancy.vacancyId,
        error: (error as Error).message,
      });
      return { success: false, outcome: 'failed', reason: (error as Error).message, context };
    }
  }

  /**
   * Step 1: Validate vacancy exists and is clickable
   */
  private async validateVacancy(context: VacancyContext, tabId: number): Promise<{ valid: boolean; reason?: string }> {
    FileLogger.log('service_worker', 'info', 'Validating vacancy', { vacancyId: context.vacancy.vacancyId });

    try {
      const result = await chrome.tabs.sendMessage(tabId, {
        type: 'VALIDATE_VACANCY',
        vacancyId: context.vacancy.vacancyId,
      });

      if (!result.exists) {
        return { valid: false, reason: 'not_on_page' };
      }

      if (result.alreadyApplied) {
        return { valid: false, reason: 'already_applied' };
      }

      FileLogger.log('service_worker', 'info', 'Vacancy valid', { vacancyId: context.vacancy.vacancyId });
      return { valid: true };
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Validation failed', {
        vacancyId: context.vacancy.vacancyId,
        error: (error as Error).message,
      });
      return { valid: false, reason: 'validation_error' };
    }
  }

  /**
   * Step 2: Click respond button with retry (max 3 attempts)
   */
  private async clickWithRetry(context: VacancyContext, tabId: number): Promise<{ success: boolean }> {
    const maxClickAttempts = 3;

    for (let i = 0; i < maxClickAttempts; i++) {
      context.metadata.clickAttempts = i + 1;
      FileLogger.log('service_worker', 'info', 'Clicking respond button', {
        vacancyId: context.vacancy.vacancyId,
        attempt: i + 1,
      });

      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          type: 'CLICK_RESPOND_BUTTON',
          vacancyId: context.vacancy.vacancyId,
        });

        if (result.success) {
          FileLogger.log('service_worker', 'info', 'Click successful', { vacancyId: context.vacancy.vacancyId });
          return { success: true };
        }

        FileLogger.log('service_worker', 'warn', 'Click failed', {
          vacancyId: context.vacancy.vacancyId,
          attempt: i + 1,
        });

        if (i < maxClickAttempts - 1) {
          await this.deps.sleep(300);
        }
      } catch (error) {
        FileLogger.log('service_worker', 'error', 'Click error', {
          vacancyId: context.vacancy.vacancyId,
          attempt: i + 1,
          error: (error as Error).message,
        });

        if (i < maxClickAttempts - 1) {
          await this.deps.sleep(300);
        }
      }
    }

    return { success: false };
  }

  /**
   * Step 3: Detect response type (modal/redirect/none)
   */
  private async detectResponse(context: VacancyContext, tabId: number): Promise<'modal' | 'redirect' | 'unknown'> {
    FileLogger.log('service_worker', 'info', 'Detecting response type', { vacancyId: context.vacancy.vacancyId });

    // Check for modal with retry (3 attempts over 1.5 seconds)
    for (let i = 0; i < 3; i++) {
      await this.deps.sleep(500);

      try {
        const modalCheck = await chrome.tabs.sendMessage(tabId, {
          type: 'CHECK_MODAL_EXISTS',
        });

        if (modalCheck?.exists) {
          FileLogger.log('service_worker', 'info', 'Modal detected', {
            vacancyId: context.vacancy.vacancyId,
            attempt: i + 1
          });
          context.metadata.modalDetected = true;
          return 'modal';
        }

        FileLogger.log('service_worker', 'debug', 'No modal yet', {
          vacancyId: context.vacancy.vacancyId,
          attempt: i + 1
        });
      } catch (error) {
        // Content script not responding, might have redirected
        FileLogger.log('service_worker', 'debug', 'Modal check failed', {
          attempt: i + 1,
          error: (error as Error).message
        });
        break;
      }
    }

    // No modal after 1.5s, check for redirect
    FileLogger.log('service_worker', 'info', 'No modal detected, checking redirect');

    await this.deps.sleep(500);

    try {
      const tab = await chrome.tabs.get(tabId);
      const currentUrl = tab.url || '';

      const isSearchPage =
        currentUrl.includes('hh.ru/search/vacancy') ||
        currentUrl.includes('hh.ru/applicant/vacancy_search');

      if (!isSearchPage) {
        FileLogger.log('service_worker', 'info', 'Redirect detected', { url: currentUrl });
        context.metadata.redirectDetected = true;
        context.metadata.redirectUrl = currentUrl;
        return 'redirect';
      }

      FileLogger.log('service_worker', 'info', 'Still on search page, no response', { url: currentUrl });
      return 'unknown';
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Failed to check redirect', { error: (error as Error).message });
      return 'unknown';
    }
  }

  /**
   * Step 4a: Handle modal with explicit classification
   */
  private async handleModal(context: VacancyContext, tabId: number): Promise<{ success: boolean }> {
    FileLogger.log('service_worker', 'info', 'POST_CLICK_MODAL_CHECK', { vacancyId: context.vacancy.vacancyId });

    try {
      // Classify modal type first
      const modalTypeCheck = await chrome.tabs.sendMessage(tabId, {
        type: 'CHECK_MODAL_TYPE',
      });

      FileLogger.log('service_worker', 'info', 'POST_CLICK_MODAL_RESULT', {
        vacancyId: context.vacancy.vacancyId,
        hasModal: modalTypeCheck?.hasModal,
        hasConfirmation: modalTypeCheck?.hasConfirmation,
        hasCoverLetter: modalTypeCheck?.hasCoverLetter,
      });

      // EXPLICIT COUNTRY-CONFIRM BRANCH
      if (modalTypeCheck?.hasConfirmation) {
        FileLogger.log('service_worker', 'info', 'COUNTRY_CONFIRM_DETECTED', {
          vacancyId: context.vacancy.vacancyId,
          modalText: modalTypeCheck.modalText?.substring(0, 100),
        });

        // Click confirmation button
        const confirmClick = await chrome.tabs.sendMessage(tabId, {
          type: 'CLICK_MODAL_CONFIRM',
        });

        if (!confirmClick?.clicked) {
          FileLogger.log('service_worker', 'error', 'COUNTRY_CONFIRM_FAILED', {
            vacancyId: context.vacancy.vacancyId,
            reason: 'button_not_clicked',
            error: confirmClick?.error,
          });
          return { success: false };
        }

        FileLogger.log('service_worker', 'info', 'COUNTRY_CONFIRM_CLICKED', {
          vacancyId: context.vacancy.vacancyId,
        });

        // Wait for modal to close
        await this.deps.sleep(500);

        // Check next state
        const nextStateCheck = await chrome.tabs.sendMessage(tabId, {
          type: 'CHECK_MODAL_TYPE',
        });

        if (!nextStateCheck?.hasModal) {
          // Modal dismissed - success
          FileLogger.log('service_worker', 'info', 'COUNTRY_CONFIRM_DISMISSED', {
            vacancyId: context.vacancy.vacancyId,
          });
          return { success: true };
        }

        // Next modal appeared - handle it
        if (nextStateCheck?.hasCoverLetter) {
          FileLogger.log('service_worker', 'info', 'Cover letter modal after confirm', {
            vacancyId: context.vacancy.vacancyId,
          });
          // Fall through to cover letter handling below
          return await this.handleCoverLetterModal(context, tabId);
        }

        // Unknown next modal
        FileLogger.log('service_worker', 'error', 'COUNTRY_CONFIRM_FAILED', {
          vacancyId: context.vacancy.vacancyId,
          reason: 'unknown_next_modal',
        });
        return { success: false };
      }

      // Cover letter modal (no country confirm)
      if (modalTypeCheck?.hasCoverLetter) {
        return await this.handleCoverLetterModal(context, tabId);
      }

      // Unknown modal type
      FileLogger.log('service_worker', 'warn', 'Unknown modal type', {
        vacancyId: context.vacancy.vacancyId,
      });
      return { success: false };

    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Modal handling error', {
        vacancyId: context.vacancy.vacancyId,
        error: (error as Error).message,
      });
      return { success: false };
    }
  }

  /**
   * Handle cover letter modal
   */
  private async handleCoverLetterModal(context: VacancyContext, tabId: number): Promise<{ success: boolean }> {
    FileLogger.log('service_worker', 'info', 'Handling cover letter modal', { vacancyId: context.vacancy.vacancyId });

    try {
      // Get cover letter from profile
      const state = this.deps.store.getState();
      const profile = Object.values(state.profiles).find(p => p.id === context.vacancy.profileId);
      const coverLetter = profile?.coverLetterTemplate || 'Здравствуйте! Заинтересован в данной вакансии.';

      const result = await chrome.tabs.sendMessage(tabId, {
        type: 'HANDLE_MODAL',
        coverLetter,
      });

      if (result.handled) {
        FileLogger.log('service_worker', 'info', 'Cover letter modal handled', { vacancyId: context.vacancy.vacancyId });
        await this.deps.sleep(500);
        return { success: true };
      }

      FileLogger.log('service_worker', 'warn', 'Cover letter modal not handled', { vacancyId: context.vacancy.vacancyId });
      return { success: false };
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Cover letter modal error', {
        vacancyId: context.vacancy.vacancyId,
        error: (error as Error).message,
      });
      return { success: false };
    }
  }

  /**
   * Step 4b: Handle redirect
   */
  private async handleRedirect(context: VacancyContext, tabId: number): Promise<{ outcome: 'test' | 'success' | 'failed' }> {
    FileLogger.log('service_worker', 'info', 'REDIRECT_CLASSIFICATION', {
      vacancyId: context.vacancy.vacancyId,
      url: context.metadata.redirectUrl,
    });

    try {
      // Check if it's a test
      const testCheck = await chrome.tabs.sendMessage(tabId, { type: 'CHECK_TEST_REQUIRED' });

      FileLogger.log('service_worker', 'info', 'REDIRECT_TEST_CHECK', {
        vacancyId: context.vacancy.vacancyId,
        testRequired: testCheck?.testRequired,
        url: context.metadata.redirectUrl,
      });

      if (testCheck?.testRequired) {
        FileLogger.log('service_worker', 'info', 'Test detected', { vacancyId: context.vacancy.vacancyId });

        // Create manual action
        await this.deps.store.createManualAction({
          type: 'questionnaire',
          vacancyId: context.vacancy.vacancyId,
          vacancyTitle: context.vacancy.title,
          company: context.vacancy.company,
          url: context.metadata.redirectUrl || '',
          profileId: context.vacancy.profileId,
          reasonCode: 'questionnaire_required',
          status: 'pending',
        });

        // Add to skip list
        await this.deps.store.addToSkipList(context.vacancy.vacancyId || '', 24 * 60 * 60 * 1000, 'test');

        // Go back
        await chrome.tabs.sendMessage(tabId, { type: 'GO_BACK' });
        await this.deps.sleep(2000);

        return { outcome: 'test' };
      }

      // Not a test, check for cover letter
      FileLogger.log('service_worker', 'info', 'Normal response page, checking cover letter', { vacancyId: context.vacancy.vacancyId });

      const coverLetterCheck = await chrome.tabs.sendMessage(tabId, { type: 'DETECT_COVER_LETTER_UI' });

      if (coverLetterCheck?.visible || coverLetterCheck?.textareaFound) {
        FileLogger.log('service_worker', 'info', 'Cover letter UI found, filling', { vacancyId: context.vacancy.vacancyId });

        // Get cover letter from profile
        const state = this.deps.store.getState();
        const profile = Object.values(state.profiles).find(p => p.id === context.vacancy.profileId);
        const coverLetter = profile?.coverLetterTemplate || 'Здравствуйте! Заинтересован в данной вакансии.';

        await chrome.tabs.sendMessage(tabId, {
          type: 'FILL_COVER_LETTER',
          text: coverLetter,
        });

        await this.deps.sleep(300);

        await chrome.tabs.sendMessage(tabId, { type: 'CLICK_SUBMIT' });

        await this.deps.sleep(1000);
      }

      // Go back
      await chrome.tabs.sendMessage(tabId, { type: 'GO_BACK' });
      await this.deps.sleep(2000);

      FileLogger.log('service_worker', 'info', 'Redirect handled successfully', { vacancyId: context.vacancy.vacancyId });
      return { outcome: 'success' };

    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Redirect handling error', {
        vacancyId: context.vacancy.vacancyId,
        error: (error as Error).message,
      });

      // Try to go back anyway
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'GO_BACK' });
        await this.deps.sleep(2000);
      } catch (e) {
        // Ignore
      }

      return { outcome: 'failed' };
    }
  }

  private async initializeControlledTab(): Promise<{ success: boolean; tabId?: number; error?: string }> {
    const state = this.deps.store.getState();

    if (state.liveMode.controlledTabId) {
      try {
        const tab = await chrome.tabs.get(state.liveMode.controlledTabId);
        if (tab && tab.url?.includes('hh.ru')) {
          const url = tab.url || '';
          const isSearchPage = url.includes('/search/vacancy') || url.includes('/applicant/vacancy_search');

          if (!isSearchPage) {
            const activeProfileId = state.activeProfileId;
            const profile = activeProfileId ? state.profiles[activeProfileId] : null;
            const searchUrl = profile ? `https://hh.ru/search/vacancy?text=${encodeURIComponent(profile.keywordsInclude.join(' '))}` : 'https://hh.ru/search/vacancy';

            await chrome.tabs.update(tab.id!, { url: searchUrl, active: true });
            await this.waitForPageLoad(tab.id!);

            return { success: true, tabId: tab.id };
          }

          return { success: true, tabId: tab.id };
        }
      } catch (error) {
        // Tab not found, continue to create new one
      }
    }

    // Create new tab
    const activeProfileId = state.activeProfileId;
    if (!activeProfileId) {
      return { success: false, error: 'no_active_profile' };
    }

    const profile = state.profiles[activeProfileId];
    if (!profile) {
      return { success: false, error: 'profile_not_found' };
    }

    const searchUrl = `https://hh.ru/search/vacancy?text=${encodeURIComponent(profile.keywordsInclude.join(' '))}`;

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tabs.length > 0 && tabs[0].id) {
      const tabId = tabs[0].id;
      const windowId = tabs[0].windowId;

      if (tabs[0].url?.includes('hh.ru')) {
        await this.deps.store.bindControlledTab(tabId, windowId!, tabs[0].url);
        return { success: true, tabId };
      }

      await chrome.tabs.update(tabId, { url: searchUrl, active: true });
      await this.waitForPageLoad(tabId);
      await this.deps.store.bindControlledTab(tabId, windowId!, searchUrl);
      return { success: true, tabId };
    }

    const newTab = await chrome.tabs.create({ url: searchUrl, active: true });
    if (!newTab.id || !newTab.windowId) {
      return { success: false, error: 'failed_to_create_tab' };
    }

    await this.waitForPageLoad(newTab.id);
    await this.deps.store.bindControlledTab(newTab.id, newTab.windowId, searchUrl);
    return { success: true, tabId: newTab.id };
  }

  private async waitForPageLoad(tabId: number): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, 10000);

      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
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
}
