import { describe, expect, it } from 'vitest';
import { deriveLaunchScreen, formatLimitsLabel } from '../sidepanel/App';
import type { AppState } from '../src/state/types';

describe('deriveLaunchScreen', () => {
  it('показывает стартовый экран в IDLE', () => {
    expect(deriveLaunchScreen('IDLE', false)).toBe('start');
  });

  it('показывает рабочий экран во время запуска, даже если есть ручные действия', () => {
    expect(deriveLaunchScreen('RUNNING', true)).toBe('running');
    expect(deriveLaunchScreen('STARTING', false)).toBe('running');
  });

  it('ручные действия приоритетнее остановки и ошибки', () => {
    expect(deriveLaunchScreen('STOPPED', true)).toBe('review');
    expect(deriveLaunchScreen('PAUSED_MANUAL_ACTION', false)).toBe('review');
    expect(deriveLaunchScreen('ERROR', true)).toBe('review');
  });

  it('ошибка и остановка мапятся в свои экраны', () => {
    expect(deriveLaunchScreen('ERROR', false)).toBe('error');
    expect(deriveLaunchScreen('STOPPED', false)).toBe('stopped');
    expect(deriveLaunchScreen('PAUSED_NO_VACANCIES', false)).toBe('stopped');
    expect(deriveLaunchScreen('PAUSED_BY_USER', false)).toBe('stopped');
  });
});

describe('formatLimitsLabel', () => {
  const settings = (over: Partial<AppState['settings']>) => ({
    delayMinSeconds: 5,
    delayMaxSeconds: 10,
    maxAutoAppliesPerRun: 30,
    maxAutoAppliesPerDay: 100,
    stopOnManualAction: true,
    ...over,
  }) as AppState['settings'];

  it('собирает лимиты и задержки в одну строку', () => {
    expect(formatLimitsLabel(settings({}))).toBe('30 за запуск · пауза 5–10 с · 100 в день');
  });

  it('нулевой лимит означает отсутствие лимита', () => {
    const label = formatLimitsLabel(settings({ maxAutoAppliesPerRun: 0, maxAutoAppliesPerDay: 0 }));
    expect(label).toBe('без лимита за запуск · пауза 5–10 с · без лимита в день');
  });
});
