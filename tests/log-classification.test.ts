import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../src/utils/fileLogger';
import {
  classifyLogProblem,
  detectReason,
  detectVacancyStatus,
  getProblemBadgeLevel,
  isProblemLog,
} from '../sidepanel/logClassification';

function makeLog(overrides: Partial<LogEntry>): LogEntry {
  return {
    timestamp: Date.now(),
    level: 'info',
    source: 'test',
    message: 'message',
    ...overrides,
  };
}

describe('logClassification', () => {
  it('does not treat a successful checkAuth result as a problem', () => {
    const log = makeLog({
      level: 'warn',
      message: '[BackendHTTP] checkAuth result',
      context: { authorized: true },
    });

    expect(detectReason(log)).toBe('other');
    expect(classifyLogProblem(log)).toBe('none');
    expect(isProblemLog(log)).toBe(false);
    expect(detectVacancyStatus(log)).toBe('info');
  });

  it('does not treat checkAuth cookies diagnostics as problems', () => {
    const log = makeLog({
      level: 'info',
      message: '[BackendHTTP] checkAuth cookies',
      context: { hasHhtoken: true, hasXsrf: true },
    });

    expect(detectReason(log)).toBe('other');
    expect(classifyLogProblem(log)).toBe('none');
    expect(isProblemLog(log)).toBe(false);
  });

  it('keeps an unsuccessful checkAuth result as an auth warning', () => {
    const log = makeLog({
      level: 'info',
      message: '[BackendHTTP] checkAuth result',
      context: { authorized: false },
    });

    expect(detectReason(log)).toBe('login');
    expect(classifyLogProblem(log)).toBe('warning');
    expect(isProblemLog(log)).toBe(true);
  });

  it('keeps explicit session authorization failures as auth warnings', () => {
    const log = makeLog({ level: 'warn', message: 'Session check failed: not authorized' });

    expect(detectReason(log)).toBe('login');
    expect(classifyLogProblem(log)).toBe('warning');
    expect(isProblemLog(log)).toBe(true);
  });

  it('keeps explicit login blockers as auth warnings', () => {
    const log = makeLog({
      level: 'info',
      message: '[BackendHTTP] checkAuth cookies',
      context: { blocker: 'login_required' },
    });

    expect(detectReason(log)).toBe('login');
    expect(classifyLogProblem(log)).toBe('warning');
    expect(isProblemLog(log)).toBe(true);
  });

  it('does not treat generic warn as execution error', () => {
    const log = makeLog({ level: 'warn', message: 'Login required, session expired' });

    expect(classifyLogProblem(log)).toBe('warning');
    expect(isProblemLog(log)).toBe(true);
  });

  it('treats questionnaire/test/manual-action as manual cases, not execution errors', () => {
    const questionnaireLog = makeLog({ level: 'warn', message: 'questionnaire_required' });
    const testLog = makeLog({ level: 'warn', message: 'test_required' });
    const manualLog = makeLog({ level: 'warn', message: 'manual action required' });

    expect(classifyLogProblem(questionnaireLog)).toBe('manual_case');
    expect(classifyLogProblem(testLog)).toBe('manual_case');
    expect(classifyLogProblem(manualLog)).toBe('manual_case');
    expect(detectReason(questionnaireLog)).toBe('questionnaire');
    expect(detectReason(testLog)).toBe('test');
    expect(detectReason(manualLog)).toBe('manual_action');
  });

  it('does not treat handled cover-letter blocker with success:false as execution error', () => {
    const log = makeLog({
      level: 'info',
      message: 'Apply result',
      context: {
        outcome: 'cover_letter_required',
        success: false,
      },
    });

    expect(detectReason(log)).toBe('cover_letter');
    expect(classifyLogProblem(log)).toBe('warning');
    expect(detectVacancyStatus(log)).toBe('warn');
    expect(getProblemBadgeLevel(log)).toBe('warn');
  });

  it('does not treat success apply result with diagnostics errorSignal:null as execution error', () => {
    const log = makeLog({
      level: 'info',
      message: 'Apply result',
      context: {
        outcome: 'success',
        success: true,
        diagnostics: {
          responseKind: 'json',
          errorSignal: null,
          keys: ['diagnostics', 'success'],
          preview: '{"success":"true"}',
        },
      },
    });

    expect(detectReason(log)).toBe('other');
    expect(classifyLogProblem(log)).toBe('none');
    expect(detectVacancyStatus(log)).toBe('success');
    expect(getProblemBadgeLevel(log)).toBe('info');
  });

  it('does not treat handled cycle-complete test blocker as execution error', () => {
    const log = makeLog({
      level: 'info',
      message: 'Cycle complete',
      context: {
        outcome: 'test_required',
        success: false,
      },
    });

    expect(detectReason(log)).toBe('test');
    expect(classifyLogProblem(log)).toBe('manual_case');
    expect(detectVacancyStatus(log)).toBe('warn');
  });

  it('keeps handled cover_letter_required with diagnostics as manual case', () => {
    const log = makeLog({
      level: 'info',
      message: 'Apply result',
      context: {
        outcome: 'cover_letter_required',
        success: false,
        diagnostics: {
          responseKind: 'json',
          errorSignal: null,
          keys: ['diagnostics', 'outcome'],
        },
      },
    });

    expect(classifyLogProblem(log)).toBe('warning');
    expect(detectVacancyStatus(log)).toBe('warn');
  });

  it('keeps real manual action as manual_case', () => {
    const log = makeLog({
      level: 'warn',
      message: 'Manual action created',
      context: {
        type: 'cover_letter_missing',
        reasonCode: 'cover_letter_required_after_http_apply',
      },
    });

    expect(detectReason(log)).toBe('manual_action');
    expect(classifyLogProblem(log)).toBe('manual_case');
    expect(getProblemBadgeLevel(log)).toBe('warn');
  });

  it('does not treat already_applied as execution error', () => {
    const log = makeLog({
      level: 'info',
      message: 'Apply result',
      context: {
        outcome: 'already_applied',
        success: false,
      },
    });

    expect(classifyLogProblem(log)).not.toBe('execution_error');
    expect(detectReason(log)).toBe('other');
    expect(detectVacancyStatus(log)).toBe('info');
  });

  it.each([
    'cover_letter_required', 'questionnaire_required', 'test_required', 'external_apply',
    'already_applied', 'auth_required', 'login_required', 'captcha_required', 'timeout', 'blocked',
  ])('never promotes handled outcome %s to execution_error', (outcome) => {
    const log = makeLog({ level: 'error', message: 'Handled apply result', context: { outcome, success: false } });
    expect(classifyLogProblem(log)).not.toBe('execution_error');
  });

  it('keeps real execution errors as execution errors', () => {
    const log = makeLog({ level: 'error', message: 'Apply failed with exception' });

    expect(classifyLogProblem(log)).toBe('execution_error');
    expect(detectVacancyStatus(log)).toBe('error');
  });

  it('treats neutral cycle-complete logs with outcome:error as execution errors', () => {
    const log = makeLog({
      level: 'info',
      message: 'Cycle complete',
      context: { outcome: 'error' },
    });

    expect(detectReason(log)).toBe('error');
    expect(classifyLogProblem(log)).toBe('execution_error');
    expect(detectVacancyStatus(log)).toBe('error');
    expect(getProblemBadgeLevel(log)).toBe('error');
  });

  it('keeps explicit unknown/unhandled runtime failures as execution errors', () => {
    const log = makeLog({
      level: 'info',
      message: 'Apply result',
      context: { outcome: 'unknown', success: false },
    });

    expect(detectReason(log)).toBe('error');
    expect(classifyLogProblem(log)).toBe('execution_error');
  });

  it('treats server_error as an execution error even when the log level is neutral', () => {
    const log = makeLog({
      level: 'info',
      message: 'Apply result',
      context: { outcome: 'server_error', success: false },
    });

    expect(detectReason(log)).toBe('error');
    expect(classifyLogProblem(log)).toBe('execution_error');
    expect(detectVacancyStatus(log)).toBe('error');
  });

  it('treats explicit outcome:error with diagnostics as execution error', () => {
    const log = makeLog({
      level: 'info',
      message: 'Apply result',
      context: {
        outcome: 'error',
        success: false,
        diagnostics: {
          responseKind: 'json',
          errorSignal: null,
        },
      },
    });

    expect(detectReason(log)).toBe('error');
    expect(classifyLogProblem(log)).toBe('execution_error');
    expect(detectVacancyStatus(log)).toBe('error');
  });

  it('shows successful cover-letter apply as success when coverLetterFlow hint is present', () => {
    const log = makeLog({
      level: 'info',
      message: 'Apply result',
      context: {
        outcome: 'success',
        success: true,
        coverLetterFlow: true,
        diagnostics: {
          responseKind: 'json',
          errorSignal: null,
        },
      },
    });

    expect(classifyLogProblem(log)).toBe('none');
    expect(detectVacancyStatus(log)).toBe('success');
  });

  it('maps manual cases to warn vacancy status instead of error', () => {
    const log = makeLog({ level: 'warn', message: 'test_required while processing vacancy' });

    expect(detectVacancyStatus(log)).toBe('warn');
    expect(getProblemBadgeLevel(log)).toBe('warn');
  });
});
