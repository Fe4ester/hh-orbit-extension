import { describe, it, expect } from 'vitest';
import { classifyPostSubmitResult } from '../src/live/applyExecutor';
import {
  ClickExecutionObservation,
  PostClickObservation,
} from '../src/live/respondButtonExecutor';
import {
  FinalSubmitClickObservation,
  PostSubmitObservation,
} from '../src/live/finalSubmitExecutor';

describe('applyExecutor - post-submit classification', () => {
  const createClickObservation = (
    overrides: Partial<ClickExecutionObservation> = {}
  ): ClickExecutionObservation => ({
    found: true,
    clicked: true,
    buttonText: 'Откликнуться',
    ...overrides,
  });

  const createPostClickObservation = (
    overrides: Partial<PostClickObservation> = {}
  ): PostClickObservation => ({
    modalOpened: true,
    loginRedirectVisible: false,
    alreadyAppliedVisible: false,
    externalApplyVisible: false,
    coverLetterUIVisible: false,
    questionnaireUIVisible: false,
    unknownState: false,
    ...overrides,
  });

  const createFinalSubmitObservation = (
    overrides: Partial<FinalSubmitClickObservation> = {}
  ): FinalSubmitClickObservation => ({
    found: true,
    clicked: true,
    buttonText: 'Отправить',
    ...overrides,
  });

  const createPostSubmitObservation = (
    overrides: Partial<PostSubmitObservation> = {}
  ): PostSubmitObservation => ({
    successVisible: false,
    alreadyAppliedVisible: false,
    loginRequiredVisible: false,
    questionnaireVisible: false,
    coverLetterStillVisible: false,
    errorVisible: false,
    unknownState: true,
    ...overrides,
  });

  describe('classifyPostSubmitResult', () => {
    it('returns success when success signal visible', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation();
      const submitObs = createFinalSubmitObservation();
      const postSubmitObs = createPostSubmitObservation({ successVisible: true, unknownState: false });

      const result = classifyPostSubmitResult(clickObs, postClickObs, submitObs, postSubmitObs);

      expect(result.outcome).toBe('success');
      expect(result.message).toContain('успешно');
    });

    it('returns already_applied when already applied visible', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation();
      const submitObs = createFinalSubmitObservation();
      const postSubmitObs = createPostSubmitObservation({ alreadyAppliedVisible: true, unknownState: false });

      const result = classifyPostSubmitResult(clickObs, postClickObs, submitObs, postSubmitObs);

      expect(result.outcome).toBe('already_applied');
      expect(result.message).toContain('уже откликались');
    });

    it('returns login_required when login required visible', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation();
      const submitObs = createFinalSubmitObservation();
      const postSubmitObs = createPostSubmitObservation({ loginRequiredVisible: true, unknownState: false });

      const result = classifyPostSubmitResult(clickObs, postClickObs, submitObs, postSubmitObs);

      expect(result.outcome).toBe('login_required');
      expect(result.message).toContain('авторизация');
    });

    it('returns questionnaire_required when questionnaire visible', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation();
      const submitObs = createFinalSubmitObservation();
      const postSubmitObs = createPostSubmitObservation({ questionnaireVisible: true, unknownState: false });

      const result = classifyPostSubmitResult(clickObs, postClickObs, submitObs, postSubmitObs);

      expect(result.outcome).toBe('questionnaire_required');
      expect(result.message).toContain('анкет');
    });

    it('returns cover_letter_required when cover letter still visible', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation();
      const submitObs = createFinalSubmitObservation();
      const postSubmitObs = createPostSubmitObservation({ coverLetterStillVisible: true, unknownState: false });

      const result = classifyPostSubmitResult(clickObs, postClickObs, submitObs, postSubmitObs);

      expect(result.outcome).toBe('cover_letter_required');
      expect(result.message).toContain('still visible');
    });

    it('returns apply_unavailable when error visible', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation();
      const submitObs = createFinalSubmitObservation();
      const postSubmitObs = createPostSubmitObservation({
        errorVisible: true,
        errorText: 'Ошибка отправки',
        unknownState: false,
      });

      const result = classifyPostSubmitResult(clickObs, postClickObs, submitObs, postSubmitObs);

      expect(result.outcome).toBe('apply_unavailable');
      expect(result.message).toContain('Ошибка отправки');
    });

    it('returns apply_unavailable when submit click failed', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation();
      const submitObs = createFinalSubmitObservation({ clicked: false, error: 'Button disabled' });
      const postSubmitObs = createPostSubmitObservation();

      const result = classifyPostSubmitResult(clickObs, postClickObs, submitObs, postSubmitObs);

      expect(result.outcome).toBe('apply_unavailable');
      expect(result.message).toContain('Button disabled');
    });

    it('returns unknown when no clear signal', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation();
      const submitObs = createFinalSubmitObservation();
      const postSubmitObs = createPostSubmitObservation({ unknownState: true });

      const result = classifyPostSubmitResult(clickObs, postClickObs, submitObs, postSubmitObs);

      expect(result.outcome).toBe('unknown');
      expect(result.message).toContain('unclear');
    });
  });
});
