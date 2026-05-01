/**
 * Live Auto Apply Engine V2
 *
 * Production-grade architecture with state machine, retry logic, and clear error handling.
 */

import { StateStore } from '../state/store';
import { AcquisitionService } from './acquisitionService';
import { FileLogger } from '../utils/fileLogger';
import { VacancyQueueItem } from '../state/types';
import { sendMessageWithTimeout } from '../utils/messageWithTimeout';
import { PreflightService, PreflightResult } from './preflightService';
import { buildGlobalSearchUrl } from '../live/advancedSearchFormFiller';

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
  preflight?: PreflightResult;
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
  private preflightService: PreflightService;

  constructor(private deps: LiveEngineV2Deps) {
    this.preflightService = new PreflightService(deps.log);
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) {
      FileLogger.log('service_worker', 'warn', 'LiveEngineV2 already running, ignoring duplicate start');
      return;
    }
    this.running = true;
    this.stopRequested = false;

    FileLogger.log('service_worker', 'info', 'LiveEngineV2 start');

    try {
      await this.deps.store.dispatch('START_REQUESTED');
      await this.deps.store.dispatch('START_CONFIRMED');
      await this.deps.store.resetRuntimeCounters();

      // Initialize controlled tab
      const initResult = await this.initializeControlledTab();
      if (!initResult.success) {
        FileLogger.log('service_worker', 'error', 'Failed to initialize controlled tab', {
          error: initResult.error
        });
        await this.deps.store.setRuntimePhase('paused_manual_action', initResult.error || 'controlled_tab_init_failed');
        // Early return will trigger finally block for cleanup
        return;
      }

      FileLogger.log('service_worker', 'info', 'Controlled tab initialized', {
        tabId: initResult.tabId
      });

      // Clear stale controlled_tab_lost blocker after successful init/rebind
      const currentBlocker = this.deps.store.getState().runtimeBlocker;
      if (currentBlocker === 'controlled_tab_lost') {
        FileLogger.log('service_worker', 'info', 'Clearing stale controlled_tab_lost blocker after successful init');
        await this.deps.store.clearRuntimeBlocker();
      }

      // Main loop
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
        if (cycleResult === 'blocked' || cycleResult === 'no_vacancies') {
          FileLogger.log('service_worker', 'info', 'Cycle stopped', { reason: cycleResult });
          break;
        }

        // Delay only if cycle resulted in actual apply (not skip)
        if (cycleResult === 'applied') {
          const delaySeconds = this.randomInRange(
            state.settings.delayMinSeconds,
            state.settings.delayMaxSeconds
          );
          FileLogger.log('service_worker', 'info', 'Waiting after apply', { delaySeconds });
          await this.deps.store.setRuntimePhase('waiting');
          await this.deps.sleep(delaySeconds * 1000);
        } else {
          // Skipped - no delay, continue immediately
          FileLogger.log('service_worker', 'info', 'Skipped, no delay');
        }
      }

      FileLogger.log('service_worker', 'info', 'Pipeline finished');
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Engine error', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
    } finally {
      await this.stopInternal();
    }
  }

  async stop(): Promise<void> {
    FileLogger.log('service_worker', 'info', 'LiveEngineV2 stop requested');
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

  private async runCycle(): Promise<'applied' | 'skipped' | 'blocked' | 'no_vacancies'> {
    const cycleStartTime = Date.now();
    FileLogger.log('service_worker', 'info', 'Cycle start', {
      timestamp: new Date().toISOString()
    });

    // Get controlled tab
    const state = this.deps.store.getState();
    let controlledTabId = state.liveMode.controlledTabId;

    if (!controlledTabId) {
      FileLogger.log('service_worker', 'error', 'No controlled tab');
      await this.deps.store.setRuntimePhase('paused_manual_action', 'controlled_tab_lost');
      return 'blocked';
    }

    // Verify we're on search page
    try {
      const tab = await chrome.tabs.get(controlledTabId);
      const currentUrl = tab.url || '';

      if (!currentUrl.includes('/search/vacancy') && !currentUrl.includes('/applicant/vacancy_search')) {
        FileLogger.log('service_worker', 'warn', 'Not on search page, returning', { currentUrl });
        await this.returnToSearchPage(controlledTabId);
        await this.deps.sleep(2000);
      }
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Failed to check current URL', {
        error: (error as Error).message
      });
    }

    // Check session
    await this.deps.store.setRuntimePhase('session_check');
    const blocker = this.deps.store.getState().runtimeBlocker;

    // Distinguish between auth blockers and operational blockers
    if (blocker) {
      if (blocker === 'controlled_tab_lost') {
        // Operational blocker - tab was lost, not an auth issue
        FileLogger.log('service_worker', 'warn', 'Controlled tab lost during cycle', {
          blocker
        });
        await this.deps.store.setRuntimePhase('paused_manual_action', blocker);
        return 'blocked';
      } else {
        // Auth blocker (login_required, captcha_required, session_unknown)
        FileLogger.log('service_worker', 'warn', 'Blocked by auth', {
          blocker
        });
        await this.deps.store.setRuntimePhase('paused_auth', blocker);
        return 'blocked';
      }
    }

    // Check resume
    await this.deps.store.setRuntimePhase('resume_check');
    const currentState = this.deps.store.getState();
    if (!currentState.selectedResumeHash) {
      FileLogger.log('service_worker', 'warn', 'No resume selected');
      await this.deps.store.setRuntimePhase('paused_manual_action', 'resume_not_found');
      return 'blocked';
    }

    // Acquire vacancies if needed
    const activeProfileId = currentState.activeProfileId;
    if (!activeProfileId) {
      FileLogger.log('service_worker', 'warn', 'No active profile');
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
    const currentQueue = this.deps.store.getState().vacancyQueue;
    const hasDiscovered = currentQueue.some(v => v.status === 'discovered');
    const discoveredCount = currentQueue.filter(v => v.status === 'discovered').length;

    if (!hasDiscovered) {
      FileLogger.log('service_worker', 'info', 'Queue empty, acquiring', {
        queueSize: currentQueue.length,
        discoveredCount
      });
      await this.deps.store.setRuntimePhase('search');

      // Проверяем флаг: нужно ли перейти на broad search
      // Обычный acquisition с текущей страницы (skipNavigation: true чтобы не сбросить page=N)
      const acquisitionResult = await this.deps.acquisitionService.acquireForProfile(activeProfileId, true);

      // Save search URL from acquisition
      if (acquisitionResult.success && acquisitionResult.currentUrl) {
        const currentState = this.deps.store.getState();
        await this.deps.store.updateState({
          liveMode: {
            ...currentState.liveMode,
            lastAppliedSearchUrl: acquisitionResult.currentUrl
          }
        });
        FileLogger.log('service_worker', 'info', 'Search URL saved', { url: acquisitionResult.currentUrl });
      }

      // СРАЗУ проверяем DOM - есть ли доступные вакансии на странице
      if (acquisitionResult.success && acquisitionResult.newQueued > 0) {
        try {
          // Получаем skip list и processed vacancies для проверки
          const skipListArray = this.deps.store.getState().skipList || [];
          const skipListMap: Record<string, boolean> = {};
          for (const entry of skipListArray) {
            skipListMap[entry.vacancyId] = true;
          }

          // Собираем processed vacancies из текущего queue
          const processedVacanciesMap: Record<string, boolean> = {};
          const currentQueue = this.deps.store.getState().vacancyQueue;
          for (const item of currentQueue) {
            if (item.status === 'processed' && item.vacancyId) {
              processedVacanciesMap[item.vacancyId] = true;
            }
          }

          // Собираем runtime batch vacancies (только discovered - прошли prefilter)
          const runtimeBatchVacanciesMap: Record<string, boolean> = {};
          for (const item of currentQueue) {
            if (item.status === 'discovered' && item.vacancyId) {
              runtimeBatchVacanciesMap[item.vacancyId] = true;
            }
          }

          const availCheck = await sendMessageWithTimeout(controlledTabId, {
            type: 'CHECK_AVAILABLE_VACANCIES',
            skipList: skipListMap,
            processedVacancies: processedVacanciesMap,
            runtimeBatchVacancies: runtimeBatchVacanciesMap
          }, 10000);

          FileLogger.log('service_worker', 'info', 'Page availability check', {
            hasAvailable: availCheck?.hasAvailable,
            totalCards: availCheck?.totalCards,
            availableCount: availCheck?.availableCount,
            alreadyAppliedCount: availCheck?.alreadyAppliedCount,
            manualActionCount: availCheck?.manualActionCount
          });

          // Если НЕТ доступных вакансий - сразу следующая страница
          if (!availCheck?.hasAvailable) {
            FileLogger.log('service_worker', 'info', 'No available vacancies, trying next page');

            // Очищаем очередь
            await this.deps.store.updateState({ vacancyQueue: [] });

            // Проверяем следующую страницу
            const hasNextResult = await sendMessageWithTimeout(controlledTabId, {
              type: 'CHECK_HAS_NEXT_PAGE'
            }, 3000);

            if (hasNextResult?.hasNext) {
              FileLogger.log('service_worker', 'info', 'Next page navigate');

              await sendMessageWithTimeout(controlledTabId, {
                type: 'CLICK_NEXT_PAGE'
              }, 3000);

              await this.deps.sleep(2000);

              // Acquisition с новой страницы
              const nextPageAcquisition = await this.deps.acquisitionService.acquireForProfile(activeProfileId, true);

              if (nextPageAcquisition.success && nextPageAcquisition.newQueued > 0) {
                FileLogger.log('service_worker', 'info', 'Next page acquisition complete', {
                  count: nextPageAcquisition.newQueued
                });

                // Save new search URL
                if (nextPageAcquisition.currentUrl) {
                  const currentState = this.deps.store.getState();
                  await this.deps.store.updateState({
                    liveMode: {
                      ...currentState.liveMode,
                      lastAppliedSearchUrl: nextPageAcquisition.currentUrl
                    }
                  });
                }

                // Проверяем DOM - есть ли ДОСТУПНЫЕ вакансии (не просто вакансии в очереди)
                const skipListArray = this.deps.store.getState().skipList || [];
                const skipListMap: Record<string, boolean> = {};
                for (const entry of skipListArray) {
                  skipListMap[entry.vacancyId] = true;
                }

                // Собираем processed vacancies из текущего queue
                const processedVacanciesMap: Record<string, boolean> = {};
                const currentQueue = this.deps.store.getState().vacancyQueue;
                for (const item of currentQueue) {
                  if (item.status === 'processed' && item.vacancyId) {
                    processedVacanciesMap[item.vacancyId] = true;
                  }
                }

                // Собираем runtime batch vacancies (только discovered - прошли prefilter)
                const runtimeBatchVacanciesMap: Record<string, boolean> = {};
                for (const item of currentQueue) {
                  if (item.status === 'discovered' && item.vacancyId) {
                    runtimeBatchVacanciesMap[item.vacancyId] = true;
                  }
                }

                const availCheck = await sendMessageWithTimeout(controlledTabId, {
                  type: 'CHECK_AVAILABLE_VACANCIES',
                  skipList: skipListMap,
                  processedVacancies: processedVacanciesMap,
                  runtimeBatchVacancies: runtimeBatchVacanciesMap
                }, 10000);

                FileLogger.log('service_worker', 'info', 'Next page availability', {
                  hasAvailable: availCheck?.hasAvailable,
                  availableCount: availCheck?.availableCount,
                  alreadyAppliedCount: availCheck?.alreadyAppliedCount,
                  manualActionCount: availCheck?.manualActionCount
                });

                if (availCheck?.hasAvailable) {
                  // Есть доступные вакансии - продолжаем
                  return 'skipped';
                } else {
                  // Вакансии есть, но все недоступные - это последняя страница
                  FileLogger.log('service_worker', 'warn', 'Next page unavailable only');
                  return 'skipped';
                }
              } else {
                // Нет вакансий на следующей странице - это последняя страница
                FileLogger.log('service_worker', 'warn', 'Next page empty');
                return 'skipped';
              }
            } else {
              FileLogger.log('service_worker', 'info', 'No next page available');
              return 'skipped';
            }
          }
        } catch (error) {
          FileLogger.log('service_worker', 'error', 'Failed to check page availability', {
            error: (error as Error).message
          });
        }
      }

      // Check if we got new vacancies
      const newDiscoveredCount = this.deps.store.getState().vacancyQueue.filter(v => v.status === 'discovered').length;

      if (newDiscoveredCount === 0) {
        FileLogger.log('service_worker', 'info', 'No new vacancies, checking pagination', {
          acquisitionSuccess: acquisitionResult.success,
          newQueued: acquisitionResult.newQueued
        });

        // Check if there's a next page
        try {
          const hasNextResult = await sendMessageWithTimeout(controlledTabId, {
            type: 'CHECK_HAS_NEXT_PAGE'
          }, 3000);

          if (hasNextResult?.hasNext) {
            FileLogger.log('service_worker', 'info', 'Navigating to next page');

            // Click next page
            await sendMessageWithTimeout(controlledTabId, {
              type: 'CLICK_NEXT_PAGE'
            }, 3000);

            await this.deps.sleep(2000);

            // Try acquisition again (skipNavigation: true - already on page after CLICK_NEXT_PAGE)
            const nextPageAcquisition = await this.deps.acquisitionService.acquireForProfile(activeProfileId, true);

            if (nextPageAcquisition.success && nextPageAcquisition.newQueued > 0) {
              FileLogger.log('service_worker', 'info', 'Next page acquired', {
                count: nextPageAcquisition.newQueued
              });

              // Save new search URL
              if (nextPageAcquisition.currentUrl) {
                const currentState = this.deps.store.getState();
                await this.deps.store.updateState({
                  liveMode: {
                    ...currentState.liveMode,
                    lastAppliedSearchUrl: nextPageAcquisition.currentUrl
                  }
                });
              }

              // Continue to process vacancies
            } else {
              FileLogger.log('service_worker', 'info', 'No vacancies on next page, stopping', {
                reason: 'pagination_exhausted'
              });
              await this.deps.store.setRuntimePhase('paused_no_vacancies', 'no_new_vacancies_pagination_exhausted');
              return 'no_vacancies';
            }
          } else {
            FileLogger.log('service_worker', 'info', 'No next page, stopping', {
              reason: 'no_pagination'
            });
            await this.deps.store.setRuntimePhase('paused_no_vacancies', 'no_new_vacancies_no_pagination');
            return 'no_vacancies';
          }
        } catch (error) {
          FileLogger.log('service_worker', 'error', 'Pagination check failed', {
            error: (error as Error).message
          });
          await this.deps.store.setRuntimePhase('paused_no_vacancies', 'no_new_vacancies');
          return 'no_vacancies';
        }
      }
    }

    // Get next vacancy
    const nextVacancy = this.deps.store.getState().vacancyQueue.find(item => item.status === 'discovered');
    if (!nextVacancy) {
      FileLogger.log('service_worker', 'warn', 'Queue empty after acquisition');
      await this.deps.store.setRuntimePhase('paused_no_vacancies', 'queue_empty');
      return 'no_vacancies';
    }

    // Process vacancy
    await this.deps.store.setRuntimePhase('apply');
    const result = await this.processSingleVacancy(nextVacancy, controlledTabId);

    // Log cycle completion with metrics
    const cycleElapsed = Date.now() - cycleStartTime;
    FileLogger.log('service_worker', 'info', 'Cycle COMPLETE', {
      vacancyId: nextVacancy.vacancyId,
      outcome: result.outcome,
      elapsed: cycleElapsed,
      state: result.context.state,
      hadPreflight: !!result.context.preflight,
      preflightType: result.context.preflight?.type,
      modalDetected: result.context.metadata.modalDetected,
      redirectDetected: result.context.metadata.redirectDetected,
      clickAttempts: result.context.metadata.clickAttempts,
      errors: result.context.errors,
    });

    // Update counters
    if (result.outcome === 'success') {
      await this.deps.store.incrementRuntimeCounters({ processed: 1, success: 1 });
    } else if (result.outcome === 'manual_action') {
      await this.deps.store.incrementRuntimeCounters({ processed: 1, manualActions: 1 });

      // Check if we should stop on manual action
      if (this.deps.store.getState().settings.stopOnManualAction) {
        FileLogger.log('service_worker', 'info', 'Manual action detected, stopOnManualAction enabled - pausing', {
          vacancyId: nextVacancy.vacancyId
        });
        await this.deps.store.setRuntimePhase('paused_manual_action', 'manual_action_required');
        return 'blocked';
      }
    } else if (result.outcome === 'skipped') {
      // Don't increment processed counter for skipped vacancies (already applied, etc)
      FileLogger.log('service_worker', 'info', 'Vacancy skipped, not counting as processed', {
        vacancyId: nextVacancy.vacancyId,
        reason: result.reason
      });

      // При первом же скипе проверяем весь DOM - есть ли доступные вакансии
      const state = this.deps.store.getState();
      const activeProfileId = state.activeProfileId;
      const controlledTabId = state.liveMode.controlledTabId;

      if (controlledTabId && activeProfileId) {
        try {
          const skipListArray = state.skipList || [];
          const skipListMap: Record<string, boolean> = {};
          for (const entry of skipListArray) {
            skipListMap[entry.vacancyId] = true;
          }

          // Собираем processed vacancies из текущего queue
          const processedVacanciesMap: Record<string, boolean> = {};
          const currentQueue = state.vacancyQueue;
          for (const item of currentQueue) {
            if (item.status === 'processed' && item.vacancyId) {
              processedVacanciesMap[item.vacancyId] = true;
            }
          }

          // Собираем runtime batch vacancies (только discovered - прошли prefilter)
          const runtimeBatchVacanciesMap: Record<string, boolean> = {};
          for (const item of currentQueue) {
            if (item.status === 'discovered' && item.vacancyId) {
              runtimeBatchVacanciesMap[item.vacancyId] = true;
            }
          }

          const availCheck = await sendMessageWithTimeout(controlledTabId, {
            type: 'CHECK_AVAILABLE_VACANCIES',
            skipList: skipListMap,
            processedVacancies: processedVacanciesMap,
            runtimeBatchVacancies: runtimeBatchVacanciesMap
          }, 10000);

          FileLogger.log('service_worker', 'info', 'Page availability after skip', {
            hasAvailable: availCheck?.hasAvailable,
            totalCards: availCheck?.totalCards,
            availableCount: availCheck?.availableCount,
            alreadyAppliedCount: availCheck?.alreadyAppliedCount,
            manualActionCount: availCheck?.manualActionCount
          });

          // Если НЕТ доступных вакансий - очистить очередь и перейти на следующую страницу
          if (!availCheck?.hasAvailable) {
            FileLogger.log('service_worker', 'info', 'No available vacancies after skip, trying next page');

            // Очистить очередь
            await this.deps.store.updateState({ vacancyQueue: [] });

            // Проверить следующую страницу
            const hasNextResult = await sendMessageWithTimeout(controlledTabId, {
              type: 'CHECK_HAS_NEXT_PAGE'
            }, 3000);

            if (hasNextResult?.hasNext) {
              FileLogger.log('service_worker', 'info', 'Navigating to next page after skip');

              await sendMessageWithTimeout(controlledTabId, {
                type: 'CLICK_NEXT_PAGE'
              }, 3000);

              await this.deps.sleep(2000);

              // Acquisition с новой страницы
              const nextPageAcquisition = await this.deps.acquisitionService.acquireForProfile(activeProfileId, true);

              if (nextPageAcquisition.success && nextPageAcquisition.newQueued > 0) {
                FileLogger.log('service_worker', 'info', 'Next page acquired after skip', {
                  count: nextPageAcquisition.newQueued
                });

                // Save new search URL
                if (nextPageAcquisition.currentUrl) {
                  const currentState = this.deps.store.getState();
                  await this.deps.store.updateState({
                    liveMode: {
                      ...currentState.liveMode,
                      lastAppliedSearchUrl: nextPageAcquisition.currentUrl
                    }
                  });
                }

                // Проверяем DOM - есть ли ДОСТУПНЫЕ вакансии
                const skipListArray2 = this.deps.store.getState().skipList || [];
                const skipListMap2: Record<string, boolean> = {};
                for (const entry of skipListArray2) {
                  skipListMap2[entry.vacancyId] = true;
                }

                // Собираем processed vacancies из текущего queue
                const processedVacanciesMap2: Record<string, boolean> = {};
                const currentQueue2 = this.deps.store.getState().vacancyQueue;
                for (const item of currentQueue2) {
                  if (item.status === 'processed' && item.vacancyId) {
                    processedVacanciesMap2[item.vacancyId] = true;
                  }
                }

                // Собираем runtime batch vacancies (только discovered - прошли prefilter)
                const runtimeBatchVacanciesMap2: Record<string, boolean> = {};
                for (const item of currentQueue2) {
                  if (item.status === 'discovered' && item.vacancyId) {
                    runtimeBatchVacanciesMap2[item.vacancyId] = true;
                  }
                }

                const availCheck2 = await sendMessageWithTimeout(controlledTabId, {
                  type: 'CHECK_AVAILABLE_VACANCIES',
                  skipList: skipListMap2,
                  processedVacancies: processedVacanciesMap2,
                  runtimeBatchVacancies: runtimeBatchVacanciesMap2
                }, 10000);

                FileLogger.log('service_worker', 'info', 'Next page availability', {
                  hasAvailable: availCheck2?.hasAvailable,
                  availableCount: availCheck2?.availableCount
                });

                if (!availCheck2?.hasAvailable) {
                  // Вакансии есть, но все недоступные - это последняя страница
                  FileLogger.log('service_worker', 'warn', 'Next page unavailable only');
                }
              } else {
                // Нет вакансий на следующей странице - это последняя страница
                FileLogger.log('service_worker', 'warn', 'Next page empty');
              }
            } else {
              FileLogger.log('service_worker', 'info', 'No next page available');
            }
          }
        } catch (error) {
          FileLogger.log('service_worker', 'error', 'Failed to check page availability after skip', {
            error: (error as Error).message
          });
        }
      }
    } else {
      // Failed
      await this.deps.store.incrementRuntimeCounters({ processed: 1 });
    }

    // Mark as processed
    await this.deps.store.markVacancyProcessed(nextVacancy.vacancyId || '');

    FileLogger.log('service_worker', 'info', 'Vacancy marked processed', {
      vacancyId: nextVacancy.vacancyId,
      outcome: result.outcome,
    });

    // Return appropriate cycle result based on outcome
    if (result.outcome === 'success') {
      return 'applied';
    } else {
      return 'skipped';
    }
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

    FileLogger.log('service_worker', 'info', 'Vacancy processing start', {
      vacancyId: vacancy.vacancyId,
      title: vacancy.title?.substring(0, 50),
    });

    try {
      // Step 0: Preflight check (КРИТИЧНО!)
      context.state = 'pending';
      const state = this.deps.store.getState();
      const resumeHash = state.selectedResumeHash;

      if (!resumeHash) {
        FileLogger.log('service_worker', 'error', 'No resume hash for preflight');
        return { success: false, outcome: 'failed', reason: 'no_resume', context };
      }

      const preflight = await this.preflightService.check(vacancy.vacancyId || '', resumeHash);
      context.preflight = preflight;

      FileLogger.log('service_worker', 'info', 'Preflight complete', {
        vacancyId: vacancy.vacancyId,
        canProceed: preflight.canProceed,
        type: preflight.type,
        requiresCoverLetter: preflight.requiresCoverLetter,
        requiresRelocationConfirm: preflight.requiresRelocationConfirm,
        requiresTest: preflight.requiresTest,
        alreadyApplied: preflight.alreadyApplied,
        error: preflight.error,
      });

      // Блокеры
      if (preflight.type === 'error') {
        context.state = 'failed';
        FileLogger.log('service_worker', 'error', 'Preflight failed', {
          vacancyId: vacancy.vacancyId,
          error: preflight.error
        });
        return { success: false, outcome: 'failed', reason: `preflight_error: ${preflight.error}`, context };
      }

      if (preflight.alreadyApplied) {
        context.state = 'skipped';
        return { success: false, outcome: 'skipped', reason: 'already_applied', context };
      }

      if (preflight.requiresTest) {
        context.state = 'manual_action';

        // Scroll to vacancy even if skipping (для визуальной обратной связи)
        try {
          await sendMessageWithTimeout(tabId, {
            type: 'SCROLL_TO_VACANCY',
            vacancyId: vacancy.vacancyId,
          }, 3000);
          await this.deps.sleep(500); // Дать время на скролл
        } catch (error) {
          // Ignore scroll errors
        }

        // Create manual action
        await this.deps.store.createManualAction({
          type: 'questionnaire',
          vacancyId: vacancy.vacancyId,
          vacancyTitle: vacancy.title,
          company: vacancy.company,
          url: `https://hh.ru/vacancy/${vacancy.vacancyId}`,
          profileId: vacancy.profileId,
          reasonCode: 'questionnaire_required',
          status: 'pending',
        });

        // Add to skip list
        await this.deps.store.addToSkipList(vacancy.vacancyId || '', 24 * 60 * 60 * 1000, 'test');

        FileLogger.log('service_worker', 'warn', 'Test required', { vacancyId: vacancy.vacancyId });
        return { success: true, outcome: 'manual_action', reason: 'test_required', context };
      }

      if (!preflight.canProceed) {
        context.state = 'skipped';
        FileLogger.log('service_worker', 'warn', 'Preflight blocked', {
          vacancyId: vacancy.vacancyId,
          reason: preflight.error
        });
        return { success: false, outcome: 'skipped', reason: preflight.error || 'preflight_blocked', context };
      }

      // Step 1: Validate on page
      context.state = 'validating';

      const validationResult = await this.validateVacancy(context, tabId);
      if (!validationResult.valid) {
        context.state = 'skipped';
        FileLogger.log('service_worker', 'info', 'Vacancy validation failed', {
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
        FileLogger.log('service_worker', 'warn', 'Respond click failed', {
          vacancyId: vacancy.vacancyId
        });
        return { success: false, outcome: 'skipped', reason: 'click_failed', context };
      }

      await this.deps.sleep(500);

      // Step 3: Handle modal sequence (если preflight показал модалки)
      if (preflight.requiresRelocationConfirm || preflight.requiresCoverLetter) {
        context.state = 'handling_modal';

        FileLogger.log('service_worker', 'info', 'Modal sequence start', {
          vacancyId: vacancy.vacancyId,
          requiresRelocationConfirm: preflight.requiresRelocationConfirm,
          requiresCoverLetter: preflight.requiresCoverLetter,
        });

        const modalSequenceResult = await this.handleModalSequence(context, tabId, preflight);

        if (modalSequenceResult.success) {
          context.state = 'success';
          FileLogger.log('service_worker', 'info', 'Modal sequence success', {
            vacancyId: vacancy.vacancyId
          });
          return { success: true, outcome: 'success', context };
        }

        FileLogger.log('service_worker', 'warn', 'Modal sequence failed', {
          vacancyId: vacancy.vacancyId
        });
        return { success: false, outcome: 'failed', reason: 'modal_sequence_failed', context };
      }

      // Step 3b: Quick response - проверяем успех по изменению кнопки
      if (preflight.type === 'quickResponse') {
        FileLogger.log('service_worker', 'info', 'Quick response check', {
          vacancyId: vacancy.vacancyId
        });

        // Wait for button state change
        await this.deps.sleep(1000);

        try {
          const buttonCheck = await sendMessageWithTimeout(tabId, {
            type: 'VALIDATE_VACANCY',
            vacancyId: vacancy.vacancyId,
          }, 3000);

          if (buttonCheck.alreadyApplied) {
            // Кнопка изменилась на "Отклик отправлен" - успех!
            context.state = 'success';
            FileLogger.log('service_worker', 'info', 'Quick response success', {
              vacancyId: vacancy.vacancyId
            });
            return { success: true, outcome: 'success', context };
          }

          FileLogger.log('service_worker', 'warn', 'Quick response not confirmed', {
            vacancyId: vacancy.vacancyId,
            buttonState: buttonCheck
          });
        } catch (error) {
          FileLogger.log('service_worker', 'error', 'Quick response check failed', {
            error: (error as Error).message
          });
        }

        // Fallback: считаем успехом если не было ошибок
        context.state = 'success';
        FileLogger.log('service_worker', 'info', 'Quick response assumed success', {
          vacancyId: vacancy.vacancyId
        });
        return { success: true, outcome: 'success', context };
      }

      // Step 4: Detect response (fallback если preflight не показал модалки)
      context.state = 'waiting_response';
      const responseType = await this.detectResponse(context, tabId);

      // Step 5: Handle response
      if (responseType === 'modal') {
        context.state = 'handling_modal';
        const modalResult = await this.handleModal(context, tabId);
        if (modalResult.success) {
          context.state = 'success';
          FileLogger.log('service_worker', 'info', 'Vacancy processed: success (modal)', { vacancyId: vacancy.vacancyId });
          return { success: true, outcome: 'success', context };
        }
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
        stack: (error as Error).stack,
      });

      // Try to return to search page
      try {
        await this.returnToSearchPage(tabId);
      } catch (e) {
        FileLogger.log('service_worker', 'error', 'Failed to return to search after error', {
          error: (e as Error).message
        });
      }

      return { success: false, outcome: 'failed', reason: (error as Error).message, context };
    }
  }

  /**
   * Step 1: Validate vacancy exists and is clickable
   */
  private async validateVacancy(context: VacancyContext, tabId: number): Promise<{ valid: boolean; reason?: string }> {
    FileLogger.log('service_worker', 'info', 'Validating vacancy', { vacancyId: context.vacancy.vacancyId });

    try {
      const result = await sendMessageWithTimeout(tabId, {
        type: 'VALIDATE_VACANCY',
        vacancyId: context.vacancy.vacancyId,
      }, 3000);

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
        const result = await sendMessageWithTimeout(tabId, {
          type: 'CLICK_RESPOND_BUTTON',
          vacancyId: context.vacancy.vacancyId,
        }, 5000);

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

    // Check for modal with retry - СРАЗУ без задержки, потом с задержками
    const delays = [0, 200, 500, 1000, 1500]; // Первая проверка мгновенно!

    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) {
        await this.deps.sleep(delays[i]);
      }

      try {
        const modalCheck = await sendMessageWithTimeout(tabId, {
          type: 'CHECK_MODAL_EXISTS',
        }, 3000);

        FileLogger.log('service_worker', 'info', `Modal check attempt ${i + 1} (delay: ${delays[i]}ms)`, {
          vacancyId: context.vacancy.vacancyId,
          exists: modalCheck?.exists,
          modalCount: modalCheck?.count,
          text: modalCheck?.text?.substring(0, 100)
        });

        if (modalCheck?.exists) {
          FileLogger.log('service_worker', 'debug', 'Modal detected', {
            vacancyId: context.vacancy.vacancyId,
            attempt: i + 1,
            delay: delays[i]
          });
          context.metadata.modalDetected = true;
          return 'modal';
        }
      } catch (error) {
        // Content script not responding, might have redirected
        FileLogger.log('service_worker', 'debug', 'Modal check failed', {
          attempt: i + 1,
          error: (error as Error).message
        });
        break;
      }
    }

    // No modal after all checks, check for redirect
    FileLogger.log('service_worker', 'debug', 'No modal detected, checking redirect');

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
   * Step 4a: Handle modal
   */
  private async handleModal(context: VacancyContext, tabId: number): Promise<{ success: boolean }> {
    FileLogger.log('service_worker', 'info', 'Handling modal', { vacancyId: context.vacancy.vacancyId });

    try {
      // Get cover letter from profile
      const state = this.deps.store.getState();
      const profile = Object.values(state.profiles).find(p => p.id === context.vacancy.profileId);
      const coverLetter = profile?.coverLetterTemplate || 'Здравствуйте! Заинтересован в данной вакансии.';

      const result = await sendMessageWithTimeout(tabId, {
        type: 'HANDLE_MODAL',
        coverLetter,
      }, 3000);

      if (result.handled) {
        FileLogger.log('service_worker', 'info', 'Modal handled', { vacancyId: context.vacancy.vacancyId });
        await this.deps.sleep(500);
        return { success: true };
      }

      FileLogger.log('service_worker', 'warn', 'Modal not handled', { vacancyId: context.vacancy.vacancyId });
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
   * Step 4a-extended: Handle modal sequence (relocation → cover letter)
   */
  private async handleModalSequence(
    context: VacancyContext,
    tabId: number,
    preflight: PreflightResult
  ): Promise<{ success: boolean }> {
    FileLogger.log('service_worker', 'info', 'Handling modal sequence', {
      vacancyId: context.vacancy.vacancyId,
      requiresRelocationConfirm: preflight.requiresRelocationConfirm,
      requiresCoverLetter: preflight.requiresCoverLetter,
    });

    try {
      // Get cover letter from profile
      const state = this.deps.store.getState();
      const profile = Object.values(state.profiles).find(p => p.id === context.vacancy.profileId);
      const coverLetter = profile?.coverLetterTemplate || 'Здравствуйте! Заинтересован в данной вакансии.';

      // Modal 1: Relocation warning (если есть)
      if (preflight.requiresRelocationConfirm) {
        FileLogger.log('service_worker', 'info', 'Waiting for relocation modal', { vacancyId: context.vacancy.vacancyId });

        // Проверяем модалку сразу после клика (она появляется мгновенно на той же странице)
        let modalFound = false;
        const delays = [100, 300, 500, 1000, 1500]; // Быстрые проверки

        for (let i = 0; i < delays.length; i++) {
          await this.deps.sleep(delays[i]);

          const modalCheck = await sendMessageWithTimeout(tabId, { type: 'CHECK_MODAL_EXISTS' }, 3000);

          FileLogger.log('service_worker', 'info', `Modal check ${i + 1}/${delays.length} (delay: ${delays[i]}ms)`, {
            exists: modalCheck?.exists,
            count: modalCheck?.count,
            allModals: modalCheck?.allModals
          });

          if (modalCheck?.exists) {
            modalFound = true;
            break;
          }
        }

        if (!modalFound) {
          FileLogger.log('service_worker', 'warn', 'Relocation modal not found', {
            vacancyId: context.vacancy.vacancyId
          });
          return { success: false };
        }

        FileLogger.log('service_worker', 'info', 'Relocation modal found', {
          vacancyId: context.vacancy.vacancyId
        });

        // Handle relocation modal (без cover letter)
        const relocationResult = await sendMessageWithTimeout(tabId, {
          type: 'HANDLE_ANY_MODAL',
        }, 3000);

        if (!relocationResult.handled) {
          FileLogger.log('service_worker', 'error', 'Failed to handle relocation modal', { vacancyId: context.vacancy.vacancyId });
          return { success: false };
        }

        FileLogger.log('service_worker', 'info', 'Relocation modal handled', { vacancyId: context.vacancy.vacancyId });
        await this.deps.sleep(500);
      }

      // Modal 2: Cover letter (если есть)
      if (preflight.requiresCoverLetter) {
        FileLogger.log('service_worker', 'info', 'Waiting for cover letter modal', { vacancyId: context.vacancy.vacancyId });

        // Retry modal detection (3 attempts)
        let modalFound = false;
        for (let i = 0; i < 3; i++) {
          const modalCheck = await sendMessageWithTimeout(tabId, { type: 'CHECK_MODAL_EXISTS' }, 3000);
          if (modalCheck?.exists) {
            modalFound = true;
            break;
          }
          await this.deps.sleep(500);
        }

        if (!modalFound) {
          FileLogger.log('service_worker', 'warn', 'Cover letter modal not found', { vacancyId: context.vacancy.vacancyId });
          return { success: false };
        }

        // Handle cover letter modal
        const coverLetterResult = await sendMessageWithTimeout(tabId, {
          type: 'HANDLE_ANY_MODAL',
          coverLetter,
        }, 3000);

        if (!coverLetterResult.handled) {
          FileLogger.log('service_worker', 'error', 'Failed to handle cover letter modal', { vacancyId: context.vacancy.vacancyId });
          return { success: false };
        }

        FileLogger.log('service_worker', 'info', 'Cover letter modal handled', { vacancyId: context.vacancy.vacancyId });
        await this.deps.sleep(500);
      }

      FileLogger.log('service_worker', 'info', 'Modal sequence completed', { vacancyId: context.vacancy.vacancyId });
      return { success: true };

    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Modal sequence error', {
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
    FileLogger.log('service_worker', 'info', 'Handling redirect', {
      vacancyId: context.vacancy.vacancyId,
      url: context.metadata.redirectUrl,
    });

    try {
      // Check if it's a test
      const testCheck = await sendMessageWithTimeout(tabId, { type: 'CHECK_TEST_REQUIRED' }, 3000);

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

        // Go back to search page
        await this.returnToSearchPage(tabId);

        return { outcome: 'test' };
      }

      // Not a test, check for cover letter
      FileLogger.log('service_worker', 'info', 'Normal response page, checking cover letter', { vacancyId: context.vacancy.vacancyId });

      const coverLetterCheck = await sendMessageWithTimeout(tabId, { type: 'DETECT_COVER_LETTER_UI' }, 3000);

      if (coverLetterCheck?.visible || coverLetterCheck?.textareaFound) {
        FileLogger.log('service_worker', 'info', 'Cover letter UI found, filling', { vacancyId: context.vacancy.vacancyId });

        // Get cover letter from profile
        const state = this.deps.store.getState();
        const profile = Object.values(state.profiles).find(p => p.id === context.vacancy.profileId);
        const coverLetter = profile?.coverLetterTemplate || 'Здравствуйте! Заинтересован в данной вакансии.';

        await sendMessageWithTimeout(tabId, {
          type: 'FILL_COVER_LETTER',
          text: coverLetter,
        }, 3000);

        await this.deps.sleep(300);

        await sendMessageWithTimeout(tabId, { type: 'CLICK_SUBMIT' }, 3000);

        await this.deps.sleep(1000);
      }

      // Go back to search page
      await this.returnToSearchPage(tabId);

      FileLogger.log('service_worker', 'info', 'Redirect handled successfully', { vacancyId: context.vacancy.vacancyId });
      return { outcome: 'success' };

    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Redirect handling error', {
        vacancyId: context.vacancy.vacancyId,
        error: (error as Error).message,
      });

      // Try to go back anyway
      try {
        await this.returnToSearchPage(tabId);
      } catch (e) {
        // ignore
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
            const resumeHash = state.selectedResumeHash;
            const searchUrl = buildGlobalSearchUrl(resumeHash);

            FileLogger.log('service_worker', 'info', 'Fallback navigation to global search', {
              searchUrl,
              strategy: 'global_search',
              resumeHash: resumeHash || 'none'
            });

            await chrome.tabs.update(tab.id!, { url: searchUrl, active: true });
            await this.waitForPageLoad(tab.id!);

            await this.deps.store.updateState({
              liveMode: {
                ...this.deps.store.getState().liveMode,
                lastAppliedSearchUrl: searchUrl
              }
            });
            return { success: true, tabId: tab.id };
          }

          await this.deps.store.updateState({
            liveMode: {
              ...this.deps.store.getState().liveMode,
              lastAppliedSearchUrl: url
            }
          });
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

    const resumeHash = state.selectedResumeHash;
    const searchUrl = buildGlobalSearchUrl(resumeHash);

    FileLogger.log('service_worker', 'info', 'Initialize controlled tab with global search', {
      searchUrl,
      strategy: 'global_search',
      resumeHash: resumeHash || 'none'
    });

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tabs.length > 0 && tabs[0].id) {
      const tabId = tabs[0].id;
      const windowId = tabs[0].windowId;

      if (tabs[0].url?.includes('hh.ru')) {
        await this.deps.store.bindControlledTab(tabId, windowId!, tabs[0].url);
        await this.deps.store.updateState({
          liveMode: {
            ...this.deps.store.getState().liveMode,
            lastAppliedSearchUrl: tabs[0].url
          }
        });
        return { success: true, tabId };
      }

      await chrome.tabs.update(tabId, { url: searchUrl, active: true });
      await this.waitForPageLoad(tabId);
      await this.deps.store.bindControlledTab(tabId, windowId!, searchUrl);
      await this.deps.store.updateState({
        liveMode: {
          ...this.deps.store.getState().liveMode,
          lastAppliedSearchUrl: searchUrl
        }
      });
      return { success: true, tabId };
    }

    const newTab = await chrome.tabs.create({ url: searchUrl, active: true });
    if (!newTab.id || !newTab.windowId) {
      return { success: false, error: 'failed_to_create_tab' };
    }

    await this.waitForPageLoad(newTab.id);
    await this.deps.store.bindControlledTab(newTab.id, newTab.windowId, searchUrl);
    await this.deps.store.updateState({
      liveMode: {
        ...this.deps.store.getState().liveMode,
        lastAppliedSearchUrl: searchUrl
      }
    });
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

  /**
   * Return to search page by direct navigation (not history.back)
   * This is more reliable than GO_BACK which can navigate to wrong page
   */
  private async returnToSearchPage(tabId: number): Promise<void> {
    const searchUrl = this.deps.store.getState().liveMode.lastAppliedSearchUrl;

    if (!searchUrl) {
      FileLogger.log('service_worker', 'error', 'No search URL stored, cannot return');
      return;
    }

    FileLogger.log('service_worker', 'info', 'Returning to search page', { url: searchUrl });

    try {
      await chrome.tabs.update(tabId, { url: searchUrl });
      await this.waitForPageLoad(tabId);

      // Дополнительная задержка для React рендера
      FileLogger.log('service_worker', 'info', 'Waiting for React render after page load');
      await this.deps.sleep(2000);

      FileLogger.log('service_worker', 'info', 'Returned to search page successfully');
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Failed to return to search page', {
        error: (error as Error).message
      });
    }
  }

  private randomInRange(min: number, max: number): number {
    const lo = Math.max(1, Math.min(min, max));
    const hi = Math.max(min, max);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }
}
