import { describe, it, expect, beforeEach } from 'vitest';
import { detectManualActionNeed } from '../src/live/manualActionDetector';

describe('manualActionDetector', () => {
  let doc: Document;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('Test');
  });

  describe('detectManualActionNeed', () => {
    it('detects questionnaire by data-qa', () => {
      doc.body.innerHTML = '<div data-qa="vacancy-response-questionnaire">Анкета работодателя</div>';

      const result = detectManualActionNeed(doc);

      expect(result.requiresManualAction).toBe(true);
      expect(result.type).toBe('questionnaire');
      expect(result.reasonCode).toBe('questionnaire_required');
    });

    it('detects test by data-qa', () => {
      doc.body.innerHTML = '<div data-qa="vacancy-test">Выполните тестовое задание</div>';

      const result = detectManualActionNeed(doc);

      expect(result.requiresManualAction).toBe(true);
      expect(result.type).toBe('test');
      expect(result.reasonCode).toBe('test_required');
    });

    it('detects test by text pattern', () => {
      doc.body.innerHTML = '<div>Пожалуйста, выполните тест для продолжения</div>';

      const result = detectManualActionNeed(doc);

      expect(result.requiresManualAction).toBe(true);
      expect(result.type).toBe('test');
      expect(result.reasonCode).toBe('test_required');
    });

    it('detects questionnaire by text pattern', () => {
      doc.body.innerHTML = '<div>Заполните анкету работодателя</div>';

      const result = detectManualActionNeed(doc);

      expect(result.requiresManualAction).toBe(true);
      expect(result.type).toBe('questionnaire');
      expect(result.reasonCode).toBe('questionnaire_required');
    });

    it('detects login required', () => {
      doc.body.innerHTML = '<div data-qa="login-form">Войдите в аккаунт</div>';

      const result = detectManualActionNeed(doc);

      expect(result.requiresManualAction).toBe(true);
      expect(result.type).toBe('login_required');
      expect(result.reasonCode).toBe('login_required');
    });

    it('detects captcha', () => {
      doc.body.innerHTML = '<div data-qa="captcha">Captcha</div>';

      const result = detectManualActionNeed(doc);

      expect(result.requiresManualAction).toBe(true);
      expect(result.type).toBe('captcha');
      expect(result.reasonCode).toBe('captcha_required');
    });

    it('detects cover letter missing when textarea empty and submit disabled', () => {
      doc.body.innerHTML = `
        <textarea data-qa="vacancy-response-letter-input"></textarea>
        <button data-qa="vacancy-response-submit-button" disabled>Отправить</button>
      `;

      const result = detectManualActionNeed(doc);

      expect(result.requiresManualAction).toBe(true);
      expect(result.type).toBe('cover_letter_missing');
      expect(result.reasonCode).toBe('cover_letter_required');
    });

    it('returns no manual action when nothing detected', () => {
      doc.body.innerHTML = '<div>Normal content</div>';

      const result = detectManualActionNeed(doc);

      expect(result.requiresManualAction).toBe(false);
      expect(result.type).toBeNull();
      expect(result.reasonCode).toBe('no_manual_action');
    });

    it('includes details in detection result', () => {
      doc.body.innerHTML = '<div data-qa="vacancy-response-questionnaire">Анкета с вопросами</div>';

      const result = detectManualActionNeed(doc);

      expect(result.details).toBeDefined();
      expect(result.details?.detectedSelector).toBe('[data-qa="vacancy-response-questionnaire"]');
      expect(result.details?.textPreview).toContain('Анкета');
    });
  });
});
