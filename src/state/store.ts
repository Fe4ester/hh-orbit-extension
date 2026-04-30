// Central state store

import { AppState, RuntimeEvent, ResumeCandidate } from './types';
import { StorageAdapter } from './storage';
import { RuntimeFSM } from '../runtime/fsm';
import { NotificationManager } from '../notifications/manager';
import { FileLogger } from '../utils/fileLogger';
import {
  createProfile as createProfileHelper,
  createDefaultProfiles,
  updateProfile as updateProfileHelper,
  duplicateProfile as duplicateProfileHelper,
  CreateProfilePayload,
  UpdateProfilePayload,
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
import { ParsedVacancyCard } from '../live/searchResultsParser';
import {
  VacancyDetailObservation,
  PreflightClassification,
} from '../live/vacancyDetailParser';
import { LocalApplyAttempt } from './types';

export class StateStore {
  private state: AppState | null = null;
  private listeners: Array<(state: AppState) => void> = [];
  private fsm = new RuntimeFSM();
  private notificationManager = new NotificationManager();
  private onStateChange?: () => void;

  constructor(private storage: StorageAdapter) {}

  setOnStateChange(callback: () => void): void {
    this.onStateChange = callback;
  }

  async init(): Promise<void> {
    this.state = await this.storage.get();

    // First init / empty profiles -> seed defaults
    if (!this.state.profileOrder || this.state.profileOrder.length === 0) {
      const defaults = createDefaultProfiles();
      const profiles = defaults.reduce<Record<string, import('./types').Profile>>((acc, profile) => {
        acc[profile.id] = profile;
        return acc;
      }, {});

      this.state = {
        ...this.state,
        profiles,
        profileOrder: defaults.map((p) => p.id),
        activeProfileId: defaults[0]?.id || null,
      };
      await this.storage.set(this.state);
    }

    this.notifyListeners();
  }

  getState(): AppState {
    if (!this.state) {
      throw new Error('Store not initialized');
    }
    return { ...this.state };
  }

  async dispatch(event: RuntimeEvent): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const newRuntimeState = this.fsm.transition(this.state.runtimeState, event);
    await this.updateState({ runtimeState: newRuntimeState });
  }

  async updateState(partial: Partial<AppState>): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    this.state = { ...this.state, ...partial };
    await this.storage.set(this.state);
    this.notifyListeners();

    // Broadcast to UI
    if (this.onStateChange) {
      this.onStateChange();
    }
  }

  // Profile actions
  async createProfile(payload: CreateProfilePayload): Promise<string> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const profile = createProfileHelper(payload);
    const profiles = { ...this.state.profiles, [profile.id]: profile };
    const profileOrder = [...this.state.profileOrder, profile.id];

    await this.updateState({ profiles, profileOrder });
    return profile.id;
  }

  async updateProfile(id: string, patch: UpdateProfilePayload): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const profile = this.state.profiles[id];
    if (!profile) {
      throw new Error(`Profile ${id} not found`);
    }

    const updatedProfile = updateProfileHelper(profile, patch);
    const profiles = { ...this.state.profiles, [id]: updatedProfile };

    await this.updateState({ profiles });
  }

  async deleteProfile(id: string): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    if (!this.state.profiles[id]) {
      throw new Error(`Profile ${id} not found`);
    }

    const profiles = { ...this.state.profiles };
    delete profiles[id];

    const profileOrder = this.state.profileOrder.filter((pid) => pid !== id);

    let activeProfileId = this.state.activeProfileId;

    // If deleted profile was active, select next available
    if (activeProfileId === id) {
      activeProfileId = profileOrder.length > 0 ? profileOrder[0] : null;
    }

    await this.updateState({ profiles, profileOrder, activeProfileId });
  }

  async duplicateProfile(id: string): Promise<string> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const profile = this.state.profiles[id];
    if (!profile) {
      throw new Error(`Profile ${id} not found`);
    }

    const duplicated = duplicateProfileHelper(profile);
    const profiles = { ...this.state.profiles, [duplicated.id]: duplicated };

    // Insert after original
    const originalIndex = this.state.profileOrder.indexOf(id);
    const profileOrder = [...this.state.profileOrder];
    profileOrder.splice(originalIndex + 1, 0, duplicated.id);

    await this.updateState({ profiles, profileOrder });
    return duplicated.id;
  }

  async setActiveProfile(id: string | null): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    if (id !== null && !this.state.profiles[id]) {
      throw new Error(`Profile ${id} not found`);
    }

    await this.updateState({ activeProfileId: id });

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

    await this.updateState({ resumeCandidates: deduped });
  }

  async selectResume(hash: string | null): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    if (hash !== null) {
      const exists = this.state.resumeCandidates.some((r) => r.hash === hash);
      if (!exists) {
        throw new Error(`Resume ${hash} not found in candidates`);
      }
    }

    await this.updateState({ selectedResumeHash: hash });
  }

  async bindResumeToProfile(profileId: string, hash: string | null): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const profile = this.state.profiles[profileId];
    if (!profile) {
      throw new Error(`Profile ${profileId} not found`);
    }

    if (hash !== null) {
      const exists = this.state.resumeCandidates.some((r) => r.hash === hash);
      if (!exists) {
        throw new Error(`Resume ${hash} not found in candidates`);
      }
    }

    const updatedProfile = updateProfileHelper(profile, { selectedResumeHash: hash });
    const profiles = { ...this.state.profiles, [profileId]: updatedProfile };

    await this.updateState({ profiles });
  }

  async applyProfileResumeBinding(profileId: string): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const profile = this.state.profiles[profileId];
    if (!profile || !profile.selectedResumeHash) {
      return;
    }

    // Only apply if candidate exists
    const exists = this.state.resumeCandidates.some(
      (r) => r.hash === profile.selectedResumeHash
    );

    if (exists) {
      await this.updateState({ selectedResumeHash: profile.selectedResumeHash });
    }
  }

  // Analytics actions
  async recordAttempt(
    outcome: import('./types').AttemptOutcome,
    profileId?: string,
    vacancyId?: string
  ): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const attempt = recordAttemptOutcome(outcome, profileId, vacancyId, 'local');

    const analytics = {
      ...this.state.analytics,
      attempts: [...this.state.analytics.attempts, attempt],
    };

    await this.updateState({ analytics });
  }

  async recordEvent(
    type: string,
    payload?: Record<string, any>,
    attemptId?: string,
    profileId?: string
  ): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const event = recordAnalyticsEvent(type, payload, attemptId, profileId);

    const analytics = {
      ...this.state.analytics,
      events: [...this.state.analytics.events, event],
    };

    await this.updateState({ analytics });
  }

  async markRunStarted(): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const analytics = {
      ...this.state.analytics,
      runStartedAt: Date.now(),
      runStoppedAt: null,
    };

    await this.updateState({ analytics });
  }

  async markRunStopped(): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const analytics = {
      ...this.state.analytics,
      runStoppedAt: Date.now(),
    };

    await this.updateState({ analytics });
  }

  async clearRunStats(): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const analytics = {
      ...this.state.analytics,
      runStartedAt: null,
      runStoppedAt: null,
    };

    await this.updateState({ analytics });
  }

  async seedDemoAnalytics(): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const { attempts, events } = seedDemoAnalytics();

    const analytics = {
      ...this.state.analytics,
      attempts: [...this.state.analytics.attempts, ...attempts],
      events: [...this.state.analytics.events, ...events],
      runStartedAt: Date.now() - 30 * 60 * 1000, // 30 min ago
      runStoppedAt: null,
    };

    await this.updateState({ analytics });
  }

  // Vacancy scan actions
  async recordVacancyScan(foundCount: number, newCount: number): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const vacancyScan = recordVacancyScan(this.state.vacancyScan, {
      foundCount,
      newCount,
      timestamp: Date.now(),
    });

    await this.updateState({ vacancyScan });

    // If exhausted, trigger FSM transition
    if (vacancyScan.exhausted && this.state.runtimeState === 'RUNNING') {
      await this.dispatch('NO_MORE_VACANCIES');
    }
  }

  async markNoMoreVacancies(
    reason: import('./types').VacancyExhaustionReason
  ): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const vacancyScan = markNoMoreVacancies(reason);

    await this.updateState({ vacancyScan });

    // Trigger FSM transition
    if (this.state.runtimeState === 'RUNNING') {
      await this.dispatch('NO_MORE_VACANCIES');
    }
  }

  async resetVacancyExhaustion(): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const vacancyScan = resetVacancyExhaustion();

    await this.updateState({ vacancyScan });
  }

  // Live mode actions
  async activateLiveMode(): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const liveMode = activateLiveMode();

    await this.updateState({ liveMode });
  }

  async deactivateLiveMode(): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const liveMode = deactivateLiveMode();

    await this.updateState({ liveMode });
  }

  async bindControlledTab(tabId: number, windowId: number, url: string): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const liveMode = bindControlledTab({ tabId, windowId, url });

    await this.updateState({ liveMode });
  }

  async updateLiveContextFromUrl(url: string): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const liveMode = updateLiveContextFromUrl(this.state.liveMode, url);

    await this.updateState({ liveMode });
  }

  async clearControlledTab(): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const liveMode = clearControlledTab(this.state.liveMode);

    await this.updateState({ liveMode });
  }

  async setLiveModeTargetSearch(profileId: string, url: string): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const liveMode = setLiveModeTargetSearch(this.state.liveMode, profileId, url);

    await this.updateState({ liveMode });
  }

  async markSearchNavigating(url: string): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const liveMode = markSearchNavigating(this.state.liveMode, url);

    await this.updateState({ liveMode });
  }

  async markSearchSynced(url: string, profileId: string): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const liveMode = markSearchSynced(this.state.liveMode, url, profileId);

    await this.updateState({ liveMode });
  }

  async markSearchOutOfSync(): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const liveMode = markSearchOutOfSync(this.state.liveMode);

    await this.updateState({ liveMode });
  }

  async markSearchError(): Promise<void> {
    if (!this.state) {
      throw new Error('Store not initialized');
    }

    const liveMode = markSearchError(this.state.liveMode);

    await this.updateState({ liveMode });
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
    if (!this.state) throw new Error('Store not initialized');

    // Clean expired skip list entries first
    await this.cleanSkipList();

    // Get already processed vacancy IDs
    const processedIds = new Set(
      this.state.vacancyQueue
        .filter(v => v.status === 'processed')
        .map(v => v.vacancyId)
        .filter(Boolean)
    );

    // Filter out vacancies in skip list or already processed
    const filteredCards = cards.filter(card => {
      if (!card.vacancyId) return true;

      if (this.isInSkipList(card.vacancyId)) {
        FileLogger.log('service_worker', 'info', 'Skipping vacancy (in skip list)', { vacancyId: card.vacancyId });
        return false;
      }

      if (processedIds.has(card.vacancyId)) {
        FileLogger.log('service_worker', 'info', 'Skipping vacancy (already processed)', { vacancyId: card.vacancyId });
        return false;
      }

      return true;
    });

    // Get profile for keyword prefilter
    const profile = profileId ? this.state.profiles[profileId] : undefined;

    this.state.vacancyQueue = materializeVacanciesHelper(
      this.state.vacancyQueue,
      filteredCards,
      profileId,
      profile
    );

    await this.storage.set(this.state);
    this.notifyListeners();
  }

  async clearVacancyQueue(): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    this.state.vacancyQueue = clearVacancyQueueHelper();

    await this.storage.set(this.state);
    this.notifyListeners();
  }

  async markVacancyQueued(vacancyId: string): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    this.state.vacancyQueue = markVacancyQueuedHelper(
      this.state.vacancyQueue,
      vacancyId
    );

    await this.storage.set(this.state);
    this.notifyListeners();
  }

  async markVacancyProcessed(vacancyId: string): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    this.state.vacancyQueue = markVacancyProcessedHelper(
      this.state.vacancyQueue,
      vacancyId
    );

    await this.storage.set(this.state);
    this.notifyListeners();
  }

  async markVacancySkipped(vacancyId: string): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    this.state.vacancyQueue = markVacancySkippedHelper(
      this.state.vacancyQueue,
      vacancyId
    );

    await this.storage.set(this.state);
    this.notifyListeners();
  }

  // Vacancy detail preflight methods

  async setVacancyDetailObservation(observation: VacancyDetailObservation): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    this.state.liveMode = setVacancyDetailObservation(this.state.liveMode, observation);

    await this.storage.set(this.state);
    this.notifyListeners();
  }

  async setPreflightClassification(classification: PreflightClassification): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    this.state.liveMode = setPreflightClassification(this.state.liveMode, classification);

    await this.storage.set(this.state);
    this.notifyListeners();
  }

  async clearPreflightState(): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    this.state.liveMode = clearPreflightState(this.state.liveMode);

    await this.storage.set(this.state);
    this.notifyListeners();
  }

  // Apply attempt methods

  async recordLocalApplyAttempt(
    attempt: Omit<LocalApplyAttempt, 'id' | 'createdAt'>
  ): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    this.state.applyAttempts = recordLocalApplyAttemptHelper(
      this.state.applyAttempts,
      attempt
    );

    await this.storage.set(this.state);
    this.notifyListeners();
  }

  async clearApplyAttempts(): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    this.state.applyAttempts = clearApplyAttemptsHelper();

    await this.storage.set(this.state);
    this.notifyListeners();
  }

  // Manual actions
  async createManualAction(action: Omit<import('./types').ManualAction, 'id' | 'createdAt'>): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    const newAction: import('./types').ManualAction = {
      ...action,
      id: `ma_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      createdAt: Date.now(),
    };

    await this.updateState({
      manualActions: [...this.state.manualActions, newAction],
    });

    FileLogger.log('service_worker', 'warn', 'Manual action created', {
      id: newAction.id,
      type: newAction.type,
      vacancyId: newAction.vacancyId,
      profileId: newAction.profileId,
      reasonCode: newAction.reasonCode,
      status: newAction.status,
    });
  }

  async markManualActionDone(id: string): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    const manualActions = this.state.manualActions.map((action) =>
      action.id === id ? { ...action, status: 'done' as const } : action
    );

    await this.updateState({ manualActions });
  }

  async dismissManualAction(id: string): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    const manualActions = this.state.manualActions.map((action) =>
      action.id === id ? { ...action, status: 'dismissed' as const } : action
    );

    await this.updateState({ manualActions });
  }

  async clearCompletedManualActions(): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    const manualActions = this.state.manualActions.filter(
      (action) => action.status === 'pending'
    );

    await this.updateState({ manualActions });
  }

  // Skip list
  async addToSkipList(vacancyId: string, ttlMs: number, reason: 'questionnaire' | 'test' | 'manual_action' = 'questionnaire'): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    const now = Date.now();
    const validEntries = this.state.skipList.filter(entry => entry.expiresAt > now);
    const existing = validEntries.find(entry => entry.vacancyId === vacancyId);

    if (existing) {
      FileLogger.log('service_worker', 'debug', 'Vacancy already in skip list', { vacancyId });
      return;
    }

    const newEntry: import('./types').SkipListEntry = {
      vacancyId,
      addedAt: now,
      expiresAt: now + ttlMs,
      reason,
    };

    await this.updateState({
      skipList: [...validEntries, newEntry],
    });

    FileLogger.log('service_worker', 'info', 'Added to skip list', {
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
    if (!this.state) throw new Error('Store not initialized');
    const now = Date.now();
    const validEntries = this.state.skipList.filter(entry => entry.expiresAt > now);

    if (validEntries.length < this.state.skipList.length) {
      await this.updateState({
        skipList: validEntries,
      });

      FileLogger.log('service_worker', 'info', 'Cleaned skip list', {
        removed: this.state.skipList.length - validEntries.length,
        remaining: validEntries.length,
      });
    }
  }

  async updateSettings(
    patch: Partial<AppState['settings']>
  ): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    await this.updateState({
      settings: {
        ...this.state.settings,
        ...patch,
      },
    });
  }

  async setRuntimePhase(
    phase: AppState['runtime']['currentPhase'],
    pausedReason?: string | null
  ): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    await this.updateState({
      runtime: {
        ...this.state.runtime,
        currentPhase: phase,
        pausedReason: pausedReason === undefined ? this.state.runtime.pausedReason : pausedReason,
        lastEventAt: Date.now(),
      },
    });
  }

  async incrementRuntimeCounters(
    patch: Partial<Pick<AppState['runtime'], 'processed' | 'success' | 'manualActions'>>
  ): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    await this.updateState({
      runtime: {
        ...this.state.runtime,
        processed: this.state.runtime.processed + (patch.processed || 0),
        success: this.state.runtime.success + (patch.success || 0),
        manualActions: this.state.runtime.manualActions + (patch.manualActions || 0),
        lastEventAt: Date.now(),
      },
    });
  }

  async resetRuntimeCounters(): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    await this.updateState({
      runtime: {
        ...this.state.runtime,
        currentPhase: 'idle',
        processed: 0,
        success: 0,
        manualActions: 0,
        pausedReason: null,
        lastEventAt: Date.now(),
      },
    });
  }

  // Search loop methods
  async startSearchLoop(): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    await this.updateState({
      liveMode: {
        ...this.state.liveMode,
        searchLoopActive: true,
        searchLoopIterations: 0,
      },
    });
  }

  async stopSearchLoop(): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    await this.updateState({
      liveMode: {
        ...this.state.liveMode,
        searchLoopActive: false,
      },
    });
  }

  async updateSearchLoopPage(
    page: number,
    totalPages: number | null,
    foundCount: number
  ): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    await this.updateState({
      liveMode: {
        ...this.state.liveMode,
        currentSearchPage: page,
        lastScannedPage: page,
        totalPagesDetected: totalPages,
        lastScanVacancyCount: foundCount,
      },
    });
  }

  async incrementSearchLoopIteration(): Promise<void> {
    if (!this.state) throw new Error('Store not initialized');

    await this.updateState({
      liveMode: {
        ...this.state.liveMode,
        searchLoopIterations: this.state.liveMode.searchLoopIterations + 1,
      },
    });
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
    this.listeners.forEach((listener) => listener(state));
  }
}
