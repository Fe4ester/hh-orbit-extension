// Search filter observation and comparison

export interface AppliedSearchContext {
  queryText: string;
  experience: string[];
  schedule: string[];
  employment: string[];
  salary?: {
    amount?: number;
    currency?: string;
  };
  regions?: string[];
  pageType: 'search' | 'unknown';
}

export interface SearchSyncDiff {
  synced: boolean;
  mismatches: {
    field: string;
    expected: any;
    actual: any;
  }[];
}

/**
 * Detect applied search context from DOM or URL
 */
export function detectAppliedSearchContext(
  documentOrHtml: Document | string,
  url?: string
): AppliedSearchContext {
  const doc =
    typeof documentOrHtml === 'string'
      ? new DOMParser().parseFromString(documentOrHtml, 'text/html')
      : documentOrHtml;

  const context: AppliedSearchContext = {
    queryText: '',
    experience: [],
    schedule: [],
    employment: [],
    pageType: 'unknown',
  };

  // Check if search page
  const isSearchPage = url?.includes('/search/vacancy') || doc.querySelector('[data-qa="vacancy-serp"]');
  if (isSearchPage) {
    context.pageType = 'search';
  }

  // Extract from URL params
  if (url) {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;

    // Query text
    context.queryText = params.get('text') || '';

    // Experience
    const experienceParam = params.get('experience');
    if (experienceParam) {
      context.experience = experienceParam.split(',');
    }

    // Schedule
    const scheduleParam = params.get('schedule');
    if (scheduleParam) {
      context.schedule = scheduleParam.split(',');
    }

    // Employment
    const employmentParam = params.get('employment');
    if (employmentParam) {
      context.employment = employmentParam.split(',');
    }

    // Salary
    const salaryParam = params.get('salary');
    if (salaryParam) {
      context.salary = {
        amount: parseInt(salaryParam, 10),
        currency: 'RUR',
      };
    }

    // Regions
    const areaParam = params.get('area');
    if (areaParam) {
      context.regions = areaParam.split(',');
    }
  }

  // Extract from DOM (chips/tags)
  const searchInput = doc.querySelector('[data-qa="vacancy-search-input"]') as HTMLInputElement;
  if (searchInput && searchInput.value) {
    context.queryText = searchInput.value;
  }

  // Extract applied filters from chips
  const filterChips = doc.querySelectorAll('[data-qa="serp-filter-tag"]');
  filterChips.forEach((chip) => {
    const text = chip.textContent?.toLowerCase() || '';

    // Experience chips
    if (text.includes('опыт')) {
      if (text.includes('нет опыта')) context.experience.push('noExperience');
      if (text.includes('от 1 года')) context.experience.push('between1And3');
      if (text.includes('от 3 лет')) context.experience.push('between3And6');
      if (text.includes('более 6 лет')) context.experience.push('moreThan6');
    }

    // Schedule chips
    if (text.includes('график')) {
      if (text.includes('полный день')) context.schedule.push('fullDay');
      if (text.includes('удаленная')) context.schedule.push('remote');
      if (text.includes('гибкий')) context.schedule.push('flexible');
      if (text.includes('сменный')) context.schedule.push('shift');
    }

    // Employment chips
    if (text.includes('занятость')) {
      if (text.includes('полная')) context.employment.push('full');
      if (text.includes('частичная')) context.employment.push('part');
      if (text.includes('проектная')) context.employment.push('project');
      if (text.includes('стажировка')) context.employment.push('probation');
    }
  });

  return context;
}

/**
 * Compare profile to applied search context
 */
export function compareProfileToAppliedContext(
  profile: {
    keywordsInclude: string[];
    experience: string[];
    schedule: string[];
    employment: string[];
    salary?: { amount?: number; currency?: string };
    regions?: string[];
  },
  context: AppliedSearchContext
): SearchSyncDiff {
  const mismatches: SearchSyncDiff['mismatches'] = [];

  // Compare query text (keywords)
  const expectedQuery = profile.keywordsInclude.join(' ');
  if (expectedQuery !== context.queryText) {
    mismatches.push({
      field: 'queryText',
      expected: expectedQuery,
      actual: context.queryText,
    });
  }

  // Compare experience
  const experienceMismatch = !arraysEqual(
    profile.experience.sort(),
    context.experience.sort()
  );
  if (experienceMismatch) {
    mismatches.push({
      field: 'experience',
      expected: profile.experience,
      actual: context.experience,
    });
  }

  // Compare schedule
  const scheduleMismatch = !arraysEqual(
    profile.schedule.sort(),
    context.schedule.sort()
  );
  if (scheduleMismatch) {
    mismatches.push({
      field: 'schedule',
      expected: profile.schedule,
      actual: context.schedule,
    });
  }

  // Compare employment
  const employmentMismatch = !arraysEqual(
    profile.employment.sort(),
    context.employment.sort()
  );
  if (employmentMismatch) {
    mismatches.push({
      field: 'employment',
      expected: profile.employment,
      actual: context.employment,
    });
  }

  // Compare salary (optional)
  if (profile.salary?.amount && context.salary?.amount) {
    if (profile.salary.amount !== context.salary.amount) {
      mismatches.push({
        field: 'salary',
        expected: profile.salary.amount,
        actual: context.salary.amount,
      });
    }
  }

  // Compare regions (optional)
  if (profile.regions && context.regions) {
    const regionsMismatch = !arraysEqual(
      profile.regions.sort(),
      context.regions.sort()
    );
    if (regionsMismatch) {
      mismatches.push({
        field: 'regions',
        expected: profile.regions,
        actual: context.regions,
      });
    }
  }

  return {
    synced: mismatches.length === 0,
    mismatches,
  };
}

/**
 * Helper: compare arrays for equality
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
