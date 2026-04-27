import { describe, it, expect } from 'vitest';
import { parseSearchResults } from '../src/live/searchResultsParser';

describe('parseSearchResults without DOMParser', () => {
  it('should parse vacancy cards using regex without DOMParser', () => {
    const html = `
      <html>
        <div class="serp-item">
          <a href="https://hh.ru/vacancy/12345" data-qa="serp-item__title">Senior Developer</a>
          <a class="bloko-link_kind-tertiary">Tech Corp</a>
          <span class="bloko-header-section-2">100000 - 150000 руб.</span>
        </div>
        <div class="serp-item">
          <a href="/vacancy/67890" data-qa="serp-item__title">Junior Developer</a>
        </div>
      </html>
    `;

    const cards = parseSearchResults(html);

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      vacancyId: '12345',
      title: 'Senior Developer',
      company: 'Tech Corp',
      url: expect.stringContaining('12345'),
    });
    expect(cards[1]).toMatchObject({
      vacancyId: '67890',
      title: 'Junior Developer',
    });
  });

  it('should work in environment where DOMParser is undefined', () => {
    // Simulate background context
    const originalDOMParser = global.DOMParser;
    (global as any).DOMParser = undefined;

    const html = `
      <html>
        <div class="vacancy-serp-item">
          <a href="https://hh.ru/vacancy/99999" data-qa="vacancy-serp__vacancy-title">Test Job</a>
        </div>
      </html>
    `;

    // Should not throw
    expect(() => parseSearchResults(html)).not.toThrow();

    const cards = parseSearchResults(html);
    expect(cards).toHaveLength(1);
    expect(cards[0].vacancyId).toBe('99999');

    // Restore
    global.DOMParser = originalDOMParser;
  });

  it('should handle HTML entities in URLs', () => {
    const html = `
      <html>
        <div class="serp-item">
          <a href="https://hh.ru/vacancy/11111?from=search&amp;query=test" data-qa="serp-item__title">Job Title</a>
        </div>
      </html>
    `;

    const cards = parseSearchResults(html);

    expect(cards).toHaveLength(1);
    expect(cards[0].url).toContain('from=search&query=test');
    expect(cards[0].url).not.toContain('&amp;');
  });

  it('should handle relative URLs', () => {
    const html = `
      <html>
        <div class="serp-item">
          <a href="/vacancy/22222" data-qa="serp-item__title">Relative URL Job</a>
        </div>
      </html>
    `;

    const cards = parseSearchResults(html);

    expect(cards).toHaveLength(1);
    expect(cards[0].url).toBe('https://hh.ru/vacancy/22222');
  });

  it('should return empty array for non-search page', () => {
    const html = '<html><body>Not a search page</body></html>';

    const cards = parseSearchResults(html);

    expect(cards).toHaveLength(0);
  });

  it('should skip cards without valid vacancy ID', () => {
    const html = `
      <html>
        <div class="serp-item">
          <a href="https://hh.ru/employer/123" data-qa="serp-item__title">Not a vacancy</a>
        </div>
        <div class="serp-item">
          <a href="https://hh.ru/vacancy/33333" data-qa="serp-item__title">Valid vacancy</a>
        </div>
      </html>
    `;

    const cards = parseSearchResults(html);

    expect(cards).toHaveLength(1);
    expect(cards[0].vacancyId).toBe('33333');
  });
});
