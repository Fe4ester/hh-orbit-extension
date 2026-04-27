// Profile selectors - single source of truth

import { AppState, Profile, RunStatus, RunStage } from './types';

// Run selectors

export interface RunViewModel {
  isRunning: boolean;
  status: RunStatus;
  currentStage: RunStage;
  processed: number;
  succeeded: number;
  manualActionsCount: number;
  lastError: string | null;
  canStart: boolean;
  canStop: boolean;
}

export function getCurrentRunViewModel(state: AppState): RunViewModel {
  const run = state.currentRun;

  if (!run) {
    return {
      isRunning: false,
      status: 'idle',
      currentStage: 'idle',
      processed: 0,
      succeeded: 0,
      manualActionsCount: 0,
      lastError: null,
      canStart: true,
      canStop: false,
    };
  }

  return {
    isRunning: run.status === 'running',
    status: run.status,
    currentStage: run.currentStage,
    processed: run.processed,
    succeeded: run.succeeded,
    manualActionsCount: run.manualActionsCount,
    lastError: run.lastError,
    canStart: run.status === 'idle' || run.status === 'stopped',
    canStop: run.status === 'running' || run.status === 'paused',
  };
}

export function getRunStatusLabel(status: RunStatus): string {
  switch (status) {
    case 'idle':
      return 'Готов';
    case 'running':
      return 'Выполняется';
    case 'paused':
      return 'Приостановлен';
    case 'stopped':
      return 'Остановлен';
    case 'error':
      return 'Ошибка';
    default:
      return 'Неизвестно';
  }
}

export function getRunStageLabel(stage: RunStage): string {
  switch (stage) {
    case 'idle':
      return 'Ожидание';
    case 'session_check':
      return 'Проверка сессии';
    case 'resume_check':
      return 'Проверка резюме';
    case 'acquisition':
      return 'Поиск вакансий';
    case 'selection':
      return 'Выбор вакансии';
    case 'apply':
      return 'Отклик';
    case 'waiting':
      return 'Ожидание';
    case 'manual_action':
      return 'Требуется действие';
    case 'done':
      return 'Завершено';
    case 'error':
      return 'Ошибка';
    default:
      return 'Неизвестно';
  }
}

export function getActiveProfile(state: AppState): Profile | null {
  if (!state.activeProfileId) {
    return null;
  }
  return state.profiles[state.activeProfileId] || null;
}

export function getProfilesList(state: AppState): Profile[] {
  return state.profileOrder
    .map((id) => state.profiles[id])
    .filter((p): p is Profile => p !== undefined);
}

export function hasProfileFilters(profile: Profile): boolean {
  return (
    profile.keywordsInclude.length > 0 ||
    profile.keywordsExclude.length > 0 ||
    profile.experience.length > 0 ||
    profile.schedule.length > 0 ||
    profile.employment.length > 0 ||
    (profile.regions && profile.regions.length > 0) ||
    profile.salary !== undefined
  );
}

export interface ProfileSummary {
  name: string;
  hasFilters: boolean;
  keywordsCount: number;
  experienceCount: number;
  scheduleCount: number;
  employmentCount: number;
  regionsCount: number;
  hasSalary: boolean;
  hasCoverLetter: boolean;
}

export function formatProfileSummary(profile: Profile): ProfileSummary {
  return {
    name: profile.name,
    hasFilters: hasProfileFilters(profile),
    keywordsCount: profile.keywordsInclude.length,
    experienceCount: profile.experience.length,
    scheduleCount: profile.schedule.length,
    employmentCount: profile.employment.length,
    regionsCount: profile.regions?.length || 0,
    hasSalary: profile.salary !== undefined && profile.salary.amount !== undefined,
    hasCoverLetter: !!profile.coverLetterTemplate,
  };
}

export function getActiveProfileSummary(state: AppState): ProfileSummary | null {
  const profile = getActiveProfile(state);
  if (!profile) {
    return null;
  }
  return formatProfileSummary(profile);
}

// Resume selectors - single source of truth

import { ResumeCandidate } from './types';

export function getResumeCandidates(state: AppState): ResumeCandidate[] {
  return state.resumeCandidates;
}

export function getSelectedResume(state: AppState): ResumeCandidate | null {
  if (!state.selectedResumeHash) {
    return null;
  }
  return (
    state.resumeCandidates.find((r) => r.hash === state.selectedResumeHash) || null
  );
}

export function getActiveProfileBoundResume(state: AppState): ResumeCandidate | null {
  const profile = getActiveProfile(state);
  if (!profile || !profile.selectedResumeHash) {
    return null;
  }
  return (
    state.resumeCandidates.find((r) => r.hash === profile.selectedResumeHash) || null
  );
}

export function isSelectedResumeAvailable(state: AppState): boolean {
  if (!state.selectedResumeHash) {
    return false;
  }
  return state.resumeCandidates.some((r) => r.hash === state.selectedResumeHash);
}

// Analytics selectors - single source of truth

import { AttemptRecord } from './types';

export interface AnalyticsStats {
  attemptsTotal: number;
  succeeded: number;
  escalated: number;
  failedRetryable: number;
  failedFinal: number;
  manualActionRequired: number;
  skippedDuplicate: number;
  successRate: number;
}

function computeStats(attempts: AttemptRecord[]): AnalyticsStats {
  const total = attempts.length;
  const succeeded = attempts.filter((a) => a.outcome === 'SUCCEEDED').length;
  const escalated = attempts.filter((a) => a.outcome === 'ESCALATED').length;
  const failedRetryable = attempts.filter((a) => a.outcome === 'FAILED_RETRYABLE').length;
  const failedFinal = attempts.filter((a) => a.outcome === 'FAILED_FINAL').length;
  const manualActionRequired = attempts.filter(
    (a) => a.outcome === 'MANUAL_ACTION_REQUIRED'
  ).length;
  const skippedDuplicate = attempts.filter((a) => a.outcome === 'SKIPPED_DUPLICATE').length;

  const successRate = total > 0 ? Math.round((succeeded / total) * 100) : 0;

  return {
    attemptsTotal: total,
    succeeded,
    escalated,
    failedRetryable,
    failedFinal,
    manualActionRequired,
    skippedDuplicate,
    successRate,
  };
}

export function getAllTimeStats(state: AppState): AnalyticsStats {
  return computeStats(state.analytics.attempts);
}

export function getCurrentRunStats(state: AppState): AnalyticsStats {
  if (!state.analytics.runStartedAt) {
    return computeStats([]);
  }

  const runAttempts = state.analytics.attempts.filter(
    (a) => a.createdAt >= state.analytics.runStartedAt!
  );

  return computeStats(runAttempts);
}

export function getTodayStats(state: AppState): AnalyticsStats {
  const now = Date.now();
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);

  const todayAttempts = state.analytics.attempts.filter((a) => a.createdAt >= startOfDay);

  return computeStats(todayAttempts);
}

export interface AnalyticsSummary {
  allTime: AnalyticsStats;
  currentRun: AnalyticsStats;
  today: AnalyticsStats;
  isRunActive: boolean;
}

export function getAnalyticsSummary(state: AppState): AnalyticsSummary {
  return {
    allTime: getAllTimeStats(state),
    currentRun: getCurrentRunStats(state),
    today: getTodayStats(state),
    isRunActive: state.analytics.runStartedAt !== null && state.analytics.runStoppedAt === null,
  };
}

export function getRecentAttempts(state: AppState, limit: number = 10): AttemptRecord[] {
  return [...state.analytics.attempts]
    .sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt))
    .slice(0, limit);
}

// Vacancy scan selectors

import { VacancyScanState } from './types';

export function getVacancyScanState(state: AppState): VacancyScanState {
  return state.vacancyScan;
}

export function isVacancyExhausted(state: AppState): boolean {
  return state.vacancyScan.exhausted;
}

export function getExhaustionReason(state: AppState): string | null {
  if (!state.vacancyScan.exhausted || !state.vacancyScan.exhaustedReason) {
    return null;
  }

  const reasons: Record<string, string> = {
    consecutive_empty_scans: `${state.vacancyScan.consecutiveEmptyScans} сканирований без новых вакансий`,
    no_unseen_vacancies: 'Все вакансии уже просмотрены',
    manual_mark: 'Отмечено вручную',
  };

  return reasons[state.vacancyScan.exhaustedReason] || state.vacancyScan.exhaustedReason;
}

// Live mode selectors

import { LiveModeState, HHPageType } from './types';

export function getLiveModeState(state: AppState): LiveModeState {
  return state.liveMode;
}

export function isLiveModeActive(state: AppState): boolean {
  return state.liveMode.active;
}

export function hasControlledTab(state: AppState): boolean {
  return state.liveMode.controlledTabId !== null;
}

export function getControlledTabId(state: AppState): number | null {
  return state.liveMode.controlledTabId;
}

export function getCurrentPageType(state: AppState): HHPageType {
  return state.liveMode.pageType;
}

export function getPageTypeLabel(pageType: HHPageType): string {
  const labels: Record<string, string> = {
    search: 'Поиск вакансий',
    vacancy: 'Страница вакансии',
    resume: 'Резюме',
    applicant: 'Личный кабинет',
    login: 'Вход',
    unknown: 'Неизвестная страница',
  };

  return pageType ? labels[pageType] || pageType : 'Не определено';
}

export function getSearchSyncStatus(state: AppState): import('./types').SearchSyncStatus {
  return state.liveMode.searchSyncStatus;
}

export function getSearchSyncStatusLabel(
  status: import('./types').SearchSyncStatus
): string {
  const labels: Record<string, string> = {
    idle: 'Не применено',
    navigating: 'Применяется...',
    synced: 'Синхронизировано',
    out_of_sync: 'Не синхронизировано',
    error: 'Ошибка',
  };

  return labels[status] || status;
}

export function getTargetSearchUrl(state: AppState): string | null {
  return state.liveMode.targetSearchUrl;
}

export function getLastAppliedProfileId(state: AppState): string | null {
  return state.liveMode.lastAppliedProfileId;
}

export function getSearchLoopState(state: AppState) {
  return {
    active: state.liveMode.searchLoopActive,
    currentPage: state.liveMode.currentSearchPage,
    lastScannedPage: state.liveMode.lastScannedPage,
    totalPages: state.liveMode.totalPagesDetected,
    lastScanVacancyCount: state.liveMode.lastScanVacancyCount,
    iterations: state.liveMode.searchLoopIterations,
  };
}

// Session and runtime blocker selectors

export function getSessionStatus(state: AppState): import('./types').SessionStatus {
  return state.sessionStatus;
}

export function getRuntimeBlocker(state: AppState): import('./types').RuntimeBlocker {
  return state.runtimeBlocker;
}

export function getLastRuntimeError(state: AppState): string | null {
  return state.lastRuntimeError;
}

export function isRuntimeBlocked(state: AppState): boolean {
  return state.runtimeBlocker !== null;
}

export function getPrimaryRuntimeStatusViewModel(state: AppState) {
  // Backend mode uses state.runtime, not state.currentRun
  const runtime = state.runtime;

  return {
    runtimeState: state.runtimeState,
    phase: runtime.currentPhase,
    phaseLabel: getRunStageLabel(runtime.currentPhase as RunStage),
    processed: runtime.processed,
    success: runtime.success,
    manualActions: runtime.manualActions,
    pausedReason: runtime.pausedReason,
    status: state.runtimeState,
    statusLabel: getRunStatusLabel(state.runtimeState as RunStatus),
    isRunning: state.runtimeState === 'RUNNING',
    canStart: ['IDLE', 'STOPPED'].includes(state.runtimeState),
    canStop: ['STARTING', 'RUNNING', 'PAUSED_MANUAL_ACTION', 'PAUSED_NO_VACANCIES', 'PAUSED_BY_USER'].includes(state.runtimeState),
  };
}

export function getUserFacingManualActions(state: AppState) {
  return state.manualActions
    .filter((action) => action.status === 'pending')
    .map((action) => ({
      id: action.id,
      type: action.type,
      title: action.vacancyTitle || 'Без названия',
      company: action.company || 'Не указана',
      url: action.url || '',
      reasonCode: action.reasonCode,
      createdAt: action.createdAt,
    }));
}

export function getPrimaryResumeViewModel(state: AppState) {
  return {
    candidates: getResumeCandidates(state).filter((r) => r.source !== 'demo'),
    selectedResume: getSelectedResume(state),
    selectedResumeHash: state.selectedResumeHash,
  };
}

export function getPrimaryProfileViewModel(state: AppState) {
  return {
    profiles: getProfilesList(state),
    activeProfile: getActiveProfile(state),
    activeProfileId: state.activeProfileId,
  };
}

export function getPrimaryControlsState(state: AppState) {
  const canStart = ['IDLE', 'STOPPED'].includes(state.runtimeState);
  const canStop = ['STARTING', 'RUNNING', 'PAUSED_MANUAL_ACTION', 'PAUSED_NO_VACANCIES', 'PAUSED_BY_USER'].includes(
    state.runtimeState
  );

  return {
    canStart,
    canStop,
    isRunning: state.runtimeState === 'RUNNING' || state.runtimeState === 'STARTING',
    settings: state.settings,
  };
}
