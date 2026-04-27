import { describe, it, expect } from 'vitest';
import { buildHHSearchUrl, buildSearchParams, isSearchUrlSemanticallyEqual } from '../src/live/searchQueryBuilder';
import { Profile } from '../src/state/types';

function createTestProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'test-profile',
    name: 'Test Profile',
    keywordsInclude: [],
    keywordsExclude: [],
    experience: [],
    schedule: [],
    employment: [],
    regions: [],
    salary: undefined,
    coverLetterTemplate: '',
    selectedResumeHash: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('buildSearchParams', () => {
  it('builds empty params for profile without filters', () => {
    const profile = createTestProfile();
    const params = buildSearchParams(profile);
    expect(params).toEqual({});
  });

  it('builds text param from keywordsInclude', () => {
    const profile = createTestProfile({
      keywordsInclude: ['typescript', 'react'],
    });
    const params = buildSearchParams(profile);
    expect(params.text).toBe('typescript react');
  });

  it('builds text param with exclude keywords using NOT syntax', () => {
    const profile = createTestProfile({
      keywordsInclude: ['typescript'],
      keywordsExclude: ['php', 'java'],
    });
    const params = buildSearchParams(profile);
    expect(params.text).toBe('typescript NOT php NOT java');
  });

  it('builds experience param', () => {
    const profile = createTestProfile({
      experience: ['between1And3', 'between3And6'],
    });
    const params = buildSearchParams(profile);
    expect(params.experience).toEqual(['between1And3', 'between3And6']);
  });

  it('builds schedule param', () => {
    const profile = createTestProfile({
      schedule: ['remote', 'flexible'],
    });
    const params = buildSearchParams(profile);
    expect(params.schedule).toEqual(['remote', 'flexible']);
  });

  it('builds employment param', () => {
    const profile = createTestProfile({
      employment: ['full', 'part'],
    });
    const params = buildSearchParams(profile);
    expect(params.employment).toEqual(['full', 'part']);
  });

  it('builds area param from regions', () => {
    const profile = createTestProfile({
      regions: ['1', '2'],
    });
    const params = buildSearchParams(profile);
    expect(params.area).toEqual(['1', '2']);
  });

  it('builds salary param', () => {
    const profile = createTestProfile({
      salary: { amount: 100000, currency: 'RUR' },
    });
    const params = buildSearchParams(profile);
    expect(params.salary).toBe('100000');
  });

  it('builds all params together', () => {
    const profile = createTestProfile({
      keywordsInclude: ['typescript'],
      keywordsExclude: ['php'],
      experience: ['between1And3'],
      schedule: ['remote'],
      employment: ['full'],
      regions: ['1'],
      salary: { amount: 100000, currency: 'RUR' },
    });
    const params = buildSearchParams(profile);
    expect(params).toEqual({
      text: 'typescript NOT php',
      experience: ['between1And3'],
      schedule: ['remote'],
      employment: ['full'],
      area: ['1'],
      salary: '100000',
      currency_code: 'RUR',
    });
  });
});

describe('buildHHSearchUrl', () => {
  it('builds base URL for profile without filters', () => {
    const profile = createTestProfile();
    const url = buildHHSearchUrl(profile);
    expect(url).toBe('https://hh.ru/search/vacancy');
  });

  it('builds URL with text param', () => {
    const profile = createTestProfile({
      keywordsInclude: ['typescript'],
    });
    const url = buildHHSearchUrl(profile);
    expect(url).toBe('https://hh.ru/search/vacancy?text=typescript');
  });

  it('builds URL with multiple params', () => {
    const profile = createTestProfile({
      keywordsInclude: ['typescript'],
      experience: ['between1And3'],
      schedule: ['remote'],
    });
    const url = buildHHSearchUrl(profile);
    expect(url).toContain('https://hh.ru/search/vacancy?');
    expect(url).toContain('text=typescript');
    expect(url).toContain('experience=between1And3');
    expect(url).toContain('schedule=remote');
  });

  it('is deterministic - same profile produces same URL', () => {
    const profile = createTestProfile({
      keywordsInclude: ['typescript', 'react'],
      experience: ['between1And3', 'between3And6'],
      schedule: ['remote', 'flexible'],
    });
    const url1 = buildHHSearchUrl(profile);
    const url2 = buildHHSearchUrl(profile);
    expect(url1).toBe(url2);
  });

  it('encodes special characters in text param', () => {
    const profile = createTestProfile({
      keywordsInclude: ['C++', 'Node.js'],
    });
    const url = buildHHSearchUrl(profile);
    expect(url).toContain('text=C%2B%2B+Node.js');
  });
});

describe('isSearchUrlSemanticallyEqual', () => {
  it('returns true for identical URLs', () => {
    const urlA = 'https://hh.ru/search/vacancy?text=typescript&experience=between1And3';
    const urlB = 'https://hh.ru/search/vacancy?text=typescript&experience=between1And3';
    expect(isSearchUrlSemanticallyEqual(urlA, urlB)).toBe(true);
  });

  it('returns true for URLs with different param order', () => {
    const urlA = 'https://hh.ru/search/vacancy?text=typescript&experience=between1And3';
    const urlB = 'https://hh.ru/search/vacancy?experience=between1And3&text=typescript';
    expect(isSearchUrlSemanticallyEqual(urlA, urlB)).toBe(true);
  });

  it('returns false for URLs with different param values', () => {
    const urlA = 'https://hh.ru/search/vacancy?text=typescript';
    const urlB = 'https://hh.ru/search/vacancy?text=javascript';
    expect(isSearchUrlSemanticallyEqual(urlA, urlB)).toBe(false);
  });

  it('returns false for URLs with different params', () => {
    const urlA = 'https://hh.ru/search/vacancy?text=typescript';
    const urlB = 'https://hh.ru/search/vacancy?text=typescript&experience=between1And3';
    expect(isSearchUrlSemanticallyEqual(urlA, urlB)).toBe(false);
  });

  it('returns false for different base URLs', () => {
    const urlA = 'https://hh.ru/search/vacancy?text=typescript';
    const urlB = 'https://hh.ru/vacancy/12345?text=typescript';
    expect(isSearchUrlSemanticallyEqual(urlA, urlB)).toBe(false);
  });

  it('returns true for URLs with same params but different order and encoding', () => {
    const urlA = 'https://hh.ru/search/vacancy?text=C%2B%2B&schedule=remote';
    const urlB = 'https://hh.ru/search/vacancy?schedule=remote&text=C%2B%2B';
    expect(isSearchUrlSemanticallyEqual(urlA, urlB)).toBe(true);
  });

  it('handles URLs without query params', () => {
    const urlA = 'https://hh.ru/search/vacancy';
    const urlB = 'https://hh.ru/search/vacancy';
    expect(isSearchUrlSemanticallyEqual(urlA, urlB)).toBe(true);
  });

  it('returns false when one URL has params and other does not', () => {
    const urlA = 'https://hh.ru/search/vacancy';
    const urlB = 'https://hh.ru/search/vacancy?text=typescript';
    expect(isSearchUrlSemanticallyEqual(urlA, urlB)).toBe(false);
  });
});
