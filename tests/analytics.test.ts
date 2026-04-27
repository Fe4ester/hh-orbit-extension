import { describe, it, expect } from 'vitest';
import {
  getAllTimeStats,
  getCurrentRunStats,
  getTodayStats,
  getAnalyticsSummary,
  getRecentAttempts,
} from '../src/state/selectors';
import { AppState, AttemptRecord } from '../src/state/types';
import { INITIAL_STATE } from '../src/state/types';
import { seedDemoAnalytics } from '../src/state/actions';

describe('Analytics selectors', () => {
  it('should return zeros for empty analytics', () => {
    const state = INITIAL_STATE;
    const stats = getAllTimeStats(state);

    expect(stats.attemptsTotal).toBe(0);
    expect(stats.succeeded).toBe(0);
    expect(stats.escalated).toBe(0);
    expect(stats.failedRetryable).toBe(0);
    expect(stats.failedFinal).toBe(0);
    expect(stats.manualActionRequired).toBe(0);
    expect(stats.skippedDuplicate).toBe(0);
    expect(stats.successRate).toBe(0);
  });

  it('should compute all-time stats correctly', () => {
    const now = Date.now();
    const attempts: AttemptRecord[] = [
      {
        id: '1',
        outcome: 'SUCCEEDED',
        createdAt: now - 1000,
        finishedAt: now - 900,
        source: 'local',
      },
      {
        id: '2',
        outcome: 'SUCCEEDED',
        createdAt: now - 2000,
        finishedAt: now - 1900,
        source: 'local',
      },
      {
        id: '3',
        outcome: 'ESCALATED',
        createdAt: now - 3000,
        finishedAt: now - 2900,
        source: 'local',
      },
      {
        id: '4',
        outcome: 'FAILED_RETRYABLE',
        createdAt: now - 4000,
        finishedAt: now - 3900,
        source: 'local',
      },
      {
        id: '5',
        outcome: 'FAILED_FINAL',
        createdAt: now - 5000,
        finishedAt: now - 4900,
        source: 'local',
      },
    ];

    const state: AppState = {
      ...INITIAL_STATE,
      analytics: {
        attempts,
        events: [],
        runStartedAt: null,
        runStoppedAt: null,
      },
    };

    const stats = getAllTimeStats(state);

    expect(stats.attemptsTotal).toBe(5);
    expect(stats.succeeded).toBe(2);
    expect(stats.escalated).toBe(1);
    expect(stats.failedRetryable).toBe(1);
    expect(stats.failedFinal).toBe(1);
    expect(stats.successRate).toBe(40); // 2/5 = 40%
  });

  it('should compute current run stats correctly', () => {
    const now = Date.now();
    const runStartedAt = now - 10000;

    const attempts: AttemptRecord[] = [
      // Before run
      {
        id: '1',
        outcome: 'SUCCEEDED',
        createdAt: runStartedAt - 5000,
        finishedAt: runStartedAt - 4900,
        source: 'local',
      },
      // During run
      {
        id: '2',
        outcome: 'SUCCEEDED',
        createdAt: runStartedAt + 1000,
        finishedAt: runStartedAt + 1100,
        source: 'local',
      },
      {
        id: '3',
        outcome: 'FAILED_RETRYABLE',
        createdAt: runStartedAt + 2000,
        finishedAt: runStartedAt + 2100,
        source: 'local',
      },
    ];

    const state: AppState = {
      ...INITIAL_STATE,
      analytics: {
        attempts,
        events: [],
        runStartedAt,
        runStoppedAt: null,
      },
    };

    const stats = getCurrentRunStats(state);

    expect(stats.attemptsTotal).toBe(2);
    expect(stats.succeeded).toBe(1);
    expect(stats.failedRetryable).toBe(1);
    expect(stats.successRate).toBe(50);
  });

  it('should return empty stats when run not started', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      analytics: {
        attempts: [
          {
            id: '1',
            outcome: 'SUCCEEDED',
            createdAt: Date.now(),
            finishedAt: Date.now(),
            source: 'local',
          },
        ],
        events: [],
        runStartedAt: null,
        runStoppedAt: null,
      },
    };

    const stats = getCurrentRunStats(state);

    expect(stats.attemptsTotal).toBe(0);
  });

  it('should compute today stats correctly', () => {
    const now = Date.now();
    const startOfDay = new Date(now).setHours(0, 0, 0, 0);

    const attempts: AttemptRecord[] = [
      // Yesterday
      {
        id: '1',
        outcome: 'SUCCEEDED',
        createdAt: startOfDay - 1000,
        finishedAt: startOfDay - 900,
        source: 'local',
      },
      // Today
      {
        id: '2',
        outcome: 'SUCCEEDED',
        createdAt: startOfDay + 1000,
        finishedAt: startOfDay + 1100,
        source: 'local',
      },
      {
        id: '3',
        outcome: 'ESCALATED',
        createdAt: now - 1000,
        finishedAt: now - 900,
        source: 'local',
      },
    ];

    const state: AppState = {
      ...INITIAL_STATE,
      analytics: {
        attempts,
        events: [],
        runStartedAt: null,
        runStoppedAt: null,
      },
    };

    const stats = getTodayStats(state);

    expect(stats.attemptsTotal).toBe(2);
    expect(stats.succeeded).toBe(1);
    expect(stats.escalated).toBe(1);
  });

  it('should compute success rate correctly', () => {
    const now = Date.now();
    const attempts: AttemptRecord[] = [
      { id: '1', outcome: 'SUCCEEDED', createdAt: now, finishedAt: now, source: 'local' },
      { id: '2', outcome: 'SUCCEEDED', createdAt: now, finishedAt: now, source: 'local' },
      { id: '3', outcome: 'SUCCEEDED', createdAt: now, finishedAt: now, source: 'local' },
      { id: '4', outcome: 'FAILED_RETRYABLE', createdAt: now, finishedAt: now, source: 'local' },
    ];

    const state: AppState = {
      ...INITIAL_STATE,
      analytics: {
        attempts,
        events: [],
        runStartedAt: null,
        runStoppedAt: null,
      },
    };

    const stats = getAllTimeStats(state);

    expect(stats.successRate).toBe(75); // 3/4 = 75%
  });

  it('should return analytics summary', () => {
    const now = Date.now();
    const runStartedAt = now - 5000;

    const attempts: AttemptRecord[] = [
      {
        id: '1',
        outcome: 'SUCCEEDED',
        createdAt: runStartedAt + 1000,
        finishedAt: runStartedAt + 1100,
        source: 'local',
      },
    ];

    const state: AppState = {
      ...INITIAL_STATE,
      analytics: {
        attempts,
        events: [],
        runStartedAt,
        runStoppedAt: null,
      },
    };

    const summary = getAnalyticsSummary(state);

    expect(summary.allTime.attemptsTotal).toBe(1);
    expect(summary.currentRun.attemptsTotal).toBe(1);
    expect(summary.isRunActive).toBe(true);
  });

  it('should detect run not active when stopped', () => {
    const now = Date.now();
    const state: AppState = {
      ...INITIAL_STATE,
      analytics: {
        attempts: [],
        events: [],
        runStartedAt: now - 10000,
        runStoppedAt: now - 5000,
      },
    };

    const summary = getAnalyticsSummary(state);

    expect(summary.isRunActive).toBe(false);
  });

  it('should return recent attempts sorted by time', () => {
    const now = Date.now();
    const attempts: AttemptRecord[] = [
      {
        id: '1',
        outcome: 'SUCCEEDED',
        createdAt: now - 5000,
        finishedAt: now - 4900,
        source: 'local',
      },
      {
        id: '2',
        outcome: 'SUCCEEDED',
        createdAt: now - 3000,
        finishedAt: now - 2900,
        source: 'local',
      },
      {
        id: '3',
        outcome: 'SUCCEEDED',
        createdAt: now - 1000,
        finishedAt: now - 900,
        source: 'local',
      },
    ];

    const state: AppState = {
      ...INITIAL_STATE,
      analytics: {
        attempts,
        events: [],
        runStartedAt: null,
        runStoppedAt: null,
      },
    };

    const recent = getRecentAttempts(state, 2);

    expect(recent).toHaveLength(2);
    expect(recent[0].id).toBe('3'); // Most recent
    expect(recent[1].id).toBe('2');
  });

  it('should limit recent attempts', () => {
    const now = Date.now();
    const attempts: AttemptRecord[] = Array.from({ length: 20 }, (_, i) => ({
      id: `${i}`,
      outcome: 'SUCCEEDED' as const,
      createdAt: now - (20 - i) * 1000,
      finishedAt: now - (20 - i) * 1000 + 100,
      source: 'local' as const,
    }));

    const state: AppState = {
      ...INITIAL_STATE,
      analytics: {
        attempts,
        events: [],
        runStartedAt: null,
        runStoppedAt: null,
      },
    };

    const recent = getRecentAttempts(state, 5);

    expect(recent).toHaveLength(5);
  });

  it('should handle all outcome types', () => {
    const now = Date.now();
    const attempts: AttemptRecord[] = [
      { id: '1', outcome: 'SUCCEEDED', createdAt: now, finishedAt: now, source: 'local' },
      { id: '2', outcome: 'ESCALATED', createdAt: now, finishedAt: now, source: 'local' },
      { id: '3', outcome: 'FAILED_RETRYABLE', createdAt: now, finishedAt: now, source: 'local' },
      { id: '4', outcome: 'FAILED_FINAL', createdAt: now, finishedAt: now, source: 'local' },
      {
        id: '5',
        outcome: 'MANUAL_ACTION_REQUIRED',
        createdAt: now,
        finishedAt: now,
        source: 'local',
      },
      { id: '6', outcome: 'SKIPPED_DUPLICATE', createdAt: now, finishedAt: now, source: 'local' },
    ];

    const state: AppState = {
      ...INITIAL_STATE,
      analytics: {
        attempts,
        events: [],
        runStartedAt: null,
        runStoppedAt: null,
      },
    };

    const stats = getAllTimeStats(state);

    expect(stats.attemptsTotal).toBe(6);
    expect(stats.succeeded).toBe(1);
    expect(stats.escalated).toBe(1);
    expect(stats.failedRetryable).toBe(1);
    expect(stats.failedFinal).toBe(1);
    expect(stats.manualActionRequired).toBe(1);
    expect(stats.skippedDuplicate).toBe(1);
  });

  it('should seed demo analytics correctly', () => {
    const { attempts, events } = seedDemoAnalytics();

    expect(attempts.length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThanOrEqual(0);

    // Check outcomes variety
    const outcomes = new Set(attempts.map((a) => a.outcome));
    expect(outcomes.size).toBeGreaterThan(1);

    // Check time distribution
    const now = Date.now();
    const hasHistorical = attempts.some((a) => now - a.createdAt > 24 * 60 * 60 * 1000);
    const hasRecent = attempts.some((a) => now - a.createdAt < 60 * 60 * 1000);

    expect(hasHistorical).toBe(true);
    expect(hasRecent).toBe(true);
  });

  it('should maintain consistency between Home and Analytics selectors', () => {
    const { attempts } = seedDemoAnalytics();
    const now = Date.now();

    const state: AppState = {
      ...INITIAL_STATE,
      analytics: {
        attempts,
        events: [],
        runStartedAt: now - 30 * 60 * 1000,
        runStoppedAt: null,
      },
    };

    const summary1 = getAnalyticsSummary(state);
    const summary2 = getAnalyticsSummary(state);

    // Same state should produce identical results
    expect(summary1.allTime).toEqual(summary2.allTime);
    expect(summary1.currentRun).toEqual(summary2.currentRun);
    expect(summary1.today).toEqual(summary2.today);
    expect(summary1.isRunActive).toBe(summary2.isRunActive);
  });
});
