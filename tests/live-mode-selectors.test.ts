import { describe, it, expect } from 'vitest';
import {
  getLiveModeState,
  isLiveModeActive,
  hasControlledTab,
  getControlledTabId,
  getCurrentPageType,
  getPageTypeLabel,
} from '../src/state/selectors';
import { AppState } from '../src/state/types';
import { INITIAL_STATE } from '../src/state/types';

describe('Live mode selectors', () => {
  it('should return live mode state', () => {
    const state = INITIAL_STATE;
    const liveMode = getLiveModeState(state);

    expect(liveMode).toBeDefined();
    expect(liveMode.active).toBe(false);
    expect(liveMode.controlledTabId).toBeNull();
  });

  it('should detect active live mode', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      liveMode: {
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
      },
    };

    expect(isLiveModeActive(state)).toBe(true);
  });

  it('should detect inactive live mode', () => {
    const state = INITIAL_STATE;
    expect(isLiveModeActive(state)).toBe(false);
  });

  it('should detect controlled tab', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      liveMode: {
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
      },
    };

    expect(hasControlledTab(state)).toBe(true);
    expect(getControlledTabId(state)).toBe(123);
  });

  it('should detect no controlled tab', () => {
    const state = INITIAL_STATE;
    expect(hasControlledTab(state)).toBe(false);
    expect(getControlledTabId(state)).toBeNull();
  });

  it('should get current page type', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      liveMode: {
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
      },
    };

    expect(getCurrentPageType(state)).toBe('vacancy');
  });

  it('should format page type labels', () => {
    expect(getPageTypeLabel('search')).toBe('Поиск вакансий');
    expect(getPageTypeLabel('vacancy')).toBe('Страница вакансии');
    expect(getPageTypeLabel('resume')).toBe('Резюме');
    expect(getPageTypeLabel('applicant')).toBe('Личный кабинет');
    expect(getPageTypeLabel('login')).toBe('Вход');
    expect(getPageTypeLabel('unknown')).toBe('Неизвестная страница');
    expect(getPageTypeLabel(null)).toBe('Не определено');
  });
});
