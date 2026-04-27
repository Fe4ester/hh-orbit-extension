import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  detectCurrentSearchPage,
  detectTotalPages,
  findNextPageUrl,
  hasNextPage,
} from '../src/live/searchPagination';

const fixturesDir = join(__dirname, 'fixtures');

describe('searchPagination', () => {
  describe('detectCurrentSearchPage', () => {
    it('detects page from URL param', () => {
      const url = 'https://hh.ru/search/vacancy?text=developer&page=2';
      expect(detectCurrentSearchPage(url)).toBe(2);
    });

    it('defaults to 0 when no page param', () => {
      const url = 'https://hh.ru/search/vacancy?text=developer';
      expect(detectCurrentSearchPage(url)).toBe(0);
    });

    it('handles page=0 explicitly', () => {
      const url = 'https://hh.ru/search/vacancy?text=developer&page=0';
      expect(detectCurrentSearchPage(url)).toBe(0);
    });

    it('ignores invalid page param', () => {
      const url = 'https://hh.ru/search/vacancy?text=developer&page=invalid';
      expect(detectCurrentSearchPage(url)).toBe(0);
    });
  });

  describe('detectTotalPages', () => {
    it('detects total pages from pager items', () => {
      const html = readFileSync(join(fixturesDir, 'hh-search-page-0.html'), 'utf-8');
      const total = detectTotalPages(html);
      expect(total).toBe(2);
    });

    it('detects total pages from middle page', () => {
      const html = readFileSync(join(fixturesDir, 'hh-search-page-1.html'), 'utf-8');
      const total = detectTotalPages(html);
      expect(total).toBe(2);
    });

    it('detects total pages from last page', () => {
      const html = readFileSync(join(fixturesDir, 'hh-search-last-page.html'), 'utf-8');
      const total = detectTotalPages(html);
      expect(total).toBe(2);
    });

    it('returns null when no pagination', () => {
      const html = '<html><body><div>No pagination</div></body></html>';
      expect(detectTotalPages(html)).toBeNull();
    });
  });

  describe('findNextPageUrl', () => {
    it('increments page param', () => {
      const currentUrl = 'https://hh.ru/search/vacancy?text=developer&page=0';
      const nextUrl = findNextPageUrl(currentUrl);
      expect(nextUrl).toBe('https://hh.ru/search/vacancy?text=developer&page=1');
    });

    it('adds page param when missing', () => {
      const currentUrl = 'https://hh.ru/search/vacancy?text=developer';
      const nextUrl = findNextPageUrl(currentUrl);
      expect(nextUrl).toBe('https://hh.ru/search/vacancy?text=developer&page=1');
    });

    it('preserves other params', () => {
      const currentUrl = 'https://hh.ru/search/vacancy?text=developer&experience=between1And3&page=1';
      const nextUrl = findNextPageUrl(currentUrl);
      expect(nextUrl).toContain('text=developer');
      expect(nextUrl).toContain('experience=between1And3');
      expect(nextUrl).toContain('page=2');
    });
  });

  describe('hasNextPage', () => {
    it('returns true when current < total', () => {
      const html = readFileSync(join(fixturesDir, 'hh-search-page-0.html'), 'utf-8');
      const url = 'https://hh.ru/search/vacancy?text=developer&page=0';
      expect(hasNextPage(url, html)).toBe(true);
    });

    it('returns false on last page', () => {
      const html = readFileSync(join(fixturesDir, 'hh-search-last-page.html'), 'utf-8');
      const url = 'https://hh.ru/search/vacancy?text=developer&page=2';
      expect(hasNextPage(url, html)).toBe(false);
    });

    it('returns true when no HTML provided', () => {
      const url = 'https://hh.ru/search/vacancy?text=developer&page=0';
      expect(hasNextPage(url)).toBe(true);
    });

    it('returns true when total pages unknown', () => {
      const html = '<html><body><div>No pagination</div></body></html>';
      const url = 'https://hh.ru/search/vacancy?text=developer&page=0';
      expect(hasNextPage(url, html)).toBe(true);
    });
  });
});
