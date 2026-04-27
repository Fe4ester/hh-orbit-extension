import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  detectAppliedSearchContext,
  compareProfileToAppliedContext,
} from '../src/live/searchFilterObserver';

describe('searchFilterObserver', () => {
  const loadFixture = (filename: string): string => {
    return readFileSync(join(__dirname, 'fixtures', filename), 'utf-8');
  };

  describe('detectAppliedSearchContext', () => {
    it('detects context from URL params', () => {
      const url = 'https://hh.ru/search/vacancy?text=frontend+developer&experience=between3And6&schedule=remote&employment=full';

      const context = detectAppliedSearchContext('', url);

      expect(context.queryText).toBe('frontend developer');
      expect(context.experience).toEqual(['between3And6']);
      expect(context.schedule).toEqual(['remote']);
      expect(context.employment).toEqual(['full']);
      expect(context.pageType).toBe('search');
    });

    it('detects context from DOM', () => {
      const html = loadFixture('hh-search-page.html');
      const url = 'https://hh.ru/search/vacancy';

      const context = detectAppliedSearchContext(html, url);

      expect(context.queryText).toBe('frontend developer react');
      expect(context.experience).toContain('between3And6');
      expect(context.schedule).toContain('remote');
      expect(context.employment).toContain('full');
      expect(context.pageType).toBe('search');
    });

    it('extracts salary from URL', () => {
      const url = 'https://hh.ru/search/vacancy?text=developer&salary=100000';

      const context = detectAppliedSearchContext('', url);

      expect(context.salary?.amount).toBe(100000);
      expect(context.salary?.currency).toBe('RUR');
    });

    it('extracts regions from URL', () => {
      const url = 'https://hh.ru/search/vacancy?text=developer&area=1,2';

      const context = detectAppliedSearchContext('', url);

      expect(context.regions).toEqual(['1', '2']);
    });

    it('returns unknown page type for non-search pages', () => {
      const context = detectAppliedSearchContext('', 'https://hh.ru/vacancy/123');

      expect(context.pageType).toBe('unknown');
    });

    it('handles multiple experience values', () => {
      const url = 'https://hh.ru/search/vacancy?experience=noExperience,between1And3';

      const context = detectAppliedSearchContext('', url);

      expect(context.experience).toEqual(['noExperience', 'between1And3']);
    });
  });

  describe('compareProfileToAppliedContext', () => {
    it('returns synced when profile matches context', () => {
      const profile = {
        keywordsInclude: ['frontend developer'],
        experience: ['between3And6'],
        schedule: ['remote'],
        employment: ['full'],
      };

      const context = {
        queryText: 'frontend developer',
        experience: ['between3And6'],
        schedule: ['remote'],
        employment: ['full'],
        pageType: 'search' as const,
      };

      const diff = compareProfileToAppliedContext(profile, context);

      expect(diff.synced).toBe(true);
      expect(diff.mismatches).toHaveLength(0);
    });

    it('detects query text mismatch', () => {
      const profile = {
        keywordsInclude: ['backend developer'],
        experience: [],
        schedule: [],
        employment: [],
      };

      const context = {
        queryText: 'frontend developer',
        experience: [],
        schedule: [],
        employment: [],
        pageType: 'search' as const,
      };

      const diff = compareProfileToAppliedContext(profile, context);

      expect(diff.synced).toBe(false);
      expect(diff.mismatches).toHaveLength(1);
      expect(diff.mismatches[0].field).toBe('queryText');
      expect(diff.mismatches[0].expected).toBe('backend developer');
      expect(diff.mismatches[0].actual).toBe('frontend developer');
    });

    it('detects experience mismatch', () => {
      const profile = {
        keywordsInclude: [],
        experience: ['between3And6'],
        schedule: [],
        employment: [],
      };

      const context = {
        queryText: '',
        experience: ['noExperience'],
        schedule: [],
        employment: [],
        pageType: 'search' as const,
      };

      const diff = compareProfileToAppliedContext(profile, context);

      expect(diff.synced).toBe(false);
      expect(diff.mismatches.some((m) => m.field === 'experience')).toBe(true);
    });

    it('detects schedule mismatch', () => {
      const profile = {
        keywordsInclude: [],
        experience: [],
        schedule: ['remote'],
        employment: [],
      };

      const context = {
        queryText: '',
        experience: [],
        schedule: ['fullDay'],
        employment: [],
        pageType: 'search' as const,
      };

      const diff = compareProfileToAppliedContext(profile, context);

      expect(diff.synced).toBe(false);
      expect(diff.mismatches.some((m) => m.field === 'schedule')).toBe(true);
    });

    it('detects employment mismatch', () => {
      const profile = {
        keywordsInclude: [],
        experience: [],
        schedule: [],
        employment: ['full'],
      };

      const context = {
        queryText: '',
        experience: [],
        schedule: [],
        employment: ['part'],
        pageType: 'search' as const,
      };

      const diff = compareProfileToAppliedContext(profile, context);

      expect(diff.synced).toBe(false);
      expect(diff.mismatches.some((m) => m.field === 'employment')).toBe(true);
    });

    it('detects multiple mismatches', () => {
      const profile = {
        keywordsInclude: ['backend'],
        experience: ['between3And6'],
        schedule: ['remote'],
        employment: ['full'],
      };

      const context = {
        queryText: 'frontend',
        experience: ['noExperience'],
        schedule: ['fullDay'],
        employment: ['part'],
        pageType: 'search' as const,
      };

      const diff = compareProfileToAppliedContext(profile, context);

      expect(diff.synced).toBe(false);
      expect(diff.mismatches).toHaveLength(4);
    });

    it('handles array order differences', () => {
      const profile = {
        keywordsInclude: [],
        experience: ['between3And6', 'moreThan6'],
        schedule: [],
        employment: [],
      };

      const context = {
        queryText: '',
        experience: ['moreThan6', 'between3And6'],
        schedule: [],
        employment: [],
        pageType: 'search' as const,
      };

      const diff = compareProfileToAppliedContext(profile, context);

      expect(diff.synced).toBe(true);
    });
  });
});
