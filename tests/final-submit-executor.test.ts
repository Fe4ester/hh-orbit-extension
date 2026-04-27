import { describe, it, expect, beforeEach } from 'vitest';
import {
  findFinalSubmitButton,
  clickFinalSubmitButton,
  observePostSubmitState,
} from '../src/live/finalSubmitExecutor';

describe('finalSubmitExecutor', () => {
  let doc: Document;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('Test');
  });

  describe('findFinalSubmitButton', () => {
    it('finds submit button by data-qa', () => {
      doc.body.innerHTML = '<button data-qa="vacancy-response-submit-button">Отправить</button>';

      const button = findFinalSubmitButton(doc);

      expect(button).not.toBeNull();
      expect(button?.textContent).toBe('Отправить');
    });

    it('finds submit button in modal', () => {
      doc.body.innerHTML = `
        <div data-qa="vacancy-response-popup">
          <button type="submit">Отправить отклик</button>
        </div>
      `;

      const button = findFinalSubmitButton(doc);

      expect(button).not.toBeNull();
      expect(button?.textContent).toBe('Отправить отклик');
    });

    it('returns null when no button found', () => {
      doc.body.innerHTML = '<div>No button</div>';

      const button = findFinalSubmitButton(doc);

      expect(button).toBeNull();
    });
  });

  describe('clickFinalSubmitButton', () => {
    it('clicks submit button successfully', () => {
      doc.body.innerHTML = '<button data-qa="vacancy-response-submit-button">Отправить</button>';

      const result = clickFinalSubmitButton(doc);

      expect(result.found).toBe(true);
      expect(result.clicked).toBe(true);
      expect(result.buttonText).toBe('Отправить');
    });

    it('returns error when button not found', () => {
      doc.body.innerHTML = '<div>No button</div>';

      const result = clickFinalSubmitButton(doc);

      expect(result.found).toBe(false);
      expect(result.clicked).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when button is disabled', () => {
      doc.body.innerHTML = '<button data-qa="vacancy-response-submit-button" disabled>Отправить</button>';

      const result = clickFinalSubmitButton(doc);

      expect(result.found).toBe(true);
      expect(result.clicked).toBe(false);
      expect(result.error).toContain('disabled');
    });
  });

  describe('observePostSubmitState', () => {
    it('detects success state', () => {
      doc.body.innerHTML = '<div data-qa="vacancy-response-submit-popup">Отклик отправлен</div>';

      const observation = observePostSubmitState(doc);

      expect(observation.successVisible).toBe(true);
      expect(observation.unknownState).toBe(false);
    });

    it('detects already applied state', () => {
      doc.body.innerHTML = '<div>Вы уже откликались на эту вакансию</div>';

      const observation = observePostSubmitState(doc);

      expect(observation.alreadyAppliedVisible).toBe(true);
      expect(observation.unknownState).toBe(false);
    });

    it('detects login required state', () => {
      doc.body.innerHTML = '<div data-qa="login-form">Войдите для отклика</div>';

      const observation = observePostSubmitState(doc);

      expect(observation.loginRequiredVisible).toBe(true);
      expect(observation.unknownState).toBe(false);
    });

    it('detects questionnaire still visible', () => {
      doc.body.innerHTML = '<div data-qa="vacancy-response-questionnaire">Анкета</div>';

      const observation = observePostSubmitState(doc);

      expect(observation.questionnaireVisible).toBe(true);
      expect(observation.unknownState).toBe(false);
    });

    it('detects cover letter still visible', () => {
      doc.body.innerHTML = '<textarea data-qa="vacancy-response-letter-input"></textarea>';

      const observation = observePostSubmitState(doc);

      expect(observation.coverLetterStillVisible).toBe(true);
    });

    it('detects error state', () => {
      doc.body.innerHTML = '<div data-qa="vacancy-response-error">Ошибка отправки</div>';

      const observation = observePostSubmitState(doc);

      expect(observation.errorVisible).toBe(true);
      expect(observation.errorText).toBe('Ошибка отправки');
      expect(observation.unknownState).toBe(false);
    });

    it('returns unknown state when no clear signal', () => {
      doc.body.innerHTML = '<div>Some content</div>';

      const observation = observePostSubmitState(doc);

      expect(observation.unknownState).toBe(true);
      expect(observation.successVisible).toBe(false);
    });
  });
});
