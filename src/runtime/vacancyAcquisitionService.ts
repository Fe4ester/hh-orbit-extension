/**
 * Vacancy Acquisition Service
 *
 * Handles vacancy discovery and normalization for auto-apply pipeline.
 * Internal service - not a user-facing live tab ritual.
 */

import { StateStore } from '../state/store';
import { parseSearchResults } from '../live/searchResultsParser';
import { buildGlobalSearchUrl } from '../live/advancedSearchFormFiller';

export interface VacancyAcquisitionResult {
  ok: boolean;
  count: number;
  reason?: string;
}

export interface VacancyAcquisitionDeps {
  store: StateStore;
  log: (...args: any[]) => void;
}

export class VacancyAcquisitionService {
  constructor(private deps: VacancyAcquisitionDeps) {}

  /**
   * Acquire vacancies for given profile.
   * Creates hidden tab, fetches search results, parses, materializes to queue.
   */
  async acquireForProfile(profileId: string): Promise<VacancyAcquisitionResult> {
    this.deps.log('[VacancyAcquisition] START', { profileId });

    const state = this.deps.store.getState();
    const profile = state.profiles[profileId];

    if (!profile) {
      this.deps.log('[VacancyAcquisition] Profile not found');
      return { ok: false, count: 0, reason: 'profile_not_found' };
    }

    // Build global search URL
    const resumeHash = state.selectedResumeHash;
    const searchUrl = buildGlobalSearchUrl(resumeHash);
    this.deps.log('[VacancyAcquisition] Search URL built', {
      searchUrl,
      strategy: 'global_search',
      resumeHash: resumeHash || 'none'
    });

    try {
      // Create hidden tab for acquisition
      const tab = await chrome.tabs.create({
        url: searchUrl,
        active: false, // Hidden tab
      });

      if (!tab.id) {
        this.deps.log('[VacancyAcquisition] Tab creation failed');
        return { ok: false, count: 0, reason: 'tab_creation_failed' };
      }

      this.deps.log('[VacancyAcquisition] Hidden tab created', { tabId: tab.id });

      // Wait for page load
      await this.waitForTabLoad(tab.id);

      // Get HTML from tab
      const [htmlResult] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.documentElement.outerHTML,
      });

      const html = htmlResult.result as string;

      if (!html || html.length === 0) {
        this.deps.log('[VacancyAcquisition] Empty HTML');
        await chrome.tabs.remove(tab.id);
        return { ok: false, count: 0, reason: 'empty_html' };
      }

      this.deps.log('[VacancyAcquisition] HTML fetched', { length: html.length });

      // Parse search results
      const cards = parseSearchResults(html);

      this.deps.log('[VacancyAcquisition] Search results parsed', { count: cards.length });

      if (cards.length === 0) {
        await chrome.tabs.remove(tab.id);
        return { ok: false, count: 0, reason: 'no_results' };
      }

      // Materialize to queue
      await this.deps.store.materializeVacanciesFromSearch(cards, profileId);

      const stateAfter = this.deps.store.getState();
      const queueCount = stateAfter.vacancyQueue.filter((v) => v.status === 'discovered').length;

      this.deps.log('[VacancyAcquisition] Vacancies materialized', {
        parsed: cards.length,
        queueCount,
      });

      // Close hidden tab
      await chrome.tabs.remove(tab.id);

      return { ok: true, count: queueCount };
    } catch (error) {
      this.deps.log('[VacancyAcquisition] Error:', error);
      return { ok: false, count: 0, reason: (error as Error).message };
    }
  }

  private async waitForTabLoad(tabId: number, timeoutMs: number = 10000): Promise<boolean> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        try {
          const tab = await chrome.tabs.get(tabId);

          if (tab.status === 'complete') {
            clearInterval(checkInterval);
            resolve(true);
            return;
          }

          if (Date.now() - startTime > timeoutMs) {
            clearInterval(checkInterval);
            this.deps.log('[VacancyAcquisition] Tab load timeout');
            resolve(false);
          }
        } catch (error) {
          clearInterval(checkInterval);
          this.deps.log('[VacancyAcquisition] Tab check error:', error);
          resolve(false);
        }
      }, 500);
    });
  }
}
