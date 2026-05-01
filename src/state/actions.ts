// Profile actions

import { Profile } from './types';
import { FileLogger } from '../utils/fileLogger';

export const DEFAULT_PROFILE_PRESETS: Array<Omit<CreateProfilePayload, 'selectedResumeHash'> & { name: string }> = [
  {
    name: 'Python',
    keywordsInclude: ['python', 'django', 'fastapi'],
    keywordsExclude: ['junior', 'intern', 'стажер', 'стажировка'],
  },
  {
    name: 'Rust',
    keywordsInclude: ['rust', 'tokio', 'backend'],
    keywordsExclude: ['junior', 'intern', 'стажер', 'стажировка'],
  },
  {
    name: 'Frontend',
    keywordsInclude: ['frontend', 'react', 'typescript'],
    keywordsExclude: ['junior', 'intern', 'стажер', 'стажировка'],
  },
  {
    name: 'Fullstack',
    keywordsInclude: ['fullstack', 'typescript', 'node.js', 'react'],
    keywordsExclude: ['junior', 'intern', 'стажер', 'стажировка'],
  },
  {
    name: 'QA',
    keywordsInclude: ['qa', 'тестировщик', 'automation', 'python'],
    keywordsExclude: ['intern', 'стажер', 'стажировка'],
  },
];

export interface CreateProfilePayload {
  name: string;
  keywordsInclude?: string[];
  keywordsExclude?: string[];
  coverLetterTemplate?: string;
  selectedResumeHash?: string | null;
}

export interface UpdateProfilePayload {
  name?: string;
  keywordsInclude?: string[];
  keywordsExclude?: string[];
  coverLetterTemplate?: string;
  selectedResumeHash?: string | null;
}

export function createProfile(payload: CreateProfilePayload): Profile {
  const now = Date.now();
  const id = `profile_${now}_${Math.random().toString(36).substr(2, 9)}`;

  return {
    id,
    name: payload.name,
    keywordsInclude: payload.keywordsInclude || [],
    keywordsExclude: payload.keywordsExclude || [],
    coverLetterTemplate: payload.coverLetterTemplate,
    selectedResumeHash: payload.selectedResumeHash || null,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateProfile(profile: Profile, patch: UpdateProfilePayload): Profile {
  return {
    ...profile,
    ...patch,
    updatedAt: Date.now(),
  };
}

export function duplicateProfile(profile: Profile): Profile {
  const now = Date.now();
  const id = `profile_${now}_${Math.random().toString(36).substr(2, 9)}`;

  return {
    ...profile,
    id,
    name: `Copy of ${profile.name}`,
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultProfiles(now: number = Date.now()): Profile[] {
  return DEFAULT_PROFILE_PRESETS.map((preset, index) => {
    const stamp = now + index;
    return {
      id: `profile_${stamp}_${Math.random().toString(36).substr(2, 9)}`,
      name: preset.name,
      keywordsInclude: preset.keywordsInclude || [],
      keywordsExclude: preset.keywordsExclude || [],
      coverLetterTemplate: preset.coverLetterTemplate,
      selectedResumeHash: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
  });
}

// Resume actions

import { ResumeCandidate, AttemptRecord, AnalyticsEvent, AttemptOutcome } from './types';

export function createDemoResumes(): ResumeCandidate[] {
  const now = Date.now();
  return [
    {
      hash: 'resume_demo_1',
      title: 'Frontend разработчик (React, TypeScript)',
      url: 'https://hh.ru/resume/demo1',
      isActive: true,
      lastSeenAt: now,
      source: 'demo',
    },
    {
      hash: 'resume_demo_2',
      title: 'Fullstack разработчик (Node.js, React)',
      url: 'https://hh.ru/resume/demo2',
      isActive: true,
      lastSeenAt: now,
      source: 'demo',
    },
  ];
}

// Analytics actions

export function recordAttemptOutcome(
  outcome: AttemptOutcome,
  profileId?: string,
  vacancyId?: string,
  source: 'local' | 'imported' = 'local'
): AttemptRecord {
  const now = Date.now();
  const id = `attempt_${now}_${Math.random().toString(36).substr(2, 9)}`;

  return {
    id,
    profileId,
    vacancyId,
    outcome,
    createdAt: now,
    finishedAt: now,
    source,
  };
}

export function recordAnalyticsEvent(
  type: string,
  payload?: Record<string, any>,
  attemptId?: string,
  profileId?: string
): AnalyticsEvent {
  const now = Date.now();
  const id = `event_${now}_${Math.random().toString(36).substr(2, 9)}`;

  return {
    id,
    type,
    attemptId,
    profileId,
    timestamp: now,
    payload,
  };
}

export function seedDemoAnalytics(): {
  attempts: AttemptRecord[];
  events: AnalyticsEvent[];
} {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const oneHour = 60 * 60 * 1000;

  const attempts: AttemptRecord[] = [];

  // Historical attempts (3-7 days ago)
  for (let i = 0; i < 8; i++) {
    const createdAt = now - oneDay * (3 + Math.floor(Math.random() * 4));
    attempts.push({
      id: `attempt_hist_${i}`,
      profileId: 'profile_default',
      vacancyId: `vacancy_hist_${i}`,
      outcome: i % 5 === 0 ? 'FAILED_RETRYABLE' : 'SUCCEEDED',
      createdAt,
      finishedAt: createdAt + 1000,
      source: 'imported',
    });
  }

  // Today attempts (last 6 hours)
  for (let i = 0; i < 7; i++) {
    const createdAt = now - oneHour * (1 + i);
    const outcomes: AttemptOutcome[] = [
      'SUCCEEDED',
      'SUCCEEDED',
      'SUCCEEDED',
      'ESCALATED',
      'FAILED_RETRYABLE',
      'SKIPPED_DUPLICATE',
      'MANUAL_ACTION_REQUIRED',
    ];
    attempts.push({
      id: `attempt_today_${i}`,
      profileId: 'profile_default',
      vacancyId: `vacancy_today_${i}`,
      outcome: outcomes[i],
      createdAt,
      finishedAt: createdAt + 2000,
      source: 'local',
    });
  }

  // Current run attempts (last 30 min)
  for (let i = 0; i < 5; i++) {
    const createdAt = now - (30 - i * 5) * 60 * 1000;
    const outcomes: AttemptOutcome[] = [
      'SUCCEEDED',
      'SUCCEEDED',
      'ESCALATED',
      'FAILED_FINAL',
      'SUCCEEDED',
    ];
    attempts.push({
      id: `attempt_run_${i}`,
      profileId: 'profile_default',
      vacancyId: `vacancy_run_${i}`,
      outcome: outcomes[i],
      createdAt,
      finishedAt: createdAt + 1500,
      source: 'local',
    });
  }

  const events: AnalyticsEvent[] = [];

  return { attempts, events };
}

// Vacancy scan actions

export const NO_MORE_VACANCIES_THRESHOLD = 3;

export interface VacancyScanRecord {
  foundCount: number;
  newCount: number;
  timestamp: number;
}

export function recordVacancyScan(
  currentState: import('./types').VacancyScanState,
  scan: VacancyScanRecord
): import('./types').VacancyScanState {
  const now = scan.timestamp;

  if (scan.newCount > 0) {
    // Found new vacancies - reset exhaustion
    return {
      consecutiveEmptyScans: 0,
      lastScanAt: now,
      lastNewVacancyAt: now,
      exhausted: false,
      exhaustedReason: undefined,
    };
  }

  // No new vacancies
  const consecutiveEmptyScans = currentState.consecutiveEmptyScans + 1;
  const exhausted = consecutiveEmptyScans >= NO_MORE_VACANCIES_THRESHOLD;

  return {
    consecutiveEmptyScans,
    lastScanAt: now,
    lastNewVacancyAt: currentState.lastNewVacancyAt,
    exhausted,
    exhaustedReason: exhausted ? 'consecutive_empty_scans' : undefined,
  };
}

export function markNoMoreVacancies(
  reason: import('./types').VacancyExhaustionReason
): import('./types').VacancyScanState {
  return {
    consecutiveEmptyScans: NO_MORE_VACANCIES_THRESHOLD,
    lastScanAt: Date.now(),
    lastNewVacancyAt: null,
    exhausted: true,
    exhaustedReason: reason,
  };
}

export function resetVacancyExhaustion(): import('./types').VacancyScanState {
  return {
    consecutiveEmptyScans: 0,
    lastScanAt: null,
    lastNewVacancyAt: null,
    exhausted: false,
    exhaustedReason: undefined,
  };
}

// Live mode actions

import { parseHHUrl } from '../live/urlDetection';

export function activateLiveMode(): import('./types').LiveModeState {
  return {
    active: true,
    controlledTabId: null,
    controlledWindowId: null,
    controlledTabPurpose: null,
    currentUrl: null,
    pageType: null,
    detectedVacancyId: null,
    detectedResumeHash: null,
    lastHeartbeatAt: Date.now(),
    targetSearchUrl: null,
    lastAppliedSearchUrl: null,
    lastAppliedProfileId: null,
    searchSyncStatus: 'idle',
    vacancyDetailObservation: null,
    preflightClassification: null,
    searchSyncDiff: null,
    searchLoopActive: false,
    runtimeSearchTabId: null,
    currentSearchPage: null,
    lastScannedPage: null,
    totalPagesDetected: null,
    lastScanVacancyCount: 0,
    searchLoopIterations: 0,
  };
}

export function deactivateLiveMode(): import('./types').LiveModeState {
  return {
    active: false,
    controlledTabId: null,
    controlledWindowId: null,
    controlledTabPurpose: null,
    currentUrl: null,
    pageType: null,
    detectedVacancyId: null,
    detectedResumeHash: null,
    lastHeartbeatAt: null,
    targetSearchUrl: null,
    lastAppliedSearchUrl: null,
    lastAppliedProfileId: null,
    searchSyncStatus: 'idle',
    vacancyDetailObservation: null,
    preflightClassification: null,
    searchSyncDiff: null,
    searchLoopActive: false,
    runtimeSearchTabId: null,
    currentSearchPage: null,
    lastScannedPage: null,
    totalPagesDetected: null,
    lastScanVacancyCount: 0,
    searchLoopIterations: 0,
  };
}

export interface BindControlledTabPayload {
  tabId: number;
  windowId: number;
  url: string;
}

export function bindControlledTab(
  payload: BindControlledTabPayload
): import('./types').LiveModeState {
  const context = parseHHUrl(payload.url);

  // Determine purpose based on page type
  let purpose: import('./types').ControlledTabPurpose = 'generic_hh';
  if (context.pageType === 'applicant_resumes' || context.pageType === 'resume' || context.pageType === 'applicant') {
    purpose = 'resume_detection';
  } else if (context.pageType === 'search') {
    purpose = 'search';
  } else if (context.pageType === 'vacancy') {
    purpose = 'vacancy';
  }

  return {
    active: true,
    controlledTabId: payload.tabId,
    controlledWindowId: payload.windowId,
    controlledTabPurpose: purpose,
    currentUrl: payload.url,
    pageType: context.pageType,
    detectedVacancyId: context.vacancyId,
    detectedResumeHash: context.resumeHash,
    lastHeartbeatAt: Date.now(),
    targetSearchUrl: null,
    lastAppliedSearchUrl: null,
    lastAppliedProfileId: null,
    searchSyncStatus: 'idle',
    vacancyDetailObservation: null,
    preflightClassification: null,
    searchSyncDiff: null,
    searchLoopActive: false,
    runtimeSearchTabId: null,
    currentSearchPage: null,
    lastScannedPage: null,
    totalPagesDetected: null,
    lastScanVacancyCount: 0,
    searchLoopIterations: 0,
  };
}

export function updateLiveContextFromUrl(
  currentState: import('./types').LiveModeState,
  url: string
): import('./types').LiveModeState {
  const context = parseHHUrl(url);

  return {
    ...currentState,
    currentUrl: url,
    pageType: context.pageType,
    detectedVacancyId: context.vacancyId,
    detectedResumeHash: context.resumeHash,
    lastHeartbeatAt: Date.now(),
  };
}

export function clearControlledTab(
  currentState: import('./types').LiveModeState
): import('./types').LiveModeState {
  return {
    ...currentState,
    controlledTabId: null,
    controlledWindowId: null,
    currentUrl: null,
    pageType: null,
    detectedVacancyId: null,
    detectedResumeHash: null,
  };
}

export function setLiveModeTargetSearch(
  currentState: import('./types').LiveModeState,
  profileId: string,
  url: string
): import('./types').LiveModeState {
  return {
    ...currentState,
    targetSearchUrl: url,
    lastAppliedProfileId: profileId,
    searchSyncStatus: 'idle',
  };
}

export function markSearchNavigating(
  currentState: import('./types').LiveModeState,
  url: string
): import('./types').LiveModeState {
  return {
    ...currentState,
    currentUrl: url,
    searchSyncStatus: 'navigating',
  };
}

export function markSearchSynced(
  currentState: import('./types').LiveModeState,
  url: string,
  profileId: string
): import('./types').LiveModeState {
  return {
    ...currentState,
    lastAppliedSearchUrl: url,
    lastAppliedProfileId: profileId,
    searchSyncStatus: 'synced',
  };
}

export function markSearchOutOfSync(
  currentState: import('./types').LiveModeState
): import('./types').LiveModeState {
  return {
    ...currentState,
    searchSyncStatus: 'out_of_sync',
  };
}

export function markSearchError(
  currentState: import('./types').LiveModeState
): import('./types').LiveModeState {
  return {
    ...currentState,
    searchSyncStatus: 'error',
  };
}

// Vacancy detail preflight actions

import {
  VacancyDetailObservation,
  PreflightClassification,
} from '../live/vacancyDetailParser';

export function setVacancyDetailObservation(
  currentState: import('./types').LiveModeState,
  observation: VacancyDetailObservation
): import('./types').LiveModeState {
  return {
    ...currentState,
    vacancyDetailObservation: observation,
  };
}

export function setPreflightClassification(
  currentState: import('./types').LiveModeState,
  classification: PreflightClassification
): import('./types').LiveModeState {
  return {
    ...currentState,
    preflightClassification: classification,
  };
}

export function clearPreflightState(
  currentState: import('./types').LiveModeState
): import('./types').LiveModeState {
  return {
    ...currentState,
    vacancyDetailObservation: null,
    preflightClassification: null,
  };
}

// Vacancy queue actions

import { ParsedVacancyCard } from '../live/searchResultsParser';
import { VacancyQueueItem } from './types';

export function materializeVacanciesFromSearch(
  currentQueue: VacancyQueueItem[],
  cards: ParsedVacancyCard[],
  profileId: string | null,
  profile?: { keywordsInclude: string[]; keywordsExclude: string[] }
): VacancyQueueItem[] {
  const now = Date.now();

  // Build set of existing keys for dedupe
  const existingKeys = new Set(
    currentQueue.map((item) => item.vacancyId || item.url)
  );

  // Filter out duplicates
  const newCards = cards.filter((card) => {
    const key = card.vacancyId || card.url;
    return !existingKeys.has(key);
  });

  // Early keyword prefilter
  let prefilteredCards = newCards;
  let skippedByInclude = 0;
  let skippedByExclude = 0;

  if (profile) {
    prefilteredCards = newCards.filter((card) => {
      const searchText = `${card.title} ${card.snippet || ''}`.toLowerCase();

      // Check keywordsInclude (ANY must match)
      if (profile.keywordsInclude.length > 0) {
        const hasMatch = profile.keywordsInclude.some((kw) =>
          searchText.includes(kw.toLowerCase())
        );
        if (!hasMatch) {
          skippedByInclude++;
          return false;
        }
      }

      // Check keywordsExclude (NONE must match)
      if (profile.keywordsExclude.length > 0) {
        const hasExcluded = profile.keywordsExclude.some((kw) =>
          searchText.includes(kw.toLowerCase())
        );
        if (hasExcluded) {
          skippedByExclude++;
          return false;
        }
      }

      return true;
    });

    FileLogger.log('service_worker', 'info', 'Materialization prefilter', {
      totalCards: newCards.length,
      afterPrefilter: prefilteredCards.length,
      skippedByInclude,
      skippedByExclude,
      profileId,
    });
  }

  // Create queue items
  const newItems: VacancyQueueItem[] = prefilteredCards.map((card) => ({
    vacancyId: card.vacancyId,
    url: card.url,
    title: card.title,
    company: card.company,
    source: 'search_dom',
    discoveredAt: now,
    profileId,
    status: 'discovered',
    cardIndex: card.cardIndex,
  }));

  return [...currentQueue, ...newItems];
}

export function clearVacancyQueue(): VacancyQueueItem[] {
  return [];
}

export function markVacancyQueued(
  queue: VacancyQueueItem[],
  vacancyId: string
): VacancyQueueItem[] {
  return queue.map((item) =>
    item.vacancyId === vacancyId ? { ...item, status: 'queued' as const } : item
  );
}

export function markVacancyProcessed(
  queue: VacancyQueueItem[],
  vacancyId: string
): VacancyQueueItem[] {
  return queue.map((item) =>
    item.vacancyId === vacancyId ? { ...item, status: 'processed' as const } : item
  );
}

export function markVacancySkipped(
  queue: VacancyQueueItem[],
  vacancyId: string
): VacancyQueueItem[] {
  return queue.map((item) =>
    item.vacancyId === vacancyId ? { ...item, status: 'skipped' as const } : item
  );
}

// Apply attempt actions

import { LocalApplyAttempt } from './types';

export function recordLocalApplyAttempt(
  currentAttempts: LocalApplyAttempt[],
  attempt: Omit<LocalApplyAttempt, 'id' | 'createdAt'>
): LocalApplyAttempt[] {
  const now = Date.now();
  const id = `attempt_${now}_${Math.random().toString(36).substr(2, 9)}`;

  const newAttempt: LocalApplyAttempt = {
    id,
    ...attempt,
    createdAt: now,
  };

  return [...currentAttempts, newAttempt];
}

export function clearApplyAttempts(): LocalApplyAttempt[] {
  return [];
}
