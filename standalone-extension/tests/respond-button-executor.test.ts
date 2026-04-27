import { describe, it, expect, beforeEach } from 'vitest';
import {
  findRespondButton,
  clickRespondButton,
  observePostClickState,
} from '../src/live/respondButtonExecutor';

describe('respondButtonExecutor', () => {
  let doc: Document;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('Test');
  });

  describe('findRespondButton', () => {
    it('finds button by data-qa attribute', () => {
      doc.body.innerHTML = '<button data-qa="vacancy-response-button">Откликнуться</button>';

      const button = findRespondButton(doc);

      expect(button).not.toBeNull();
      expect(button?.textContent).toBe('Откликнуться');
    });

    it('finds button by text content fallback', () => {
      doc.body.innerHTML = '<button class="bloko-button">Откликнуться на вакансию</button>';

      const button = findRespondButton(doc);

      expect(button).not.toBeNull();
      expect(button?.textContent).toContain('Откликнуться');
    });

    it('returns null when button not found', () => {
      doc.body.innerHTML = '<button>Other button</button>';

      const button = findRespondButton(doc);

      expect(button).toBeNull();
    });
  });

  describe('clickRespondButton', () => {
    it('returns found=true and clicked=true when button exists', () => {
      doc.body.innerHTML = '<button data-qa="vacancy-response-button">Откликнуться</button>';

      const result = clickRespondButton(doc);

      expect(result.found).toBe(true);
      expect(result.clicked).toBe(true);
      expect(result.buttonText).toBe('Откликнуться');
    });

    it('returns found=false when button not found', () => {
      doc.body.innerHTML = '<div>No button</div>';

      const result = clickRespondButton(doc);

      expect(result.found).toBe(false);
      expect(result.clicked).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns clicked=false when button is disabled', () => {
      doc.body.innerHTML = '<button data-qa="vacancy-response-button" disabled>Откликнуться</button>';

      const result = clickRespondButton(doc);

      expect(result.found).toBe(true);
      expect(result.clicked).toBe(false);
      expect(result.error).toContain('disabled');
    });
  });

  describe('observePostClickState', () => {
    it('detects modal opened', () => {
      doc.body.innerHTML = '<div data-qa="vacancy-response-modal">Modal content</div>';

      const observation = observePostClickState(doc);

      expect(observation.modalOpened).toBe(true);
      expect(observation.unknownState).toBe(false);
    });

    it('detects login redirect', () => {
      doc.body.innerHTML = '<div data-qa="vacancy-response-login-required">Войдите</div>';

      const observation = observePostClickState(doc);

      expect(observation.loginRedirectVisible).toBe(true);
      expect(observation.unknownState).toBe(false);
    });

    it('detects already applied', () => {
      doc.body.innerHTML = '<div>Вы уже откликались на эту вакансию</div>';

      const observation = observePostClickState(doc);

      expect(observation.alreadyAppliedVisible).toBe(true);
      expect(observation.unknownState).toBe(false);
    });

    it('detects external apply', () => {
      doc.body.innerHTML = '<div>Откликнуться на сайте работодателя</div>';

      const observation = observePostClickState(doc);

      expect(observation.externalApplyVisible).toBe(true);
      expect(observation.unknownState).toBe(false);
    });

    it('detects cover letter UI', () => {
      doc.body.innerHTML = '<div data-qa="vacancy-response-letter-toggle">Сопроводительное письмо</div>';

      const observation = observePostClickState(doc);

      expect(observation.coverLetterUIVisible).toBe(true);
      expect(observation.unknownState).toBe(false);
    });

    it('detects questionnaire UI', () => {
      doc.body.innerHTML = '<div>Работодатель просит ответить на вопросы</div>';

      const observation = observePostClickState(doc);

      expect(observation.questionnaireUIVisible).toBe(true);
      expect(observation.unknownState).toBe(false);
    });

    it('detects unknown state when no signals', () => {
      doc.body.innerHTML = '<div>Some other content</div>';

      const observation = observePostClickState(doc);

      expect(observation.unknownState).toBe(true);
      expect(observation.modalOpened).toBe(false);
    });

    it('detects modal with cover letter UI', () => {
      doc.body.innerHTML = `
        <div data-qa="vacancy-response-modal">
          <div data-qa="vacancy-response-letter-input"></div>
        </div>
      `;

      const observation = observePostClickState(doc);

      expect(observation.modalOpened).toBe(true);
      expect(observation.coverLetterUIVisible).toBe(true);
      expect(observation.unknownState).toBe(false);
    });
  });
});
