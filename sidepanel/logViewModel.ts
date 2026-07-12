import type { LogEntry } from '../src/utils/fileLogger';
import { classifyLogProblem, detectReason, type ErrorReason, type LogProblemKind } from './logClassification';
import { safeStringify } from './logSerialization';

export { safeStringify } from './logSerialization';

export interface VacancyLogGroup {
  vacancyId: string;
  entries: LogEntry[];
}

export interface LogStats {
  total: number;
  problems: number;
  executionErrors: number;
  manualCases: number;
  warnings: number;
  vacancies: number;
  sources: number;
  topReasons: Array<[Exclude<ErrorReason, 'all'>, number]>;
  recent: LogEntry[];
}

export function safeDate(timestamp: unknown): Date | null {
  const date = typeof timestamp === 'string' || typeof timestamp === 'number'
    ? new Date(timestamp)
    : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function safeFormatDate(timestamp: unknown, invalidTimestampLabel = 'Некорректная дата'): string {
  const date = safeDate(timestamp);
  if (date === null) return invalidTimestampLabel;
  return date.toLocaleString();
}

function contextValue(context: LogEntry['context'], key: string): string | undefined {
  const value = context?.[key];
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

export function getSearchHaystack(log: LogEntry): string {
  const context = log.context;
  return [
    log.message,
    log.source,
    log.level,
    safeStringify(context),
    contextValue(context, 'vacancyId'),
    contextValue(context, 'vacancy_id'),
    contextValue(context, 'profileId'),
    contextValue(context, 'profile_id'),
    contextValue(context, 'outcome'),
    contextValue(context, 'reasonCode'),
  ].filter(Boolean).join(' ').toLowerCase();
}

function hasVacancyEvidence(log: LogEntry): boolean {
  const context = log.context;
  const typeHints = [contextValue(context, 'type'), contextValue(context, 'entityType'), contextValue(context, 'kind')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return typeHints.includes('vacancy') || /\bvacanc(?:y|ies)\b/i.test(`${log.source} ${log.message}`);
}

export function getLogVacancyId(log: LogEntry): string | null {
  const explicit = contextValue(log.context, 'vacancyId') ?? contextValue(log.context, 'vacancy_id');
  if (explicit) return explicit;
  return hasVacancyEvidence(log) ? contextValue(log.context, 'id') ?? null : null;
}

function timestampValue(log: LogEntry): number {
  return safeDate(log.timestamp)?.getTime() ?? Number.NEGATIVE_INFINITY;
}

export function groupLogsByVacancy(logs: LogEntry[]): VacancyLogGroup[] {
  const groups = new Map<string, LogEntry[]>();
  for (const log of logs) {
    const vacancyId = getLogVacancyId(log);
    if (!vacancyId) continue;
    groups.set(vacancyId, [...(groups.get(vacancyId) ?? []), log]);
  }
  return [...groups.entries()]
    .map(([vacancyId, entries]) => ({
      vacancyId,
      entries: [...entries].sort((a, b) => timestampValue(a) - timestampValue(b)),
    }))
    .sort((a, b) => timestampValue(b.entries[b.entries.length - 1]) - timestampValue(a.entries[a.entries.length - 1]));
}

export function buildLogStats(logs: LogEntry[], recentLimit = 8): LogStats {
  const kinds: Record<LogProblemKind, number> = { execution_error: 0, warning: 0, manual_case: 0, none: 0 };
  const reasons = new Map<Exclude<ErrorReason, 'all'>, number>();
  for (const log of logs) {
    const kind = classifyLogProblem(log);
    kinds[kind] += 1;
    if (kind !== 'none') {
      const reason = detectReason(log);
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }
  return {
    total: logs.length,
    problems: kinds.execution_error + kinds.warning + kinds.manual_case,
    executionErrors: kinds.execution_error,
    warnings: kinds.warning,
    manualCases: kinds.manual_case,
    vacancies: groupLogsByVacancy(logs).length,
    sources: new Set(logs.map((log) => log.source)).size,
    topReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    recent: [...logs].sort((a, b) => timestampValue(b) - timestampValue(a)).slice(0, recentLimit),
  };
}

export function formatLogsAsText(logs: LogEntry[]): string {
  return logs.map((log) => {
    const header = `[${safeFormatDate(log.timestamp)}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}`;
    return log.context === undefined ? header : `${header}\n${safeStringify(log.context, 2)}`;
  }).join('\n\n');
}
