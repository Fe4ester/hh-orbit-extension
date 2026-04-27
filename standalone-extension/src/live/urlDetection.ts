// HH.ru URL detection and parsing

import { HHPageType } from '../state/types';

export function isHHUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'hh.ru' || parsed.hostname.endsWith('.hh.ru');
  } catch {
    return false;
  }
}

export function detectHHPageType(url: string): HHPageType {
  if (!isHHUrl(url)) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const path = parsed.pathname;

    // Search pages
    if (path.includes('/search/vacancy')) {
      return 'search';
    }

    // Vacancy detail page
    if (path.includes('/vacancy/')) {
      return 'vacancy';
    }

    // Resume pages
    if (path.includes('/resume/')) {
      return 'resume';
    }

    // Applicant resumes list (more specific than general applicant)
    if (path.includes('/applicant/resumes')) {
      return 'applicant_resumes';
    }

    // Applicant area (general)
    if (path.includes('/applicant')) {
      return 'applicant';
    }

    // Login/auth pages
    if (path.includes('/account/login') || path.includes('/auth')) {
      return 'login';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function extractVacancyId(url: string): string | null {
  if (!isHHUrl(url)) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const path = parsed.pathname;

    // Match /vacancy/{id} or /vacancy/{id}/...
    const match = path.match(/\/vacancy\/(\d+)/);
    if (match && match[1]) {
      return match[1];
    }

    return null;
  } catch {
    return null;
  }
}

export function extractResumeHash(url: string): string | null {
  if (!isHHUrl(url)) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const path = parsed.pathname;

    // Match /resume/{hash}
    const match = path.match(/\/resume\/([a-f0-9]+)/);
    if (match && match[1]) {
      return match[1];
    }

    return null;
  } catch {
    return null;
  }
}

export interface URLContext {
  pageType: HHPageType;
  vacancyId: string | null;
  resumeHash: string | null;
}

export function parseHHUrl(url: string): URLContext {
  return {
    pageType: detectHHPageType(url),
    vacancyId: extractVacancyId(url),
    resumeHash: extractResumeHash(url),
  };
}
