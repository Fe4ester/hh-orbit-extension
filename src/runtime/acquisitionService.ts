/**
 * Vacancy Acquisition Service
 *
 * Backend-like acquisition: build URL -> open tab -> wait -> parse -> materialize queue.
 * Returns structured result, not side effects.
 */

import { StateStore } from '../state/store';
import { parseSearchResults } from '../live/searchResultsParser';
import { FileLogger } from '../utils/fileLogger';
import { sendMessageWithTimeout } from '../utils/messageWithTimeout';
import { buildGlobalSearchUrl } from '../live/advancedSearchFormFiller';

export interface AcquisitionResult {
  success: boolean;
  currentUrl: string | null;
  pageType: string | null;
  cardsFound: number;
  newQueued: number;
  queueSizeAfter: number;
  error?: string;
}

export interface AcquisitionServiceDeps {
  store: StateStore;
  log: (...args: any[]) => void;
}

export class AcquisitionService {
  constructor(private deps: AcquisitionServiceDeps) {}

  async acquireForProfile(profileId: string): Promise<AcquisitionResult> {
    FileLogger.log('service_worker', 'info', 'Acquisition start', { profileId });

    const state = this.deps.store.getState();
    const profile = state.profiles[profileId];

    if (!profile) {
      FileLogger.log('service_worker', 'error', 'Acquisition failed', { profileId, reason: 'profile_not_found' });
      return {
        success: false,
        currentUrl: null,
        pageType: null,
        cardsFound: 0,
        newQueued: 0,
        queueSizeAfter: 0,
        error: 'profile_not_found',
      };
    }

    // Get controlled tab
    const controlledTabId = state.liveMode.controlledTabId;

    if (!controlledTabId) {
      FileLogger.log('service_worker', 'error', 'Acquisition failed', { reason: 'no_controlled_tab' });
      return {
        success: false,
        currentUrl: null,
        pageType: null,
        cardsFound: 0,
        newQueued: 0,
        queueSizeAfter: 0,
        error: 'no_controlled_tab',
      };
    }

    try {
      const resumeHash = state.selectedResumeHash;
      const searchUrl = buildGlobalSearchUrl(resumeHash);

      FileLogger.log('service_worker', 'info', 'Acquisition navigate', {
        searchUrl,
        strategy: 'global_search',
        resumeHash: resumeHash || 'none'
      });

      // Navigate controlled tab to search URL
      await chrome.tabs.update(controlledTabId, { url: searchUrl, active: true });

      const ready = await this.waitForTabReady(controlledTabId, searchUrl, 30000);
      if (!ready) {
        FileLogger.log('service_worker', 'error', 'Acquisition: Tab not ready');
        return {
          success: false,
          currentUrl: null,
          pageType: null,
          cardsFound: 0,
          newQueued: 0,
          queueSizeAfter: 0,
          error: 'navigation_timeout',
        };
      }

      // Check if we got redirected away from search
      const tab = await chrome.tabs.get(controlledTabId);
      const actualUrl = tab.url || '';

      if (!actualUrl.includes('/search/vacancy')) {
        FileLogger.log('service_worker', 'error', 'Acquisition failed', { reason: 'not_on_search_page', actualUrl });
        return {
          success: false,
          currentUrl: actualUrl,
          pageType: 'unknown',
          cardsFound: 0,
          newQueued: 0,
          queueSizeAfter: 0,
          error: 'not_on_search_page',
        };
      }

      // Ping content script to verify it's loaded
      FileLogger.log('service_worker', 'debug', 'Acquisition content script check', { tabId: controlledTabId });

      let contentScriptReady = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await sendMessageWithTimeout(controlledTabId, { type: 'PING' }, 2000);
          FileLogger.log('service_worker', 'debug', 'Content script ready', { tabId: controlledTabId, attempt: attempt + 1 });
          contentScriptReady = true;
          break;
        } catch (error) {
          FileLogger.log('service_worker', 'debug', 'Content script not responding', { attempt: attempt + 1 });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!contentScriptReady) {
        FileLogger.log('service_worker', 'error', 'Acquisition failed', { reason: 'content_script_not_loaded' });
        return {
          success: false,
          currentUrl: actualUrl,
          pageType: 'unknown',
          cardsFound: 0,
          newQueued: 0,
          queueSizeAfter: 0,
          error: 'content_script_not_loaded',
        };
      }

      // Wait for React to render vacancy cards
      FileLogger.log('service_worker', 'debug', 'Acquisition wait for render');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get HTML from content script
      FileLogger.log('service_worker', 'debug', 'Acquisition fetch html', { tabId: controlledTabId });
      const htmlResponse = await sendMessageWithTimeout(controlledTabId, { type: 'GET_HTML' }, 5000);
      const html = htmlResponse?.html;

      if (!html || html.length === 0) {
        FileLogger.log('service_worker', 'error', 'Acquisition failed', { reason: 'empty_html' });
        return {
          success: false,
          currentUrl: actualUrl,
          pageType: 'unknown',
          cardsFound: 0,
          newQueued: 0,
          queueSizeAfter: 0,
          error: 'empty_html',
        };
      }
      FileLogger.log('service_worker', 'debug', 'Acquisition html fetched', { length: html.length });

      // Parse search results
      const cards = parseSearchResults(html);
      FileLogger.log('service_worker', 'info', 'Acquisition parsed', { cardsFound: cards.length });

      if (cards.length === 0) {
        FileLogger.log('service_worker', 'warn', 'Acquisition empty', { currentUrl: actualUrl });
        return {
          success: true,
          currentUrl: actualUrl,
          pageType: 'search',
          cardsFound: 0,
          newQueued: 0,
          queueSizeAfter: this.deps.store.getState().vacancyQueue.length,
          error: 'no_results',
        };
      }

      // Materialize to queue
      const queueBefore = this.deps.store.getState().vacancyQueue.length;
      await this.deps.store.materializeVacanciesFromSearch(cards, profileId);

      const stateAfter = this.deps.store.getState();
      const queueAfter = stateAfter.vacancyQueue.length;
      const queueCount = stateAfter.vacancyQueue.filter((v) => v.status === 'discovered').length;

      FileLogger.log('service_worker', 'info', 'Acquisition complete', {
        cardsFound: cards.length,
        queueBefore,
        queueAfter,
        newQueued: queueAfter - queueBefore,
        queueSizeAfter: queueCount,
      });

      return {
        success: true,
        currentUrl: actualUrl,
        pageType: 'search',
        cardsFound: cards.length,
        newQueued: cards.length,
        queueSizeAfter: queueCount,
      };
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Acquisition exception', {
        error: (error as Error).message,
      });
      return {
        success: false,
        currentUrl: null,
        pageType: null,
        cardsFound: 0,
        newQueued: 0,
        queueSizeAfter: 0,
        error: (error as Error).message,
      };
    }
  }

  private async waitForTabReady(tabId: number, _expectedUrl: string, timeoutMs = 30000): Promise<boolean> {
    const startTime = Date.now();
    FileLogger.log('service_worker', 'debug', 'Tab ready wait start', { tabId, timeout: timeoutMs });

    return new Promise((resolve) => {
      let lastStatus = '';
      let readyCheckAttempts = 0;

      const checkInterval = setInterval(async () => {
        try {
          const tab = await chrome.tabs.get(tabId);
          const elapsed = Date.now() - startTime;

          if (elapsed > timeoutMs) {
            clearInterval(checkInterval);
            FileLogger.log('service_worker', 'warn', 'Tab ready wait timeout', { tabId, elapsed });
            resolve(false);
            return;
          }

          if (lastStatus !== tab.status) {
            FileLogger.log('service_worker', 'debug', 'Tab status', { status: tab.status, elapsed });
            lastStatus = tab.status || '';
          }

          // Check if URL is correct
          if (!tab.url?.includes('/search/vacancy')) {
            FileLogger.log('service_worker', 'warn', 'Tab navigated away', { url: tab.url });
            clearInterval(checkInterval);
            resolve(false);
            return;
          }

          // If tab.status is 'complete' OR we've waited 5+ seconds, check readyState
          if (tab.status === 'complete' || elapsed > 5000) {
            try {
              const results = await chrome.scripting.executeScript({
                target: { tabId, allFrames: false },
                func: () => document.readyState,
              });

              const readyState = results[0].result;
              FileLogger.log('service_worker', 'debug', 'Document readyState', { readyState, elapsed });

              if (readyState === 'complete' || readyState === 'interactive') {
                clearInterval(checkInterval);
                FileLogger.log('service_worker', 'debug', 'Tab ready wait complete', { readyState, elapsed });
                resolve(true);
                return;
              }

              // Still loading, retry up to 3 times
              readyCheckAttempts++;
              if (readyCheckAttempts >= 3) {
                clearInterval(checkInterval);
                FileLogger.log('service_worker', 'warn', 'Tab ready assumed', { elapsed });
                resolve(true);
                return;
              }
            } catch (error) {
              this.deps.log('[Acquisition] Failed to check readyState', error);
              FileLogger.log('service_worker', 'error', 'Failed to check readyState', { error: (error as Error).message });
              // Continue waiting
            }
          }
        } catch (error) {
          clearInterval(checkInterval);
          this.deps.log('[Acquisition] Tab check error', error);
          FileLogger.log('service_worker', 'error', 'waitForTabReady ERROR', { error: (error as Error).message });
          resolve(false);
        }
      }, 500); // Check every 500ms
    });
  }
}
