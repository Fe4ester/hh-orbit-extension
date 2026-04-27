/**
 * Vacancy Acquisition Service
 *
 * Backend-like acquisition: build URL -> open tab -> wait -> parse -> materialize queue.
 * Returns structured result, not side effects.
 */

import { StateStore } from '../state/store';
import { buildHHSearchUrl } from '../live/searchQueryBuilder';
import { parseSearchResults } from '../live/searchResultsParser';
import { FileLogger } from '../utils/fileLogger';

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
    this.deps.log('[Acquisition] ACQUISITION START', { profileId });
    FileLogger.log('service_worker', 'info', 'Acquisition START', { profileId });

    const state = this.deps.store.getState();
    const profile = state.profiles[profileId];

    if (!profile) {
      this.deps.log('[Acquisition] Profile not found');
      FileLogger.log('service_worker', 'error', 'Acquisition: Profile not found', { profileId });
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
      this.deps.log('[Acquisition] ERROR: No controlled tab');
      FileLogger.log('service_worker', 'error', 'Acquisition: No controlled tab');
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

    const searchUrl = buildHHSearchUrl(profile);
    this.deps.log('[Acquisition] Search URL', { searchUrl, controlledTabId });
    FileLogger.log('service_worker', 'info', 'Acquisition: Navigating to search', { searchUrl, controlledTabId });

    try {
      // Navigate controlled tab to search URL
      this.deps.log('[Acquisition] Navigating controlled tab to search', { tabId: controlledTabId, url: searchUrl });
      await chrome.tabs.update(controlledTabId, { url: searchUrl, active: true });

      // Wait for navigation complete
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
      FileLogger.log('service_worker', 'info', 'Acquisition: Tab ready');

      // Check if we got redirected away from search
      const tab = await chrome.tabs.get(controlledTabId);
      const actualUrl = tab.url || '';

      if (!actualUrl.includes('/search/vacancy')) {
        this.deps.log('[Acquisition] Redirected away from search', {
          expected: searchUrl,
          actual: actualUrl
        });

        // Try to navigate back to search
        this.deps.log('[Acquisition] Forcing navigation back to search');
        await chrome.tabs.update(controlledTabId, { url: searchUrl, active: true });

        const retryReady = await this.waitForTabReady(controlledTabId, searchUrl, 30000);
        if (!retryReady) {
          return {
            success: false,
            currentUrl: actualUrl,
            pageType: 'unknown',
            cardsFound: 0,
            newQueued: 0,
            queueSizeAfter: 0,
            error: 'redirect_loop',
          };
        }
      }

      // Ping content script to verify it's loaded
      this.deps.log('[Acquisition] Pinging content script', { tabId: controlledTabId });
      FileLogger.log('service_worker', 'info', 'Acquisition: Pinging content script', { tabId: controlledTabId });

      let contentScriptReady = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await chrome.tabs.sendMessage(controlledTabId, { type: 'PING' }, { frameId: 0 });
          this.deps.log('[Acquisition] Content script responding');
          FileLogger.log('service_worker', 'info', 'Acquisition: Content script ready');
          contentScriptReady = true;
          break;
        } catch (error) {
          this.deps.log(`[Acquisition] Content script not responding (attempt ${attempt + 1}/5)`, error);
          FileLogger.log('service_worker', 'warn', 'Content script not responding', { attempt: attempt + 1 });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!contentScriptReady) {
        this.deps.log('[Acquisition] Content script failed to load');
        FileLogger.log('service_worker', 'error', 'Acquisition: Content script not loaded');
        return {
          success: false,
          currentUrl: searchUrl,
          pageType: 'unknown',
          cardsFound: 0,
          newQueued: 0,
          queueSizeAfter: 0,
          error: 'content_script_not_loaded',
        };
      }

      // Get HTML from content script
      this.deps.log('[Acquisition] Getting HTML from content script', { tabId: controlledTabId });
      FileLogger.log('service_worker', 'info', 'Acquisition: Getting HTML');
      const htmlResponse = await chrome.tabs.sendMessage(controlledTabId, { type: 'GET_HTML' }, { frameId: 0 });
      const html = htmlResponse?.html;

      this.deps.log('[Acquisition] HTML fetched', { length: html?.length || 0 });

      if (!html || html.length === 0) {
        FileLogger.log('service_worker', 'error', 'Acquisition: Empty HTML');
        return {
          success: false,
          currentUrl: searchUrl,
          pageType: 'unknown',
          cardsFound: 0,
          newQueued: 0,
          queueSizeAfter: 0,
          error: 'empty_html',
        };
      }
      FileLogger.log('service_worker', 'info', 'Acquisition: HTML fetched', { length: html.length });

      // Parse search results
      const cards = parseSearchResults(html);
      this.deps.log('[Acquisition] Cards parsed', { count: cards.length });
      FileLogger.log('service_worker', 'info', 'Acquisition: Cards parsed', { count: cards.length });

      if (cards.length === 0) {
        FileLogger.log('service_worker', 'warn', 'Acquisition: No vacancy cards found');
        return {
          success: true,
          currentUrl: searchUrl,
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

      this.deps.log('[Acquisition] SUCCESS', {
        cardsFound: cards.length,
        queueBefore,
        queueAfter,
        newQueued: queueAfter - queueBefore,
        queueSizeAfter: queueCount,
      });
      FileLogger.log('service_worker', 'info', 'Acquisition SUCCESS', {
        cardsFound: cards.length,
        queueBefore,
        queueAfter,
        newQueued: queueAfter - queueBefore,
        queueSizeAfter: queueCount,
      });

      return {
        success: true,
        currentUrl: searchUrl,
        pageType: 'search',
        cardsFound: cards.length,
        newQueued: cards.length,
        queueSizeAfter: queueCount,
      };
    } catch (error) {
      this.deps.log('[Acquisition] Error:', error);
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
    this.deps.log('[Acquisition] Waiting for tab to load', { timeout: timeoutMs });
    FileLogger.log('service_worker', 'info', 'waitForTabReady START', { tabId, timeout: timeoutMs });

    return new Promise((resolve) => {
      let lastStatus = '';
      let readyCheckAttempts = 0;

      const checkInterval = setInterval(async () => {
        try {
          const tab = await chrome.tabs.get(tabId);
          const elapsed = Date.now() - startTime;

          if (elapsed > timeoutMs) {
            clearInterval(checkInterval);
            this.deps.log('[Acquisition] Tab load timeout', { elapsed: `${Math.floor(elapsed / 1000)}s` });
            FileLogger.log('service_worker', 'warn', 'waitForTabReady TIMEOUT', { tabId, elapsed });
            resolve(false);
            return;
          }

          if (lastStatus !== tab.status) {
            this.deps.log('[Acquisition] Tab status', {
              status: tab.status,
              url: tab.url,
              elapsed: `${Math.floor(elapsed / 1000)}s`
            });
            FileLogger.log('service_worker', 'debug', 'Tab status', { status: tab.status, elapsed });
            lastStatus = tab.status || '';
          }

          // Check if URL is correct
          if (!tab.url?.includes('/search/vacancy')) {
            this.deps.log('[Acquisition] Tab navigated away from search', { url: tab.url });
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
              this.deps.log('[Acquisition] Document readyState', { readyState, elapsed: `${Math.floor(elapsed / 1000)}s` });
              FileLogger.log('service_worker', 'debug', 'Document readyState', { readyState, elapsed });

              if (readyState === 'complete' || readyState === 'interactive') {
                clearInterval(checkInterval);
                this.deps.log('[Acquisition] Tab ready', { readyState, elapsed: `${Math.floor(elapsed / 1000)}s` });
                FileLogger.log('service_worker', 'info', 'waitForTabReady SUCCESS', { readyState, elapsed });
                resolve(true);
                return;
              }

              // Still loading, retry up to 3 times
              readyCheckAttempts++;
              if (readyCheckAttempts >= 3) {
                clearInterval(checkInterval);
                this.deps.log('[Acquisition] Tab stuck in loading, assuming ready', { elapsed: `${Math.floor(elapsed / 1000)}s` });
                FileLogger.log('service_worker', 'warn', 'waitForTabReady ASSUME_READY', { elapsed });
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
