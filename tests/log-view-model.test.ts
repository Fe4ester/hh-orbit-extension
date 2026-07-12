import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../src/utils/fileLogger';
import { formatLogsAsText, getLogVacancyId, getSearchHaystack, groupLogsByVacancy, safeFormatDate, safeStringify } from '../sidepanel/logViewModel';

function makeLog(overrides: Partial<LogEntry> = {}): LogEntry {
  return { timestamp: '2026-07-12T10:00:00.000Z', level: 'info', source: 'sidepanel', message: 'Apply result', ...overrides };
}

describe('logViewModel', () => {
  it('formats invalid timestamps without throwing', () => {
    expect(() => safeFormatDate('not-a-date')).not.toThrow();
    expect(safeFormatDate('not-a-date')).toBe('Некорректная дата');
  });

  it('serializes cyclic and non-JSON context safely', () => {
    const context: Record<string, unknown> = { count: 4n };
    context.self = context;
    expect(() => safeStringify(context)).not.toThrow();
    expect(safeStringify(context)).toContain('[Circular]');
    expect(safeStringify(context)).toContain('4n');
  });

  it('only uses context.id when the event has vacancy evidence', () => {
    expect(getLogVacancyId(makeLog({ message: 'Profile selected', context: { id: 'profile-7' } }))).toBeNull();
    expect(getLogVacancyId(makeLog({ message: 'Vacancy loaded', context: { id: 123 } }))).toBe('123');
    expect(groupLogsByVacancy([makeLog({ context: { id: 'random' } }), makeLog({ context: { vacancy_id: '456' } })])).toHaveLength(1);
  });

  it('searches identifiers and diagnostic context fields', () => {
    const haystack = getSearchHaystack(makeLog({ context: { vacancyId: 'vac-42', profileId: 'profile-blue', outcome: 'external_apply', reasonCode: 'redirected', nested: { detail: 'Employer portal' } } }));
    for (const query of ['vac-42', 'profile-blue', 'external_apply', 'redirected', 'employer portal']) expect(haystack).toContain(query);
  });

  it('exports every log with context and survives cyclic context', () => {
    const context: Record<string, unknown> = { outcome: 'success' };
    context.self = context;
    const text = formatLogsAsText([makeLog({ context }), makeLog({ message: 'Second event' })]);
    expect(text).toContain('"outcome": "success"');
    expect(text).toContain('[Circular]');
    expect(text).toContain('Second event');
  });
});
