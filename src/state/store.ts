import type {
  AppState,
  LocalApplyAttempt,
  Profile,
  ResumeCandidate,
  RuntimeEvent,
} from './types';
import type { StorageAdapter } from './storage';
import { RuntimeFSM } from '../runtime/fsm';
import { NotificationManager } from '../notifications/manager';
import { FileLogger } from '../utils/fileLogger';
import {
  createProfile as createProfileHelper,
  createDefaultProfiles,
  updateProfile as updateProfileHelper,
  duplicateProfile as duplicateProfileHelper,
  recordAttemptOutcome,
  recordAnalyticsEvent,
  seedDemoAnalytics,
  recordVacancyScan,
  markNoMoreVacancies,
  resetVacancyExhaustion,
  activateLiveMode,
  deactivateLiveMode,
  bindControlledTab,
  updateLiveContextFromUrl,
  clearControlledTab,
  setLiveModeTargetSearch,
  markSearchNavigating,
  markSearchSynced,
  markSearchOutOfSync,
  markSearchError,
  materializeVacanciesFromSearch as materializeVacanciesHelper,
  clearVacancyQueue as clearVacancyQueueHelper,
  markVacancyQueued as markVacancyQueuedHelper,
  markVacancyProcessed as markVacancyProcessedHelper,
  markVacancySkipped as markVacancySkippedHelper,
  setVacancyDetailObservation,
  setPreflightClassification,
  clearPreflightState,
  recordLocalApplyAttempt as recordLocalApplyAttemptHelper,
  clearApplyAttempts as clearApplyAttemptsHelper,
} from './actions';
import type { CreateProfilePayload, UpdateProfilePayload } from './actions';
import type { ParsedVacancyCard } from '../live/searchResultsParser';
import type {
  VacancyDetailObservation,
  PreflightClassification,
} from '../live/vacancyDetailParser';

export class StateStore {
  private state: AppState | null = null;
  private listeners: Array<(state: AppState) => void> = [];
  private fsm = new RuntimeFSM();
  private notificationManager = new NotificationManager();
  private onStateChange?: () => void;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private storage: StorageAdapter) {}

  setOnStateChange(callback: () => void): void {
    this.onStateChange = callback;
  }

  async init(): Promise<void> {
    let state = await this.storage.get();

    // First init / empty profiles -> seed defaults
    if (!state.profileOrder || state.profileOrder.length === 0) {
      const defaults = createDefaultProfiles();
      const profiles = defaults.reduce<Record<string, Profile>>((acc, profile) => {
        acc[profile.id] = profile;
        return acc;
      }, {});

      state = {
        ...state,
        profiles,
        profileOrder: defaults.map((p) => p.id),
        activeProfileId: defaults[0]?.id || null,
      };
      await this.storage.set(state);
    }

    this.state = state;
    this.notifyListeners();
  }

  getState(): AppState {
    if (!this.state) {
      throw new Error('Store not initialized');
    }
    return { ...this.state };
  }

  async dispatch(event: RuntimeEvent): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      runtimeState: this.fsm.transition(current.runtimeState, event),
    }));
  }

  async reconcileInterruptedRuntime(): Promise<{
    recovered: boolean;
    previousState?: AppState['runtimeState'];
  }> {
    let previousState: AppState['runtimeState'] | undefined;

    await this.changeState((current) => {
      if (!this.fsm.canTransition(current.runtimeState, 'ENGINE_INTERRUPTED')) {
        return current;
      }

      previousState = current.runtimeState;
      return {
        ...current,
        runtimeState: this.fsm.transition(current.runtimeState, 'ENGINE_INTERRUPTED'),
        runtime: {
          ...current.runtime,
          currentPhase: 'idle',
          pausedReason: null,
          lastEventAt: Date.now(),
        },
      };
    });

    if (!previousState) {
      return { recovered: false };
    }

    await FileLogger.log('service_worker', 'warn', 'Interrupted runtime recovered after worker restart', {
      previousState,
      newState: 'STOPPED',
      reason: 'worker_restart',
    });

    return { recovered: true, previousState };
  }

  async updateState(partial: Partial<AppState>): Promise<void> {
    await this.changeState((current) => ({ ...current, ...partial }));
  }

  private changeState(transform: (currentState: AppState) => AppState): Promise<void> {
    if (!this.state) {
      return Promise.reject(new Error('Store not initialized'));
    }

    const operation = this.writeQueue.then(async () => {
      if (!this.state) throw new Error('Store not initialized');
      const nextState = transform(this.state);
      if (nextState === this.state) return;
      await this.storage.set(nextState);
      this.state = nextState;
      this.notifyListeners();
      try {
        this.onStateChange?.();
      } catch (error) {
        this.logCallbackError('onStateChange', error);
      }
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  // Profile actions
  async createProfile(payload: CreateProfilePayload): Promise<string> {
    const profile = createProfileHelper(payload);
    await this.changeState((current) => ({
      ...current,
      profiles: { ...current.profiles, [profile.id]: profile },
      profileOrder: [...current.profileOrder, profile.id],
    }));
    return profile.id;
  }

  async updateProfile(id: string, patch: UpdateProfilePayload): Promise<void> {
    await this.changeState((current) => {
      const profile = current.profiles[id];
      if (!profile) throw new Error(`Profile ${id} not found`);
      return {
        ...current,
        profiles: { ...current.profiles, [id]: updateProfileHelper(profile, patch) },
      };
    });
  }

  async deleteProfile(id: string): Promise<void> {
    await this.changeState((current) => {
      if (!current.profiles[id]) throw new Error(`Profile ${id} not found`);
      const profiles = { ...current.profiles };
      delete profiles[id];
      const profileOrder = current.profileOrder.filter((pid) => pid !== id);
      const activeProfileId = current.activeProfileId === id ? profileOrder[0] || null : current.activeProfileId;
      return { ...current, profiles, profileOrder, activeProfileId };
    });
  }

  async duplicateProfile(id: string): Promise<string> {
    let duplicatedId = '';
    await this.changeState((current) => {
      const profile = current.profiles[id];
      if (!profile) throw new Error(`Profile ${id} not found`);
      const duplicated = duplicateProfileHelper(profile);
      duplicatedId = duplicated.id;
      const profileOrder = [...current.profileOrder];
      profileOrder.splice(profileOrder.indexOf(id) + 1, 0, duplicated.id);
      return {
        ...current,
        profiles: { ...current.profiles, [duplicated.id]: duplicated },
        profileOrder,
      };
    });
    return duplicatedId;
  }

  async setActiveProfile(id: string | null): Promise<void> {
    await this.changeState((current) => {
      if (id !== null && !current.profiles[id]) throw new Error(`Profile ${id} not found`);
      return { ...current, activeProfileId: id };
    });

    // Auto-apply profile's bound resume if it exists
    if (id !== null) {
      await this.applyProfileResumeBinding(id);
    }
  }

  // Resume actions
  async setResumeCandidates(candidates: ResumeCandidate[]): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    // Dedupe by hash
    const seen = new Set<string>();
    const deduped = candidates.filter((c) => {
      if (seen.has(c.hash)) return false;
      seen.add(c.hash);
      return true;
    });

    await this.changeState((current) => ({ ...current, resumeCandidates: deduped }));
  }

  async selectResume(hash: string | null): Promise<void> {
    await this.changeState((current) => {
      if (hash !== null && !current.resumeCandidates.some((r) => r.hash === hash)) {
        throw new Error(`Resume ${hash} not found in candidates`);
      }
      return { ...current, selectedResumeHash: hash };
    });
  }

  async bindResumeToProfile(profileId: string, hash: string | null): Promise<void> {
    await this.changeState((current) => {
      const profile = current.profiles[profileId];
      if (!profile) throw new Error(`Profile ${profileId} not found`);
      if (hash !== null && !current.resumeCandidates.some((r) => r.hash === hash)) {
        throw new Error(`Resume ${hash} not found in candidates`);
      }
      return {
        ...current,
        profiles: { ...current.profiles, [profileId]: updateProfileHelper(profile, { selectedResumeHash: hash }) },
      };
    });
  }

  async applyProfileResumeBinding(profileId: string): Promise<void> {
    await this.changeState((current) => {
      const hash = current.profiles[profileId]?.selectedResumeHash;
      if (!hash || !current.resumeCandidates.some((r) => r.hash === hash)) return current;
      return { ...current, selectedResumeHash: hash };
    });
  }

  // Analytics actions
  async recordAttempt(
    outcome: import('./types').AttemptOutcome,
    profileId?: string,
    vacancyId?: string
  ): Promise<void> {
    const attempt = recordAttemptOutcome(outcome, profileId, vacancyId, 'local');
    await this.changeState((current) => ({
      ...current,
      analytics: { ...current.analytics, attempts: [...current.analytics.attempts, attempt] },
    }));
  }

  async recordEvent(
    type: string,
    payload?: Record<string, any>,
    attemptId?: string,
    profileId?: string
  ): Promise<void> {
    const event = recordAnalyticsEvent(type, payload, attemptId, profileId);
    await this.changeState((current) => ({
      ...current,
      analytics: { ...current.analytics, events: [...current.analytics.events, event] },
    }));
  }

  async markRunStarted(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      analytics: { ...current.analytics, runStartedAt: Date.now(), runStoppedAt: null },
    }));
  }

  async markRunStopped(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      analytics: { ...current.analytics, runStoppedAt: Date.now() },
    }));
  }

  async clearRunStats(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      analytics: { ...current.analytics, runStartedAt: null, runStoppedAt: null },
    }));
  }

  async seedDemoAnalytics(): Promise<void> {
    const { attempts, events } = seedDemoAnalytics();
    await this.changeState((current) => ({
      ...current,
      analytics: {
        ...current.analytics,
        attempts: [...current.analytics.attempts, ...attempts],
        events: [...current.analytics.events, ...events],
        runStartedAt: Date.now() - 30 * 60 * 1000,
        runStoppedAt: null,
      },
    }));
  }

  // Vacancy scan actions
  async recordVacancyScan(foundCount: number, newCount: number): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      vacancyScan: recordVacancyScan(current.vacancyScan, {
        foundCount,
        newCount,
        timestamp: Date.now(),
      }),
    }));

    // If exhausted, trigger FSM transition
    if (this.getState().vacancyScan.exhausted && this.getState().runtimeState === 'RUNNING') {
      await this.dispatch('NO_MORE_VACANCIES');
    }
  }

  async markNoMoreVacancies(
    reason: import('./types').VacancyExhaustionReason
  ): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    await this.changeState((current) => ({ ...current, vacancyScan: markNoMoreVacancies(reason) }));

    // Trigger FSM transition
    if (this.state.runtimeState === 'RUNNING') {
      await this.dispatch('NO_MORE_VACANCIES');
    }
  }

  async resetVacancyExhaustion(): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    await this.changeState((current) => ({ ...current, vacancyScan: resetVacancyExhaustion() }));
  }

  // Live mode actions
  async activateLiveMode(): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    await this.changeState((current) => ({ ...current, liveMode: activateLiveMode() }));
  }

  async deactivateLiveMode(): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    await this.changeState((current) => ({ ...current, liveMode: deactivateLiveMode() }));
  }

  async bindControlledTab(tabId: number, windowId: number, url: string): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    await this.changeState((current) => ({
      ...current,
      liveMode: bindControlledTab({ tabId, windowId, url }),
    }));
  }

  async updateLiveContextFromUrl(url: string): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: updateLiveContextFromUrl(current.liveMode, url),
    }));
  }

  async clearControlledTab(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: clearControlledTab(current.liveMode),
    }));
  }

  async setLiveModeTargetSearch(profileId: string, url: string): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: setLiveModeTargetSearch(current.liveMode, profileId, url),
    }));
  }

  async markSearchNavigating(url: string): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: markSearchNavigating(current.liveMode, url),
    }));
  }

  async markSearchSynced(url: string, profileId: string): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: markSearchSynced(current.liveMode, url, profileId),
    }));
  }

  async setSearchSyncDiff(diff: AppState['liveMode']['searchSyncDiff']): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: { ...current.liveMode, searchSyncDiff: diff },
    }));
  }

  async setLastAppliedSearchUrl(url: string | null): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: { ...current.liveMode, lastAppliedSearchUrl: url },
    }));
  }

  async setControlledTabPurpose(
    purpose: AppState['liveMode']['controlledTabPurpose'],
    activate = false
  ): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: {
        ...current.liveMode,
        active: activate ? true : current.liveMode.active,
        controlledTabPurpose: purpose,
      },
    }));
  }

  async markSearchOutOfSync(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: markSearchOutOfSync(current.liveMode),
    }));
  }

  async markSearchError(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: markSearchError(current.liveMode),
    }));
  }

  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getNotificationManager(): NotificationManager {
    return this.notificationManager;
  }

  // Vacancy queue methods

  async materializeVacanciesFromSearch(
    cards: ParsedVacancyCard[],
    profileId: string | null
  ): Promise<void> {
    await this.cleanSkipList();
    await this.changeState((current) => {
      const processedIds = new Set(current.vacancyQueue
        .filter((vacancy) => vacancy.status === 'processed')
        .map((vacancy) => vacancy.vacancyId)
        .filter(Boolean));
      const now = Date.now();
      const filteredCards = cards.filter((card) => {
        if (!card.vacancyId) return true;
        if (current.skipList.some((entry) => entry.vacancyId === card.vacancyId && entry.expiresAt > now)) {
          FileLogger.log('service_worker', 'info', 'Skipping vacancy (in skip list)', { vacancyId: card.vacancyId });
          return false;
        }
        if (processedIds.has(card.vacancyId)) {
          FileLogger.log('service_worker', 'info', 'Skipping vacancy (already processed)', { vacancyId: card.vacancyId });
          return false;
        }
        return true;
      });
      const profile = profileId ? current.profiles[profileId] : undefined;
      return {
        ...current,
        vacancyQueue: materializeVacanciesHelper(current.vacancyQueue, filteredCards, profileId, profile),
      };
    });
  }

  async clearVacancyQueue(): Promise<void> {
    await this.changeState((current) => ({ ...current, vacancyQueue: clearVacancyQueueHelper() }));
  }

  async removeProcessedVacancies(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      vacancyQueue: current.vacancyQueue.filter((vacancy) => vacancy.status !== 'processed'),
    }));
  }

  async markVacancyQueued(vacancyId: string): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      vacancyQueue: markVacancyQueuedHelper(current.vacancyQueue, vacancyId),
    }));
  }

  async markVacancyProcessed(vacancyId: string): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      vacancyQueue: markVacancyProcessedHelper(current.vacancyQueue, vacancyId),
    }));
  }

  async markVacancySkipped(vacancyId: string): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      vacancyQueue: markVacancySkippedHelper(current.vacancyQueue, vacancyId),
    }));
  }

  // Vacancy detail preflight methods

  async setVacancyDetailObservation(observation: VacancyDetailObservation): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: setVacancyDetailObservation(current.liveMode, observation),
    }));
  }

  async setPreflightClassification(classification: PreflightClassification): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: setPreflightClassification(current.liveMode, classification),
    }));
  }

  async clearPreflightState(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: clearPreflightState(current.liveMode),
    }));
  }

  // Apply attempt methods

  async recordLocalApplyAttempt(
    attempt: Omit<LocalApplyAttempt, 'id' | 'createdAt'>
  ): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      applyAttempts: recordLocalApplyAttemptHelper(current.applyAttempts, attempt),
    }));
  }

  async clearApplyAttempts(): Promise<void> {
    await this.changeState((current) => ({ ...current, applyAttempts: clearApplyAttemptsHelper() }));
  }

  // Manual actions
  async createManualAction(action: Omit<import('./types').ManualAction, 'id' | 'createdAt'>): Promise<void> {
    const creation: { action?: import('./types').ManualAction } = {};
    await this.changeState((current) => {
      const alreadyPending = current.manualActions.some(
        (existing) => existing.status === 'pending' &&
          existing.vacancyId === action.vacancyId &&
          existing.reasonCode === action.reasonCode
      );
      if (alreadyPending) {
        FileLogger.log('service_worker', 'debug', 'Manual action already pending', {
          vacancyId: action.vacancyId,
          reasonCode: action.reasonCode,
        });
        return current;
      }
      const newAction: import('./types').ManualAction = {
        ...action,
        id: `ma_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        createdAt: Date.now(),
      };
      creation.action = newAction;
      return { ...current, manualActions: [...current.manualActions, newAction] };
    });
    if (creation.action) {
      FileLogger.log('service_worker', 'warn', 'Manual action created', {
        id: creation.action.id,
        type: creation.action.type,
        vacancyId: creation.action.vacancyId,
        profileId: creation.action.profileId,
        reasonCode: creation.action.reasonCode,
        status: creation.action.status,
      });
    }
  }

  async markManualActionDone(id: string): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      manualActions: current.manualActions.map((action) =>
        action.id === id ? { ...action, status: 'done' as const } : action),
    }));
  }

  async dismissManualAction(id: string): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      manualActions: current.manualActions.map((action) =>
        action.id === id ? { ...action, status: 'dismissed' as const } : action),
    }));
  }

  // Skip list
  async addToSkipList(vacancyId: string, ttlMs: number, reason: 'questionnaire' | 'test' | 'manual_action' = 'questionnaire'): Promise<void> {
    let added = false;
    await this.changeState((current) => {
      const now = Date.now();
      const validEntries = current.skipList.filter((entry) => entry.expiresAt > now);
      if (validEntries.some((entry) => entry.vacancyId === vacancyId)) {
        FileLogger.log('service_worker', 'debug', 'Vacancy already in skip list', { vacancyId });
        return current;
      }
      const newEntry: import('./types').SkipListEntry = {
        vacancyId, addedAt: now, expiresAt: now + ttlMs, reason,
      };
      added = true;
      return { ...current, skipList: [...validEntries, newEntry] };
    });
    if (added) FileLogger.log('service_worker', 'info', 'Added to skip list', {
      vacancyId,
      ttlHours: Math.round(ttlMs / 1000 / 60 / 60),
      reason,
    });
  }

  isInSkipList(vacancyId: string): boolean {
    if (!this.state) return false;
    const now = Date.now();
    const entry = this.state.skipList.find(e => e.vacancyId === vacancyId && e.expiresAt > now);
    return !!entry;
  }

  async cleanSkipList(): Promise<void> {
    let removed = 0;
    let remaining = 0;
    await this.changeState((current) => {
      const now = Date.now();
      const validEntries = current.skipList.filter((entry) => entry.expiresAt > now);
      removed = current.skipList.length - validEntries.length;
      remaining = validEntries.length;
      return removed > 0 ? { ...current, skipList: validEntries } : current;
    });
    if (removed > 0) FileLogger.log('service_worker', 'info', 'Cleaned skip list', { removed, remaining });
  }

  async updateSettings(
    patch: Partial<AppState['settings']>
  ): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));
  }

  async setRuntimePhase(
    phase: AppState['runtime']['currentPhase'],
    pausedReason?: string | null
  ): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        currentPhase: phase,
        pausedReason: pausedReason === undefined ? current.runtime.pausedReason : pausedReason,
        lastEventAt: Date.now(),
      },
    }));
  }

  async incrementRuntimeCounters(
    patch: Partial<Pick<AppState['runtime'], 'processed' | 'success' | 'manualActions'>>
  ): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        processed: current.runtime.processed + (patch.processed || 0),
        success: current.runtime.success + (patch.success || 0),
        manualActions: current.runtime.manualActions + (patch.manualActions || 0),
        lastEventAt: Date.now(),
      },
    }));
  }

  async resetRuntimeCounters(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        currentPhase: 'idle',
        processed: 0,
        success: 0,
        manualActions: 0,
        pausedReason: null,
        lastEventAt: Date.now(),
        currentSearchPage: 0,
        consecutiveEmptyPages: 0,
      },
    }));
  }

  async advanceSearchPage(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        currentSearchPage: current.runtime.currentSearchPage + 1,
      },
    }));
  }

  async resetSearchPagination(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        currentSearchPage: 0,
        consecutiveEmptyPages: 0,
      },
    }));
  }

  async recordEmptyPage(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        consecutiveEmptyPages: current.runtime.consecutiveEmptyPages + 1,
      },
    }));
  }

  async resetEmptyPageCounter(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        consecutiveEmptyPages: 0,
      },
    }));
  }

  // Search loop methods
  async startSearchLoop(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: {
        ...current.liveMode,
        searchLoopActive: true,
        searchLoopIterations: 0,
      },
    }));
  }

  async stopSearchLoop(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: {
        ...current.liveMode,
        searchLoopActive: false,
      },
    }));
  }

  async updateSearchLoopPage(
    page: number,
    totalPages: number | null,
    foundCount: number
  ): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: {
        ...current.liveMode,
        currentSearchPage: page,
        lastScannedPage: page,
        totalPagesDetected: totalPages,
        lastScanVacancyCount: foundCount,
      },
    }));
  }

  async incrementSearchLoopIteration(): Promise<void> {
    await this.changeState((current) => ({
      ...current,
      liveMode: {
        ...current.liveMode,
        searchLoopIterations: current.liveMode.searchLoopIterations + 1,
      },
    }));
  }

  // Session and runtime blocker methods
  async setSessionStatus(status: import('./types').SessionStatus): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    await this.updateState({ sessionStatus: status });

    FileLogger.log('service_worker', 'info', 'Session status updated', { status });
  }

  async setRuntimeBlocker(
    blocker: import('./types').RuntimeBlocker,
    reason?: string
  ): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    await this.updateState({
      runtimeBlocker: blocker,
      lastRuntimeError: reason || null,
    });

    FileLogger.log('service_worker', 'warn', 'Runtime blocker set', {
      blocker,
      reason: reason || null,
    });
  }

  async clearRuntimeBlocker(): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    await this.updateState({
      runtimeBlocker: null,
      lastRuntimeError: null,
    });

    FileLogger.log('service_worker', 'info', 'Runtime blocker cleared');
  }

  canDispatch(event: RuntimeEvent): boolean {
    if (!this.state) {
      return false;
    }
    return this.fsm.canTransition(this.state.runtimeState, event);
  }

  private notifyListeners(): void {
    if (!this.state) return;
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (error) {
        this.logCallbackError('listener', error);
      }
    });
  }

  private logCallbackError(callback: string, error: unknown): void {
    void FileLogger.log('service_worker', 'error', `StateStore ${callback} callback failed`, {
      error: error instanceof Error ? error.message : String(error),
    }).catch((logError: unknown) => {
      console.error('[StateStore] Failed to log callback error', logError);
    });
  }
}
