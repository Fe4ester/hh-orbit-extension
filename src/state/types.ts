// Core state types

export type RunStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'error';

export type RunStage =
  | 'idle'
  | 'session_check'
  | 'resume_check'
  | 'acquisition'
  | 'selection'
  | 'apply'
  | 'waiting'
  | 'manual_action'
  | 'done'
  | 'error';

export interface AutoApplyRun {
  id: string;
  status: RunStatus;
  currentStage: RunStage;
  startedAt: number;
  stoppedAt: number | null;
  processed: number;
  succeeded: number;
  manualActionsCount: number;
  lastError: string | null;
  currentAttemptId: string | null;
  profileId: string | null;
}

export type RuntimeState =
  | 'IDLE'
  | 'STARTING'
  | 'RUNNING'
  | 'PAUSED_BY_USER'
  | 'PAUSED_MANUAL_ACTION'
  | 'PAUSED_NO_VACANCIES'
  | 'STOPPING'
  | 'STOPPED'
  | 'ERROR';

export type RuntimeEvent =
  | 'START_REQUESTED'
  | 'START_CONFIRMED'
  | 'STOP_REQUESTED'
  | 'STOP_CONFIRMED'
  | 'PAUSE_BY_USER'
  | 'RESUME_REQUESTED'
  | 'MANUAL_ACTION_REQUIRED'
  | 'NO_MORE_VACANCIES'
  | 'FAILURE'
  | 'RESET';

export type NotificationLevel = 'info' | 'success' | 'warn' | 'error';

export type NotificationKind =
  | 'runtime_started'
  | 'runtime_stopped'
  | 'profile_changed'
  | 'resume_not_selected'
  | 'manual_action_required'
  | 'no_more_vacancies'
  | 'session_warning'
  | 'backend_helper_unavailable'
  | 'generic';

export interface Notification {
  id: string;
  level: NotificationLevel;
  message: string;
  sticky: boolean;
  createdAt: number;
  expiresAt?: number;
  kind?: NotificationKind;
  dedupeKey?: string;
}

export interface ResumeCandidate {
  hash: string;
  title: string;
  url?: string;
  isActive?: boolean;
  lastSeenAt?: number;
  source?: 'hh_detected' | 'demo';
}

export interface Profile {
  id: string;
  name: string;
  keywordsInclude: string[];
  keywordsExclude: string[];
  experience: string; // Изменено: теперь одно значение вместо массива
  schedule: string[];
  employment: string[];
  work_format?: string; // Новое: формат работы (REMOTE, ON_SITE, HYBRID, FIELD_WORK)
  salary_frequency?: string; // Новое: частота выплат (MONTHLY, ANNUAL, HOURLY, DAILY)
  regions?: string[];
  coverLetterTemplate?: string;
  selectedResumeHash?: string | null;
  createdAt: number;
  updatedAt: number;
}

export type AttemptOutcome =
  | 'SUCCEEDED'
  | 'ESCALATED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL'
  | 'SKIPPED_DUPLICATE'
  | 'MANUAL_ACTION_REQUIRED';

export interface AttemptRecord {
  id: string;
  profileId?: string;
  vacancyId?: string;
  outcome: AttemptOutcome;
  createdAt: number;
  finishedAt?: number;
  source: 'local' | 'imported';
}

export interface AnalyticsEvent {
  id: string;
  type: string;
  attemptId?: string;
  profileId?: string;
  timestamp: number;
  payload?: Record<string, any>;
}

export interface AnalyticsState {
  attempts: AttemptRecord[];
  events: AnalyticsEvent[];
  runStartedAt: number | null;
  runStoppedAt: number | null;
}

export type VacancyExhaustionReason =
  | 'consecutive_empty_scans'
  | 'no_unseen_vacancies'
  | 'manual_mark';

export interface VacancyScanState {
  consecutiveEmptyScans: number;
  lastScanAt: number | null;
  lastNewVacancyAt: number | null;
  exhausted: boolean;
  exhaustedReason?: VacancyExhaustionReason;
}

export type HHPageType =
  | 'search'
  | 'vacancy'
  | 'resume'
  | 'applicant_resumes'
  | 'applicant'
  | 'login'
  | 'unknown'
  | null;

export type SearchSyncStatus =
  | 'idle'
  | 'navigating'
  | 'synced'
  | 'out_of_sync'
  | 'error';

export type ControlledTabPurpose =
  | 'resume_detection'
  | 'search'
  | 'vacancy'
  | 'generic_hh'
  | null;

export interface LiveModeState {
  active: boolean;
  controlledTabId: number | null;
  controlledWindowId: number | null;
  controlledTabPurpose: ControlledTabPurpose;
  currentUrl: string | null;
  pageType: HHPageType;
  detectedVacancyId: string | null;
  detectedResumeHash: string | null;
  lastHeartbeatAt: number | null;
  targetSearchUrl: string | null;
  lastAppliedSearchUrl: string | null;
  lastAppliedProfileId: string | null;
  searchSyncStatus: SearchSyncStatus;
  vacancyDetailObservation: import('../live/vacancyDetailParser').VacancyDetailObservation | null;
  preflightClassification: import('../live/vacancyDetailParser').PreflightClassification | null;
  searchSyncDiff?: {
    synced: boolean;
    mismatches: { field: string; expected: any; actual: any }[];
  } | null;
  searchLoopActive: boolean;
  runtimeSearchTabId: number | null; // Runtime-owned search tab (separate from user-bound tab)
  currentSearchPage: number | null;
  lastScannedPage: number | null;
  totalPagesDetected: number | null;
  lastScanVacancyCount: number;
  searchLoopIterations: number;
}

export type VacancyQueueStatus = 'discovered' | 'queued' | 'skipped' | 'processed';

export interface VacancyQueueItem {
  vacancyId: string | null;
  url: string;
  title: string;
  company?: string;
  source: 'search_dom';
  discoveredAt: number;
  profileId: string | null;
  status: VacancyQueueStatus;
  cardIndex?: number;
}

export interface SkipListEntry {
  vacancyId: string;
  addedAt: number;
  expiresAt: number;
  reason: 'questionnaire' | 'test' | 'manual_action';
}

export interface LocalApplyAttempt {
  id: string;
  vacancyId: string | null;
  profileId?: string | null;
  resumeHash?: string | null;
  outcome: string;
  message: string;
  createdAt: number;
  metadata?: Record<string, any>;
}

export type ManualActionType =
  | 'questionnaire'
  | 'test'
  | 'cover_letter_missing'
  | 'login_required'
  | 'captcha'
  | 'manual_review';

export type ManualActionStatus = 'pending' | 'done' | 'dismissed';

export interface ManualAction {
  id: string;
  type: ManualActionType;
  vacancyId: string | null;
  vacancyTitle?: string;
  company?: string;
  url?: string;
  profileId?: string | null;
  createdAt: number;
  status: ManualActionStatus;
  reasonCode: string;
  details?: Record<string, any>;
}

export type SessionStatus = 'unknown' | 'ok' | 'login_required' | 'captcha_required' | 'degraded';
export type RuntimeBlocker = 'login_required' | 'captcha_required' | 'controlled_tab_lost' | 'session_unknown' | null;
export type AutoApplyMode = 'backend' | 'live';

export interface AppState {
  schemaVersion: number;
  mode: AutoApplyMode;
  runtimeState: RuntimeState;
  currentRun: AutoApplyRun | null;
  activeProfileId: string | null;
  selectedResumeHash: string | null;
  resumeCandidates: ResumeCandidate[];
  profiles: Record<string, Profile>;
  profileOrder: string[];
  notifications: Notification[];
  settings: {
    delayMinSeconds: number;
    delayMaxSeconds: number;
    maxAutoAppliesPerRun: number;
    maxAutoAppliesPerDay: number;
    stopOnManualAction: boolean;
    autoSendCoverLetterWhenRequired: boolean;
  };
  runtime: {
    currentPhase:
      | 'idle'
      | 'session_check'
      | 'resume_check'
      | 'search'
      | 'vacancy_analysis'
      | 'apply'
      | 'waiting'
      | 'paused_manual_action'
      | 'paused_auth'
      | 'paused_no_vacancies';
    processed: number;
    success: number;
    manualActions: number;
    pausedReason: string | null;
    lastEventAt: number | null;
  };
  analytics: AnalyticsState;
  vacancyScan: VacancyScanState;
  liveMode: LiveModeState;
  vacancyQueue: VacancyQueueItem[];
  applyAttempts: LocalApplyAttempt[];
  manualActions: ManualAction[];
  skipList: SkipListEntry[];
  sessionStatus: SessionStatus;
  runtimeBlocker: RuntimeBlocker;
  lastRuntimeError: string | null;
}

export const INITIAL_STATE: AppState = (() => {
  return {
    schemaVersion: 1,
    mode: 'backend',
    runtimeState: 'IDLE',
    currentRun: null,
    activeProfileId: null,
    selectedResumeHash: null,
    resumeCandidates: [],
    profiles: {},
    profileOrder: [],
    notifications: [],
    settings: {
      delayMinSeconds: 30,
      delayMaxSeconds: 90,
      maxAutoAppliesPerRun: 30,
      maxAutoAppliesPerDay: 100,
      stopOnManualAction: true,
      autoSendCoverLetterWhenRequired: true,
    },
    runtime: {
      currentPhase: 'idle',
      processed: 0,
      success: 0,
      manualActions: 0,
      pausedReason: null,
      lastEventAt: null,
    },
    analytics: {
      attempts: [],
      events: [],
      runStartedAt: null,
      runStoppedAt: null,
    },
    vacancyScan: {
      consecutiveEmptyScans: 0,
      lastScanAt: null,
      lastNewVacancyAt: null,
      exhausted: false,
    },
    liveMode: {
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
    },
    vacancyQueue: [],
    applyAttempts: [],
    manualActions: [],
    skipList: [],
    sessionStatus: 'unknown',
    runtimeBlocker: null,
    lastRuntimeError: null,
  };
})();
