// HH.ru search query builder

import { Profile } from '../state/types';

export interface SearchParams {
  text?: string;
  experience?: string;
  schedule?: string[];
  employment?: string[];
  area?: string[];
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
  if (profile.experience) {
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

  return params;
}

export function buildHHSearchUrl(profile: Profile, broadSearch = false): string {
  const params = buildSearchParams(profile);
  const baseUrl = 'https://hh.ru/search/vacancy';

  const searchParams = new URLSearchParams();

  if (params.text) {
    searchParams.set('text', params.text);
  }

  // В режиме глобального поиска пропускаем фильтры
  if (!broadSearch) {
    if (params.experience) {
      searchParams.append('experience', params.experience);
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
