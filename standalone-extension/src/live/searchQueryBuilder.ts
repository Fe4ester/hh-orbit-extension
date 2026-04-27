// HH.ru search query builder

import { Profile } from '../state/types';

export interface SearchParams {
  text?: string;
  experience?: string[];
  schedule?: string[];
  employment?: string[];
  area?: string[];
  salary?: string;
  currency_code?: string;
}

export function buildSearchParams(profile: Profile): SearchParams {
  const params: SearchParams = {};

  // Keywords
  if (profile.keywordsInclude.length > 0) {
    const includeText = profile.keywordsInclude.join(' ');
    const excludeText =
      profile.keywordsExclude.length > 0
        ? ' ' + profile.keywordsExclude.map((kw) => `NOT ${kw}`).join(' ')
        : '';
    params.text = includeText + excludeText;
  }

  // Experience
  if (profile.experience.length > 0) {
    params.experience = profile.experience;
  }

  // Schedule
  if (profile.schedule.length > 0) {
    params.schedule = profile.schedule;
  }

  // Employment
  if (profile.employment.length > 0) {
    params.employment = profile.employment;
  }

  // Regions
  if (profile.regions && profile.regions.length > 0) {
    params.area = profile.regions;
  }

  // Salary
  if (profile.salary && profile.salary.amount !== undefined) {
    params.salary = String(profile.salary.amount);
    if (profile.salary.currency) {
      params.currency_code = profile.salary.currency;
    }
  }

  return params;
}

export function buildHHSearchUrl(profile: Profile): string {
  const params = buildSearchParams(profile);
  const baseUrl = 'https://hh.ru/search/vacancy';

  const searchParams = new URLSearchParams();

  if (params.text) {
    searchParams.set('text', params.text);
  }

  if (params.experience) {
    params.experience.forEach((exp) => searchParams.append('experience', exp));
  }

  if (params.schedule) {
    params.schedule.forEach((sch) => searchParams.append('schedule', sch));
  }

  if (params.employment) {
    params.employment.forEach((emp) => searchParams.append('employment', emp));
  }

  if (params.area) {
    params.area.forEach((area) => searchParams.append('area', area));
  }

  if (params.salary) {
    searchParams.set('salary', params.salary);
    if (params.currency_code) {
      searchParams.set('currency_code', params.currency_code);
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

export function isSearchUrlSemanticallyEqual(urlA: string, urlB: string): boolean {
  try {
    const parsedA = new URL(urlA);
    const parsedB = new URL(urlB);

    // Different hosts or paths
    if (parsedA.hostname !== parsedB.hostname || parsedA.pathname !== parsedB.pathname) {
      return false;
    }

    // Compare search params (order-independent)
    const paramsA = new URLSearchParams(parsedA.search);
    const paramsB = new URLSearchParams(parsedB.search);

    // Get all keys
    const keysA = Array.from(paramsA.keys()).sort();
    const keysB = Array.from(paramsB.keys()).sort();

    if (keysA.length !== keysB.length) {
      return false;
    }

    for (let i = 0; i < keysA.length; i++) {
      if (keysA[i] !== keysB[i]) {
        return false;
      }
    }

    // Compare values for each key
    for (const key of keysA) {
      const valuesA = paramsA.getAll(key).sort();
      const valuesB = paramsB.getAll(key).sort();

      if (valuesA.length !== valuesB.length) {
        return false;
      }

      for (let i = 0; i < valuesA.length; i++) {
        if (valuesA[i] !== valuesB[i]) {
          return false;
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}
