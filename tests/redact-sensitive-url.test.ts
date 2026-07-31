import { describe, expect, it } from 'vitest';
import { redactSensitiveUrl } from '../src/utils/redactSensitiveUrl';

describe('redactSensitiveUrl', () => {
  it('redacts both resume query parameter spellings without changing navigation data', () => {
    expect(redactSensitiveUrl('https://hh.ru/search/vacancy?resume=private-hash&page=2')).toContain(
      'resume=%5Bredacted%5D'
    );
    expect(redactSensitiveUrl('https://hh.ru/popup?resumeHash=private-hash')).toContain(
      'resumeHash=%5Bredacted%5D'
    );
  });
});
