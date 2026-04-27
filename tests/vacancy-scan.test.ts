import { describe, it, expect } from 'vitest';
import {
  recordVacancyScan,
  markNoMoreVacancies,
  resetVacancyExhaustion,
  NO_MORE_VACANCIES_THRESHOLD,
} from '../src/state/actions';
import { VacancyScanState } from '../src/state/types';

describe('Vacancy scan actions', () => {
  const initialState: VacancyScanState = {
    consecutiveEmptyScans: 0,
    lastScanAt: null,
    lastNewVacancyAt: null,
    exhausted: false,
  };

  it('should increment consecutiveEmptyScans on empty scan', () => {
    const result = recordVacancyScan(initialState, {
      foundCount: 10,
      newCount: 0,
      timestamp: Date.now(),
    });

    expect(result.consecutiveEmptyScans).toBe(1);
    expect(result.exhausted).toBe(false);
  });

  it('should reset exhaustion when new vacancies found', () => {
    const state: VacancyScanState = {
      consecutiveEmptyScans: 2,
      lastScanAt: Date.now() - 1000,
      lastNewVacancyAt: Date.now() - 5000,
      exhausted: false,
    };

    const result = recordVacancyScan(state, {
      foundCount: 15,
      newCount: 5,
      timestamp: Date.now(),
    });

    expect(result.consecutiveEmptyScans).toBe(0);
    expect(result.exhausted).toBe(false);
    expect(result.lastNewVacancyAt).toBe(result.lastScanAt);
  });

  it('should mark exhausted when threshold reached', () => {
    let state = initialState;

    // Scan 1
    state = recordVacancyScan(state, {
      foundCount: 10,
      newCount: 0,
      timestamp: Date.now(),
    });
    expect(state.exhausted).toBe(false);

    // Scan 2
    state = recordVacancyScan(state, {
      foundCount: 10,
      newCount: 0,
      timestamp: Date.now(),
    });
    expect(state.exhausted).toBe(false);

    // Scan 3 - should trigger exhaustion
    state = recordVacancyScan(state, {
      foundCount: 10,
      newCount: 0,
      timestamp: Date.now(),
    });
    expect(state.exhausted).toBe(true);
    expect(state.exhaustedReason).toBe('consecutive_empty_scans');
    expect(state.consecutiveEmptyScans).toBe(NO_MORE_VACANCIES_THRESHOLD);
  });

  it('should mark exhausted manually', () => {
    const result = markNoMoreVacancies('manual_mark');

    expect(result.exhausted).toBe(true);
    expect(result.exhaustedReason).toBe('manual_mark');
    expect(result.consecutiveEmptyScans).toBe(NO_MORE_VACANCIES_THRESHOLD);
  });

  it('should reset exhaustion', () => {
    const result = resetVacancyExhaustion();

    expect(result.consecutiveEmptyScans).toBe(0);
    expect(result.exhausted).toBe(false);
    expect(result.exhaustedReason).toBeUndefined();
    expect(result.lastScanAt).toBeNull();
    expect(result.lastNewVacancyAt).toBeNull();
  });

  it('should update lastScanAt on every scan', () => {
    const timestamp = Date.now();
    const result = recordVacancyScan(initialState, {
      foundCount: 10,
      newCount: 0,
      timestamp,
    });

    expect(result.lastScanAt).toBe(timestamp);
  });

  it('should update lastNewVacancyAt only when new vacancies found', () => {
    const timestamp1 = Date.now();
    let state = recordVacancyScan(initialState, {
      foundCount: 10,
      newCount: 0,
      timestamp: timestamp1,
    });

    expect(state.lastNewVacancyAt).toBeNull();

    const timestamp2 = Date.now();
    state = recordVacancyScan(state, {
      foundCount: 15,
      newCount: 5,
      timestamp: timestamp2,
    });

    expect(state.lastNewVacancyAt).toBe(timestamp2);
  });

  it('should not mark exhausted before threshold', () => {
    let state = initialState;

    for (let i = 0; i < NO_MORE_VACANCIES_THRESHOLD - 1; i++) {
      state = recordVacancyScan(state, {
        foundCount: 10,
        newCount: 0,
        timestamp: Date.now(),
      });
    }

    expect(state.consecutiveEmptyScans).toBe(NO_MORE_VACANCIES_THRESHOLD - 1);
    expect(state.exhausted).toBe(false);
  });

  it('should handle alternating empty and new scans', () => {
    let state = initialState;

    // Empty scan
    state = recordVacancyScan(state, {
      foundCount: 10,
      newCount: 0,
      timestamp: Date.now(),
    });
    expect(state.consecutiveEmptyScans).toBe(1);

    // New vacancies - reset
    state = recordVacancyScan(state, {
      foundCount: 15,
      newCount: 5,
      timestamp: Date.now(),
    });
    expect(state.consecutiveEmptyScans).toBe(0);

    // Empty scan again
    state = recordVacancyScan(state, {
      foundCount: 10,
      newCount: 0,
      timestamp: Date.now(),
    });
    expect(state.consecutiveEmptyScans).toBe(1);
    expect(state.exhausted).toBe(false);
  });

  it('should preserve lastNewVacancyAt during empty scans', () => {
    const timestamp1 = Date.now();
    let state = recordVacancyScan(initialState, {
      foundCount: 15,
      newCount: 5,
      timestamp: timestamp1,
    });

    const lastNewVacancyAt = state.lastNewVacancyAt;

    // Empty scan
    state = recordVacancyScan(state, {
      foundCount: 10,
      newCount: 0,
      timestamp: Date.now(),
    });

    expect(state.lastNewVacancyAt).toBe(lastNewVacancyAt);
  });

  it('should handle different exhaustion reasons', () => {
    const reasons: Array<'consecutive_empty_scans' | 'no_unseen_vacancies' | 'manual_mark'> = [
      'consecutive_empty_scans',
      'no_unseen_vacancies',
      'manual_mark',
    ];

    reasons.forEach((reason) => {
      const result = markNoMoreVacancies(reason);
      expect(result.exhausted).toBe(true);
      expect(result.exhaustedReason).toBe(reason);
    });
  });
});
