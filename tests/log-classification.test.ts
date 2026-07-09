import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../src/utils/fileLogger';
import {
  classifyLogProblem,
  detectReason,
  detectVacancyStatus,
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

  it('keeps real execution errors as execution errors', () => {
    const log = makeLog({ level: 'error', message: 'Apply failed with exception' });

    expect(classifyLogProblem(log)).toBe('execution_error');
    expect(detectVacancyStatus(log)).toBe('error');
  });

  it('maps manual cases to warn vacancy status instead of error', () => {
    const log = makeLog({ level: 'warn', message: 'test_required while processing vacancy' });

    expect(detectVacancyStatus(log)).toBe('warn');
  });
});
