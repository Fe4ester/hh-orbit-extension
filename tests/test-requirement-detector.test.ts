import { describe, expect, it } from 'vitest';
import { detectTestRequirement } from '../src/live/testRequirementDetector';

describe('detectTestRequirement', () => {
  it('does not treat cover letter toggle as test required', () => {
    const doc = document.implementation.createHTMLDocument('Test');
    doc.body.innerHTML = '<div data-qa="vacancy-response-letter-toggle">Сопроводительное письмо</div>';

    expect(detectTestRequirement(doc, 'https://hh.ru/vacancy/123')).toBe(false);
  });

  it('detects questionnaire UI as test required', () => {
    const doc = document.implementation.createHTMLDocument('Test');
    doc.body.innerHTML = '<div data-qa="vacancy-response-questionnaire">Ответьте на вопросы</div>';

    expect(detectTestRequirement(doc, 'https://hh.ru/vacancy/123')).toBe(true);
  });
});
