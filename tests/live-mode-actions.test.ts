import { describe, it, expect } from 'vitest';
import {
  activateLiveMode,
  deactivateLiveMode,
  bindControlledTab,
  updateLiveContextFromUrl,
  clearControlledTab,
} from '../src/state/actions';
import { LiveModeState } from '../src/state/types';

describe('Live mode actions', () => {
  it('should activate live mode', () => {
    const result = activateLiveMode();

    expect(result.active).toBe(true);
    expect(result.controlledTabId).toBeNull();
    expect(result.controlledWindowId).toBeNull();
    expect(result.lastHeartbeatAt).toBeDefined();
  });

  it('should deactivate live mode', () => {
    const result = deactivateLiveMode();

    expect(result.active).toBe(false);
    expect(result.controlledTabId).toBeNull();
    expect(result.lastHeartbeatAt).toBeNull();
  });

  it('should bind controlled tab', () => {
    const result = bindControlledTab({
      tabId: 123,
      windowId: 456,
      url: 'https://hh.ru/search/vacancy',
    });

    expect(result.active).toBe(true);
    expect(result.controlledTabId).toBe(123);
    expect(result.controlledWindowId).toBe(456);
    expect(result.currentUrl).toBe('https://hh.ru/search/vacancy');
    expect(result.pageType).toBe('search');
    expect(result.lastHeartbeatAt).toBeDefined();
  });

  it('should bind controlled tab with vacancy', () => {
    const result = bindControlledTab({
      tabId: 123,
      windowId: 456,
      url: 'https://hh.ru/vacancy/789012',
    });

    expect(result.pageType).toBe('vacancy');
    expect(result.detectedVacancyId).toBe('789012');
  });

  it('should update live context from URL', () => {
    const currentState: LiveModeState = {
      active: true,
      controlledTabPurpose: null,
      controlledTabId: 123,
      controlledWindowId: 456,
      currentUrl: 'https://hh.ru/search/vacancy',
      pageType: 'search',
      detectedVacancyId: null,
      detectedResumeHash: null,
      lastHeartbeatAt: Date.now() - 5000,
      targetSearchUrl: null,
      lastAppliedSearchUrl: null,
      lastAppliedProfileId: null,
      searchSyncStatus: 'idle',
      vacancyDetailObservation: null,
      preflightClassification: null,
      searchSyncDiff: null,
      searchLoopActive: false,
      runtimeSearchTabId: null,
      currentSearchPage: null,
      lastScannedPage: null,
      totalPagesDetected: null,
      lastScanVacancyCount: 0,
      searchLoopIterations: 0,
    };

    const result = updateLiveContextFromUrl(currentState, 'https://hh.ru/vacancy/111222');

    expect(result.controlledTabId).toBe(123); // Preserved
    expect(result.currentUrl).toBe('https://hh.ru/vacancy/111222');
    expect(result.pageType).toBe('vacancy');
    expect(result.detectedVacancyId).toBe('111222');
    expect(result.lastHeartbeatAt).toBeGreaterThan(currentState.lastHeartbeatAt!);
  });

  it('should clear controlled tab', () => {
    const currentState: LiveModeState = {
      active: true,
      controlledTabPurpose: null,
      controlledTabId: 123,
      controlledWindowId: 456,
      currentUrl: 'https://hh.ru/vacancy/789',
      pageType: 'vacancy',
      detectedVacancyId: '789',
      detectedResumeHash: null,
      lastHeartbeatAt: Date.now(),
      targetSearchUrl: null,
      lastAppliedSearchUrl: null,
      lastAppliedProfileId: null,
      searchSyncStatus: 'idle',
      vacancyDetailObservation: null,
      preflightClassification: null,
      searchSyncDiff: null,
      searchLoopActive: false,
      runtimeSearchTabId: null,
      currentSearchPage: null,
      lastScannedPage: null,
      totalPagesDetected: null,
      lastScanVacancyCount: 0,
      searchLoopIterations: 0,
    };

    const result = clearControlledTab(currentState);

    expect(result.active).toBe(true); // Still active
    expect(result.controlledTabId).toBeNull();
    expect(result.controlledWindowId).toBeNull();
    expect(result.currentUrl).toBeNull();
    expect(result.pageType).toBeNull();
    expect(result.detectedVacancyId).toBeNull();
  });

  it('should preserve active state when clearing tab', () => {
    const currentState: LiveModeState = {
      active: true,
      controlledTabPurpose: null,
      controlledTabId: 123,
      controlledWindowId: 456,
      currentUrl: 'https://hh.ru/search/vacancy',
      pageType: 'search',
      detectedVacancyId: null,
      detectedResumeHash: null,
      lastHeartbeatAt: Date.now(),
      targetSearchUrl: null,
      lastAppliedSearchUrl: null,
      lastAppliedProfileId: null,
      searchSyncStatus: 'idle',
      vacancyDetailObservation: null,
      preflightClassification: null,
      searchSyncDiff: null,
      searchLoopActive: false,
      runtimeSearchTabId: null,
      currentSearchPage: null,
      lastScannedPage: null,
      totalPagesDetected: null,
      lastScanVacancyCount: 0,
      searchLoopIterations: 0,
    };

    const result = clearControlledTab(currentState);

    expect(result.active).toBe(true);
  });

  it('should detect resume hash in bind', () => {
    const result = bindControlledTab({
      tabId: 123,
      windowId: 456,
      url: 'https://hh.ru/resume/abc123def456',
    });

    expect(result.pageType).toBe('resume');
    expect(result.detectedResumeHash).toBe('abc123def456');
  });

  it('should handle unknown page type', () => {
    const result = bindControlledTab({
      tabId: 123,
      windowId: 456,
      url: 'https://hh.ru/',
    });

    expect(result.pageType).toBe('unknown');
    expect(result.detectedVacancyId).toBeNull();
    expect(result.detectedResumeHash).toBeNull();
  });
});
