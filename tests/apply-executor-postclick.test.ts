import { describe, it, expect } from 'vitest';
import {
  classifyPostClickResult,
  classifyAfterCoverLetterFill,
} from '../src/live/applyExecutor';
import {
  ClickExecutionObservation,
  PostClickObservation,
} from '../src/live/respondButtonExecutor';
import {
  CoverLetterUIObservation,
  FillCoverLetterResult,
} from '../src/live/coverLetterExecutor';

describe('applyExecutor - post-click classification', () => {
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
    modalOpened: false,
    loginRedirectVisible: false,
    alreadyAppliedVisible: false,
    externalApplyVisible: false,
    coverLetterUIVisible: false,
    questionnaireUIVisible: false,
    unknownState: true,
    ...overrides,
  });

  describe('classifyPostClickResult', () => {
    it('returns apply_unavailable when click failed', () => {
      const clickObs = createClickObservation({ clicked: false, error: 'Button disabled' });
      const postClickObs = createPostClickObservation();

      const result = classifyPostClickResult(clickObs, postClickObs);

      expect(result.outcome).toBe('apply_unavailable');
      expect(result.message).toContain('Button disabled');
    });

    it('returns login_required when login redirect visible', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation({ loginRedirectVisible: true, unknownState: false });

      const result = classifyPostClickResult(clickObs, postClickObs);

      expect(result.outcome).toBe('login_required');
      expect(result.message).toContain('авторизация');
    });

    it('returns already_applied when already applied visible', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation({ alreadyAppliedVisible: true, unknownState: false });

      const result = classifyPostClickResult(clickObs, postClickObs);

      expect(result.outcome).toBe('already_applied');
      expect(result.message).toContain('уже откликались');
    });

    it('returns external_apply when external apply visible', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation({ externalApplyVisible: true, unknownState: false });

      const result = classifyPostClickResult(clickObs, postClickObs);

      expect(result.outcome).toBe('external_apply');
      expect(result.message).toContain('внешний сайт');
    });

    it('returns questionnaire_required when modal opened with questionnaire UI', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation({
        modalOpened: true,
        questionnaireUIVisible: true,
        unknownState: false,
      });

      const result = classifyPostClickResult(clickObs, postClickObs);

      expect(result.outcome).toBe('questionnaire_required');
      expect(result.message).toContain('анкет');
    });

    it('returns cover_letter_required when modal opened with cover letter UI but no text', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation({
        modalOpened: true,
        coverLetterUIVisible: true,
        unknownState: false,
      });

      const result = classifyPostClickResult(clickObs, postClickObs, null);

      expect(result.outcome).toBe('cover_letter_required');
      expect(result.message).toContain('no text provided');
    });

    it('returns cover_letter_required with hasCoverLetterText when text provided', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation({
        modalOpened: true,
        coverLetterUIVisible: true,
        unknownState: false,
      });

      const result = classifyPostClickResult(clickObs, postClickObs, 'Test cover letter');

      expect(result.outcome).toBe('cover_letter_required');
      expect(result.message).toContain('ready to fill');
      expect(result.metadata?.hasCoverLetterText).toBe(true);
    });

    it('returns success when modal opened without blockers', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation({
        modalOpened: true,
        unknownState: false,
      });

      const result = classifyPostClickResult(clickObs, postClickObs);

      expect(result.outcome).toBe('success');
      expect(result.message).toContain('modal opened');
      expect(result.metadata?.realClick).toBe(true);
    });

    it('returns unknown when click executed but no clear signal', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation({ unknownState: true });

      const result = classifyPostClickResult(clickObs, postClickObs);

      expect(result.outcome).toBe('unknown');
      expect(result.message).toContain('unclear');
    });
  });

  describe('classifyAfterCoverLetterFill', () => {
    const createCoverLetterObservation = (
      overrides: Partial<CoverLetterUIObservation> = {}
    ): CoverLetterUIObservation => ({
      visible: true,
      textareaFound: true,
      submitButtonFound: true,
      textLength: 0,
      ...overrides,
    });

    const createFillResult = (
      overrides: Partial<FillCoverLetterResult> = {}
    ): FillCoverLetterResult => ({
      filled: true,
      textLength: 100,
      ...overrides,
    });

    it('returns cover_letter_required when fill failed', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation({ modalOpened: true, coverLetterUIVisible: true });
      const coverLetterObs = createCoverLetterObservation();
      const fillResult = createFillResult({ filled: false, textLength: 0, error: 'Textarea not found' });

      const result = classifyAfterCoverLetterFill(clickObs, postClickObs, coverLetterObs, fillResult);

      expect(result.outcome).toBe('cover_letter_required');
      expect(result.message).toContain('Textarea not found');
    });

    it('returns cover_letter_ready when fill succeeded', () => {
      const clickObs = createClickObservation();
      const postClickObs = createPostClickObservation({ modalOpened: true, coverLetterUIVisible: true });
      const coverLetterObs = createCoverLetterObservation();
      const fillResult = createFillResult({ filled: true, textLength: 150 });

      const result = classifyAfterCoverLetterFill(clickObs, postClickObs, coverLetterObs, fillResult);

      expect(result.outcome).toBe('cover_letter_ready');
      expect(result.message).toContain('150 chars');
      expect(result.message).toContain('ready for submit');
      expect(result.metadata?.realClick).toBe(true);
    });
  });
});
