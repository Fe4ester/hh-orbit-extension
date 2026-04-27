import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectCoverLetterUI,
  fillCoverLetter,
} from '../src/live/coverLetterExecutor';

describe('coverLetterExecutor', () => {
  let doc: Document;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('Test');
  });

  describe('detectCoverLetterUI', () => {
    it('detects cover letter textarea by data-qa', () => {
      doc.body.innerHTML = '<textarea data-qa="vacancy-response-letter-input"></textarea>';

      const observation = detectCoverLetterUI(doc);

      expect(observation.visible).toBe(true);
      expect(observation.textareaFound).toBe(true);
    });

    it('detects cover letter textarea by name', () => {
      doc.body.innerHTML = '<textarea name="letter"></textarea>';

      const observation = detectCoverLetterUI(doc);

      expect(observation.visible).toBe(true);
      expect(observation.textareaFound).toBe(true);
    });

    it('detects cover letter textarea by placeholder', () => {
      doc.body.innerHTML = '<textarea placeholder="Сопроводительное письмо"></textarea>';

      const observation = detectCoverLetterUI(doc);

      expect(observation.visible).toBe(true);
      expect(observation.textareaFound).toBe(true);
    });

    it('detects submit button', () => {
      doc.body.innerHTML = `
        <textarea data-qa="vacancy-response-letter-input"></textarea>
        <button data-qa="vacancy-response-submit-button">Отправить</button>
      `;

      const observation = detectCoverLetterUI(doc);

      expect(observation.submitButtonFound).toBe(true);
    });

    it('returns visible=false when no textarea', () => {
      doc.body.innerHTML = '<div>No textarea</div>';

      const observation = detectCoverLetterUI(doc);

      expect(observation.visible).toBe(false);
      expect(observation.textareaFound).toBe(false);
    });

    it('returns text length when textarea has content', () => {
      doc.body.innerHTML = '<textarea data-qa="vacancy-response-letter-input">Hello</textarea>';

      const observation = detectCoverLetterUI(doc);

      expect(observation.textLength).toBe(5);
    });
  });

  describe('fillCoverLetter', () => {
    it('fills textarea with text', () => {
      doc.body.innerHTML = '<textarea data-qa="vacancy-response-letter-input"></textarea>';
      const textarea = doc.querySelector('textarea') as HTMLTextAreaElement;

      const result = fillCoverLetter(doc, 'Test cover letter');

      expect(result.filled).toBe(true);
      expect(result.textLength).toBe(17);
      expect(textarea.value).toBe('Test cover letter');
    });

    it('returns error when text is empty', () => {
      doc.body.innerHTML = '<textarea data-qa="vacancy-response-letter-input"></textarea>';

      const result = fillCoverLetter(doc, '');

      expect(result.filled).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('returns error when textarea not found', () => {
      doc.body.innerHTML = '<div>No textarea</div>';

      const result = fillCoverLetter(doc, 'Test');

      expect(result.filled).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('triggers input and change events', () => {
      doc.body.innerHTML = '<textarea data-qa="vacancy-response-letter-input"></textarea>';
      const textarea = doc.querySelector('textarea') as HTMLTextAreaElement;

      let inputFired = false;
      let changeFired = false;

      textarea.addEventListener('input', () => {
        inputFired = true;
      });
      textarea.addEventListener('change', () => {
        changeFired = true;
      });

      fillCoverLetter(doc, 'Test');

      expect(inputFired).toBe(true);
      expect(changeFired).toBe(true);
    });
  });
});
