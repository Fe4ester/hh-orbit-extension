import { describe, it, expect } from 'vitest';
import {
  isHHUrl,
  detectHHPageType,
  extractVacancyId,
  extractResumeHash,
  parseHHUrl,
} from '../src/live/urlDetection';

describe('URL detection', () => {
  describe('isHHUrl', () => {
    it('should detect hh.ru URLs', () => {
      expect(isHHUrl('https://hh.ru/')).toBe(true);
      expect(isHHUrl('https://hh.ru/search/vacancy')).toBe(true);
      expect(isHHUrl('https://spb.hh.ru/vacancy/123')).toBe(true);
    });

    it('should reject non-HH URLs', () => {
      expect(isHHUrl('https://google.com')).toBe(false);
      expect(isHHUrl('https://example.com')).toBe(false);
      expect(isHHUrl('invalid-url')).toBe(false);
    });
  });

  describe('detectHHPageType', () => {
    it('should detect search page', () => {
      expect(detectHHPageType('https://hh.ru/search/vacancy')).toBe('search');
      expect(detectHHPageType('https://hh.ru/search/vacancy?text=developer')).toBe('search');
    });

    it('should detect vacancy page', () => {
      expect(detectHHPageType('https://hh.ru/vacancy/123456')).toBe('vacancy');
      expect(detectHHPageType('https://hh.ru/vacancy/123456?from=search')).toBe('vacancy');
    });

    it('should detect resume page', () => {
      expect(detectHHPageType('https://hh.ru/resume/abc123def')).toBe('resume');
    });

    it('should detect applicant resumes page', () => {
      expect(detectHHPageType('https://hh.ru/applicant/resumes')).toBe('applicant_resumes');
    });

    it('should detect applicant page', () => {
      expect(detectHHPageType('https://hh.ru/applicant/negotiations')).toBe('applicant');
      expect(detectHHPageType('https://hh.ru/applicant')).toBe('applicant');
    });

    it('should detect login page', () => {
      expect(detectHHPageType('https://hh.ru/account/login')).toBe('login');
      expect(detectHHPageType('https://hh.ru/auth')).toBe('login');
    });

    it('should return unknown for other HH pages', () => {
      expect(detectHHPageType('https://hh.ru/')).toBe('unknown');
      expect(detectHHPageType('https://hh.ru/article/123')).toBe('unknown');
    });

    it('should return null for non-HH URLs', () => {
      expect(detectHHPageType('https://google.com')).toBeNull();
    });
  });

  describe('extractVacancyId', () => {
    it('should extract vacancy ID', () => {
      expect(extractVacancyId('https://hh.ru/vacancy/123456')).toBe('123456');
      expect(extractVacancyId('https://hh.ru/vacancy/123456?from=search')).toBe('123456');
      expect(extractVacancyId('https://spb.hh.ru/vacancy/789012')).toBe('789012');
    });

    it('should return null when no vacancy ID', () => {
      expect(extractVacancyId('https://hh.ru/search/vacancy')).toBeNull();
      expect(extractVacancyId('https://hh.ru/')).toBeNull();
      expect(extractVacancyId('https://google.com')).toBeNull();
    });
  });

  describe('extractResumeHash', () => {
    it('should extract resume hash', () => {
      expect(extractResumeHash('https://hh.ru/resume/abc123def456')).toBe('abc123def456');
      expect(extractResumeHash('https://hh.ru/resume/fedcba987654')).toBe('fedcba987654');
    });

    it('should return null when no resume hash', () => {
      expect(extractResumeHash('https://hh.ru/vacancy/123')).toBeNull();
      expect(extractResumeHash('https://hh.ru/search/vacancy')).toBeNull();
      expect(extractResumeHash('https://google.com')).toBeNull();
    });
  });

  describe('parseHHUrl', () => {
    it('should parse search URL', () => {
      const result = parseHHUrl('https://hh.ru/search/vacancy?text=developer');
      expect(result.pageType).toBe('search');
      expect(result.vacancyId).toBeNull();
      expect(result.resumeHash).toBeNull();
    });

    it('should parse vacancy URL', () => {
      const result = parseHHUrl('https://hh.ru/vacancy/123456');
      expect(result.pageType).toBe('vacancy');
      expect(result.vacancyId).toBe('123456');
      expect(result.resumeHash).toBeNull();
    });

    it('should parse resume URL', () => {
      const result = parseHHUrl('https://hh.ru/resume/abc123def');
      expect(result.pageType).toBe('resume');
      expect(result.vacancyId).toBeNull();
      expect(result.resumeHash).toBe('abc123def');
    });

    it('should handle non-HH URL', () => {
      const result = parseHHUrl('https://google.com');
      expect(result.pageType).toBeNull();
      expect(result.vacancyId).toBeNull();
      expect(result.resumeHash).toBeNull();
    });
  });
});
