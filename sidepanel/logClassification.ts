import type { LogEntry } from '../src/utils/fileLogger';

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

const MANUAL_KEYWORDS = [
  'manual action',
  'questionnaire',
  'questionnaire_required',
  'test required',
  'test_required',
  'cover letter',
  'external apply',
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

function getHaystack(log: LogEntry): string {
  return `${log.message} ${JSON.stringify(log.context || {})}`.toLowerCase();
}

export function detectReason(log: LogEntry): Exclude<ErrorReason, 'all'> {
  const haystack = getHaystack(log);

  if (haystack.includes('cover letter') || haystack.includes('сопровод')) return 'cover_letter';
  if (haystack.includes('questionnaire') || haystack.includes('анкет')) return 'questionnaire';
  if (haystack.includes('test required') || haystack.includes('test_required') || haystack.includes('тест')) return 'test';
  if (haystack.includes('captcha') || haystack.includes('капч')) return 'captcha';
  if (haystack.includes('login') || haystack.includes('auth') || haystack.includes('авториза')) return 'login';
  if (haystack.includes('external apply')) return 'external_apply';
  if (haystack.includes('timeout')) return 'timeout';
  if (haystack.includes('manual action')) return 'manual_action';

  return log.level === 'error' ? 'error' : 'other';
}

export function classifyLogProblem(log: LogEntry): LogProblemKind {
  const haystack = getHaystack(log);
  const reason = detectReason(log);

  if (
    reason === 'questionnaire' ||
    reason === 'test' ||
    reason === 'manual_action' ||
    reason === 'cover_letter' ||
    reason === 'external_apply'
  ) {
    return 'manual_case';
  }

  if (log.level === 'error' || EXECUTION_ERROR_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return 'execution_error';
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

  if (haystack.includes('success') || haystack.includes('processed: success') || haystack.includes('application sent')) {
    return 'success';
  }

  if (problemKind === 'execution_error') return 'error';
  if (problemKind === 'warning' || problemKind === 'manual_case') return 'warn';

  return 'info';
}
