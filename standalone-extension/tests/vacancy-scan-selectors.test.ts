import { describe, it, expect } from 'vitest';
import {
  getVacancyScanState,
  isVacancyExhausted,
  getExhaustionReason,
} from '../src/state/selectors';
import { AppState } from '../src/state/types';
import { INITIAL_STATE } from '../src/state/types';

describe('Vacancy scan selectors', () => {
  it('should return vacancy scan state', () => {
    const state = INITIAL_STATE;
    const vacancyScan = getVacancyScanState(state);

    expect(vacancyScan).toBeDefined();
    expect(vacancyScan.consecutiveEmptyScans).toBe(0);
    expect(vacancyScan.exhausted).toBe(false);
  });

  it('should detect exhaustion', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      vacancyScan: {
        consecutiveEmptyScans: 3,
        lastScanAt: Date.now(),
        lastNewVacancyAt: null,
        exhausted: true,
        exhaustedReason: 'consecutive_empty_scans',
      },
    };

    expect(isVacancyExhausted(state)).toBe(true);
  });

  it('should return null reason when not exhausted', () => {
    const state = INITIAL_STATE;
    const reason = getExhaustionReason(state);

    expect(reason).toBeNull();
  });

  it('should return formatted reason for consecutive_empty_scans', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      vacancyScan: {
        consecutiveEmptyScans: 3,
        lastScanAt: Date.now(),
        lastNewVacancyAt: null,
        exhausted: true,
        exhaustedReason: 'consecutive_empty_scans',
      },
    };

    const reason = getExhaustionReason(state);
    expect(reason).toBe('3 сканирований без новых вакансий');
  });

  it('should return formatted reason for no_unseen_vacancies', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      vacancyScan: {
        consecutiveEmptyScans: 3,
        lastScanAt: Date.now(),
        lastNewVacancyAt: null,
        exhausted: true,
        exhaustedReason: 'no_unseen_vacancies',
      },
    };

    const reason = getExhaustionReason(state);
    expect(reason).toBe('Все вакансии уже просмотрены');
  });

  it('should return formatted reason for manual_mark', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      vacancyScan: {
        consecutiveEmptyScans: 3,
        lastScanAt: Date.now(),
        lastNewVacancyAt: null,
        exhausted: true,
        exhaustedReason: 'manual_mark',
      },
    };

    const reason = getExhaustionReason(state);
    expect(reason).toBe('Отмечено вручную');
  });

  it('should return null when exhausted but no reason', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      vacancyScan: {
        consecutiveEmptyScans: 3,
        lastScanAt: Date.now(),
        lastNewVacancyAt: null,
        exhausted: true,
      },
    };

    const reason = getExhaustionReason(state);
    expect(reason).toBeNull();
  });
});
