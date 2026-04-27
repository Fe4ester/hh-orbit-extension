import { describe, it, expect } from 'vitest';
import {
  executeApplyPrechecked,
  classifyApplyResult,
  ApplyExecutionOptions,
} from '../src/live/applyExecutor';
import {
  VacancyDetailObservation,
  PreflightClassification,
} from '../src/live/vacancyDetailParser';

describe('applyExecutor', () => {
  const createObservation = (
    overrides: Partial<VacancyDetailObservation> = {}
  ): VacancyDetailObservation => ({
    vacancyId: '100001',
    title: 'Test Vacancy',
    company: 'Test Company',
    hasRespondButton: true,
    respondButtonText: 'Откликнуться',
    requiresLogin: false,
    alreadyApplied: false,
    externalApply: false,
    archivedOrUnavailable: false,
    coverLetterHint: false,
    resumeSelectorVisible: true,
    questionnaireHint: false,
    ...overrides,
  });

  const createPreflight = (
    code: string = 'can_apply'
  ): PreflightClassification => ({
    code: code as any,
    message: 'Test preflight',
    severity: 'success',
  });

  const createOptions = (
    overrides: Partial<ApplyExecutionOptions> = {}
  ): ApplyExecutionOptions => ({
    selectedResumeHash: 'resume_123',
    coverLetterText: null,
    ...overrides,
  });

  describe('executeApplyPrechecked', () => {
    it('returns already_applied when already applied', () => {
      const observation = createObservation({ alreadyApplied: true });
      const preflight = createPreflight('already_applied');
      const options = createOptions();

      const result = executeApplyPrechecked(observation, preflight, options);

      expect(result.outcome).toBe('already_applied');
      expect(result.message).toContain('уже откликались');
    });

    it('returns login_required when login required', () => {
      const observation = createObservation({ requiresLogin: true });
      const preflight = createPreflight('login_required');
      const options = createOptions();

      const result = executeApplyPrechecked(observation, preflight, options);

      expect(result.outcome).toBe('login_required');
      expect(result.message).toContain('авторизация');
    });

    it('returns external_apply when external apply', () => {
      const observation = createObservation({ externalApply: true });
      const preflight = createPreflight('external_apply');
      const options = createOptions();

      const result = executeApplyPrechecked(observation, preflight, options);

      expect(result.outcome).toBe('external_apply');
      expect(result.message).toContain('внешний сайт');
    });

    it('returns apply_unavailable when archived', () => {
      const observation = createObservation({ archivedOrUnavailable: true });
      const preflight = createPreflight('archived_or_unavailable');
      const options = createOptions();

      const result = executeApplyPrechecked(observation, preflight, options);

      expect(result.outcome).toBe('apply_unavailable');
      expect(result.message).toContain('архивирована');
    });

    it('returns apply_unavailable when no respond button', () => {
      const observation = createObservation({ hasRespondButton: false });
      const preflight = createPreflight('unknown');
      const options = createOptions();

      const result = executeApplyPrechecked(observation, preflight, options);

      expect(result.outcome).toBe('apply_unavailable');
      expect(result.message).toContain('Кнопка отклика не найдена');
    });

    it('returns resume_required when no resume selector and no resume hash', () => {
      const observation = createObservation({ resumeSelectorVisible: false });
      const preflight = createPreflight('resume_required');
      const options = createOptions({ selectedResumeHash: null });

      const result = executeApplyPrechecked(observation, preflight, options);

      expect(result.outcome).toBe('resume_required');
      expect(result.message).toContain('резюме');
    });

    it('returns cover_letter_required when hint present and no letter', () => {
      const observation = createObservation({ coverLetterHint: true });
      const preflight = createPreflight('cover_letter_required');
      const options = createOptions({ coverLetterText: null });

      const result = executeApplyPrechecked(observation, preflight, options);

      expect(result.outcome).toBe('cover_letter_required');
      expect(result.message).toContain('сопроводительное письмо');
    });

    it('returns questionnaire_required when questionnaire hint present', () => {
      const observation = createObservation({ questionnaireHint: true });
      const preflight = createPreflight('questionnaire_possible');
      const options = createOptions();

      const result = executeApplyPrechecked(observation, preflight, options);

      expect(result.outcome).toBe('questionnaire_required');
      expect(result.message).toContain('анкет');
    });

    it('returns success dry-run when all checks pass', () => {
      const observation = createObservation();
      const preflight = createPreflight('can_apply');
      const options = createOptions();

      const result = executeApplyPrechecked(observation, preflight, options);

      expect(result.outcome).toBe('success');
      expect(result.message).toContain('skeleton passed preflight');
      expect(result.metadata?.dryRun).toBe(true);
    });

    it('includes resume hash in success metadata', () => {
      const observation = createObservation();
      const preflight = createPreflight('can_apply');
      const options = createOptions({ selectedResumeHash: 'resume_456' });

      const result = executeApplyPrechecked(observation, preflight, options);

      expect(result.outcome).toBe('success');
      expect(result.metadata?.resumeHash).toBe('resume_456');
    });

    it('includes cover letter flag in success metadata', () => {
      const observation = createObservation();
      const preflight = createPreflight('can_apply');
      const options = createOptions({ coverLetterText: 'Hello!' });

      const result = executeApplyPrechecked(observation, preflight, options);

      expect(result.outcome).toBe('success');
      expect(result.metadata?.hasCoverLetter).toBe(true);
    });
  });

  describe('classifyApplyResult', () => {
    it('passes through result', () => {
      const raw = {
        outcome: 'success' as const,
        message: 'Test',
        metadata: { test: true },
      };

      const result = classifyApplyResult(raw);

      expect(result).toEqual(raw);
    });
  });
});
