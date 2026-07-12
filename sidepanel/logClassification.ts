import type { LogEntry } from '../src/utils/fileLogger';
import { safeStringify } from './logSerialization';

export type ErrorReason =
  | 'all'
  | 'cover_letter'
  | 'questionnaire'
  | 'test'
  | 'captcha'
  | 'login'
  | 'external_apply'
  | 'timeout'
  | 'manual_action'
  | 'error'
  | 'other';

export type LogProblemKind = 'execution_error' | 'warning' | 'manual_case' | 'none';
export type VacancyVisualStatus = 'success' | 'warn' | 'error' | 'info';
export type ProblemBadgeLevel = 'error' | 'warn' | 'info';

const MANUAL_KEYWORDS = [
  'manual action',
];

const WARNING_KEYWORDS = [
  'login',
  'auth',
  'captcha',
  'timeout',
  'blocked',
  'redirect',
];

const EXECUTION_ERROR_KEYWORDS = [
  'error',
  'failed',
  'exception',
  'crash',
];

const HANDLED_MANUAL_OUTCOMES = new Set([
  'manual_action_required',
  'manual_action',
]);

const HANDLED_NON_ERROR_OUTCOMES = new Set([
  ...HANDLED_MANUAL_OUTCOMES,
  'cover_letter_required',
  'questionnaire_required',
  'test_required',
  'external_apply',
  'already_applied',
  'already_applied_to_vacancy',
  'auth_required',
  'login_required',
  'captcha_required',
  'timeout',
  'blocked',
]);

function getContextStrings(log: LogEntry): string[] {
  const context = log.context || {};
  const values = [
    context.outcome,
    context.reason,
    context.reasonCode,
    context.error,
    context.status,
    context.blocker,
    context.type,
  ];

  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.toLowerCase());
}

function getHaystack(log: LogEntry): string {
  return `${log.message} ${safeStringify(log.context || {})}`.toLowerCase();
}

function getMessageHaystack(log: LogEntry): string {
  return log.message.toLowerCase();
}

function hasExecutionErrorOutcome(log: LogEntry): boolean {
  const contextStrings = getContextStrings(log);
  const outcome = contextStrings[0] || null;

  if (contextStrings.some((value) => HANDLED_NON_ERROR_OUTCOMES.has(value))) {
    return false;
  }

  return (
    outcome === 'error' ||
    outcome === 'failed' ||
    outcome === 'failure' ||
    outcome === 'server_error' ||
    outcome === 'unknown' ||
    contextStrings.some((value) =>
      value === 'exception' ||
      value === 'network_error' ||
      value === 'runtime_error' ||
      value === 'execution_error'
    )
  );
}

export function detectReason(log: LogEntry): Exclude<ErrorReason, 'all'> {
  const haystack = getHaystack(log);
  const contextStrings = getContextStrings(log);

  if (
    haystack.includes('manual action') ||
    haystack.includes('manual_action') ||
    contextStrings.includes('manual_action_required')
  ) return 'manual_action';
  if (
    haystack.includes('cover letter') ||
    haystack.includes('cover_letter') ||
    haystack.includes('сопровод') ||
    contextStrings.includes('cover_letter_required')
  ) return 'cover_letter';
  if (
    haystack.includes('questionnaire') ||
    haystack.includes('questionnaire_required') ||
    haystack.includes('анкет')
  ) return 'questionnaire';
  if (
    haystack.includes('test required') ||
    haystack.includes('test_required') ||
    haystack.includes('тест')
  ) return 'test';
  if (haystack.includes('captcha') || haystack.includes('captcha_required') || haystack.includes('капч')) return 'captcha';
  if (
    haystack.includes('login') ||
    haystack.includes('auth') ||
    haystack.includes('login_required') ||
    haystack.includes('auth_required') ||
    haystack.includes('авториза')
  ) return 'login';
  if (haystack.includes('external apply') || haystack.includes('external_apply')) return 'external_apply';
  if (haystack.includes('timeout')) return 'timeout';
  if (hasExecutionErrorOutcome(log)) return 'error';

  return log.level === 'error' ? 'error' : 'other';
}

export function classifyLogProblem(log: LogEntry): LogProblemKind {
  const haystack = getHaystack(log);
  const messageHaystack = getMessageHaystack(log);
  const reason = detectReason(log);
  const outcome = typeof log.context?.outcome === 'string' ? log.context.outcome.toLowerCase() : null;

  if (outcome === 'success' || log.context?.success === true) {
    return 'none';
  }

  if (outcome && HANDLED_NON_ERROR_OUTCOMES.has(outcome)) {
    if (HANDLED_MANUAL_OUTCOMES.has(outcome) || reason === 'questionnaire' || reason === 'test' || reason === 'external_apply') {
      return 'manual_case';
    }
    if (reason === 'cover_letter' || reason === 'captcha' || reason === 'login' || reason === 'timeout' || outcome === 'blocked') {
      return 'warning';
    }
    return 'none';
  }

  if (reason === 'manual_action') {
    return 'manual_case';
  }

  if (
    log.level === 'error' ||
    hasExecutionErrorOutcome(log) ||
    EXECUTION_ERROR_KEYWORDS.some((keyword) => messageHaystack.includes(keyword))
  ) {
    return 'execution_error';
  }

  if (
    reason === 'questionnaire' ||
    reason === 'test' ||
    reason === 'external_apply'
  ) {
    return 'manual_case';
  }

  if (reason === 'cover_letter') {
    return 'warning';
  }

  if (log.level === 'warn' || WARNING_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return 'warning';
  }

  if (MANUAL_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return 'manual_case';
  }

  return 'none';
}

export function isProblemLog(log: LogEntry): boolean {
  return classifyLogProblem(log) !== 'none';
}

export function detectVacancyStatus(log: LogEntry): VacancyVisualStatus {
  const haystack = getHaystack(log);
  const problemKind = classifyLogProblem(log);
  const contextStrings = getContextStrings(log);
  const hasPositiveSuccessOutcome =
    contextStrings.includes('success') ||
    haystack.includes('processed: success') ||
    haystack.includes('application sent') ||
    haystack.includes('отклик отправлен');

  if (hasPositiveSuccessOutcome) {
    return 'success';
  }

  if (problemKind === 'execution_error') return 'error';
  if (problemKind === 'warning' || problemKind === 'manual_case') return 'warn';

  return 'info';
}

export function getProblemBadgeLevel(log: LogEntry): ProblemBadgeLevel {
  const problemKind = classifyLogProblem(log);

  if (problemKind === 'execution_error') return 'error';
  if (problemKind === 'warning' || problemKind === 'manual_case') return 'warn';

  return 'info';
}
