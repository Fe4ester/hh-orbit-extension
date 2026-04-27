import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseSearchResults,
  extractVacancyIdFromLink,
  isSearchResultsPage,
} from '../src/live/searchResultsParser';

describe('searchResultsParser', () => {
  const basicHtml = readFileSync(
    join(__dirname, 'fixtures/hh-search-results-basic.html'),
    'utf-8'
  );
  const mixedHtml = readFileSync(
    join(__dirname, 'fixtures/hh-search-results-mixed.html'),
    'utf-8'
  );

  describe('extractVacancyIdFromLink', () => {
    it('extracts vacancyId from vacancy URL', () => {
      expect(extractVacancyIdFromLink('https://hh.ru/vacancy/123456')).toBe('123456');
      expect(extractVacancyIdFromLink('https://hh.ru/vacancy/789012?from=search')).toBe('789012');
    });

    it('returns null for non-vacancy URL', () => {
      expect(extractVacancyIdFromLink('https://hh.ru/search/vacancy')).toBeNull();
      expect(extractVacancyIdFromLink('https://hh.ru/')).toBeNull();
    });
  });

  describe('isSearchResultsPage', () => {
    it('detects search results page', () => {
      expect(isSearchResultsPage(basicHtml)).toBe(true);
      expect(isSearchResultsPage(mixedHtml)).toBe(true);
    });

    it('returns false for non-search page', () => {
      expect(isSearchResultsPage('<html><body>Not a search page</body></html>')).toBe(false);
    });
  });

  describe('parseSearchResults', () => {
    it('extracts basic vacancy cards from fixture', () => {
      const cards = parseSearchResults(basicHtml);

      expect(cards).toHaveLength(3);

      expect(cards[0]).toMatchObject({
        vacancyId: '100001',
        title: 'Frontend разработчик (React, TypeScript)',
        company: 'ООО "Технологии"',
        salary: 'от 150 000 до 200 000 ₽',
        url: 'https://hh.ru/vacancy/100001',
        location: 'Москва',
        isViewed: false,
      });

      expect(cards[1]).toMatchObject({
        vacancyId: '100002',
        title: 'Senior Backend Developer (Go)',
        company: 'ИП Иванов',
        salary: 'до 250 000 ₽',
        url: 'https://hh.ru/vacancy/100002',
        location: 'Санкт-Петербург',
        isViewed: false,
      });

      expect(cards[2]).toMatchObject({
        vacancyId: '100003',
        title: 'Fullstack разработчик (Node.js + React)',
        isViewed: true,
      });
    });

    it('tolerates missing company and salary', () => {
      const cards = parseSearchResults(mixedHtml);

      expect(cards).toHaveLength(2);

      expect(cards[0]).toMatchObject({
        vacancyId: '200001',
        title: 'Python разработчик',
        company: 'Компания ABC',
        salary: 'от 120 000 ₽',
      });

      expect(cards[1]).toMatchObject({
        vacancyId: '200002',
        title: 'Junior Java Developer',
        company: undefined,
        salary: undefined,
        location: 'Новосибирск',
      });
    });

    it('returns empty array for non-search page', () => {
      const cards = parseSearchResults('<html><body>Not a search page</body></html>');
      expect(cards).toEqual([]);
    });

    it('handles malformed HTML gracefully', () => {
      const cards = parseSearchResults('<div class="serp-item"></div>');
      expect(cards).toEqual([]);
    });
  });
});
