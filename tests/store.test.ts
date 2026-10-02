// State store tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter, type StorageAdapter } from '../src/state/storage';
import { INITIAL_STATE, type AppState, type RuntimeState } from '../src/state/types';
import { FileLogger } from '../src/utils/fileLogger';

class ControlledStorage implements StorageAdapter {
  persisted: AppState;
  writes: Array<{ state: AppState; resolve: () => void; reject: (error: Error) => void }> = [];

  constructor(initial: AppState = { ...INITIAL_STATE, profileOrder: ['existing'] }) {
    this.persisted = initial;
  }

  async get(): Promise<AppState> {
    return this.persisted;
  }

  set(state: AppState): Promise<void> {
    return new Promise((resolve, reject) => {
      this.writes.push({
        state,
        resolve: () => { this.persisted = state; resolve(); },
        reject,
      });
    });
  }

  async clear(): Promise<void> {
    this.persisted = INITIAL_STATE;
  }
}

class RecordingStorage implements StorageAdapter {
  persisted: AppState;
  writes: AppState[] = [];
  failNextWrite = false;

  constructor(initial: AppState) {
    this.persisted = initial;
  }

  async get(): Promise<AppState> {
    return this.persisted;
  }

  async set(state: AppState): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('storage failed');
    }
    this.writes.push(state);
    this.persisted = state;
  }

  async clear(): Promise<void> {
    this.persisted = INITIAL_STATE;
  }
}

describe('StateStore', () => {
  let store: StateStore;
  let storage: InMemoryStorageAdapter;

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter();
    store = new StateStore(storage);
    await store.init();
  });

  describe('init', () => {
    it('should load initial state', () => {
      const state = store.getState();
      expect(state.runtimeState).toBe('IDLE');
      expect(state.schemaVersion).toBe(1);
    });
  });

  describe('dispatch', () => {
    it('should transition state on valid event', async () => {
      await store.dispatch('START_REQUESTED');
      expect(store.getState().runtimeState).toBe('STARTING');
    });

    it('should throw on invalid event', async () => {
      await expect(store.dispatch('STOP_REQUESTED')).rejects.toThrow();
    });

    it('should persist state after dispatch', async () => {
      await store.dispatch('START_REQUESTED');
      const persisted = await storage.get();
      expect(persisted.runtimeState).toBe('STARTING');
    });
  });

  describe('updateState', () => {
    it('should update partial state', async () => {
      await store.updateState({ activeProfileId: 'profile-123' });
      expect(store.getState().activeProfileId).toBe('profile-123');
    });

    it('should persist updated state', async () => {
      await store.updateState({ selectedResumeHash: 'resume-abc' });
      const persisted = await storage.get();
      expect(persisted.selectedResumeHash).toBe('resume-abc');
    });

    it('should notify listeners', async () => {
      const listener = vi.fn();
      store.subscribe(listener);

      await store.updateState({ activeProfileId: 'test' });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ activeProfileId: 'test' })
      );
    });
  });

  describe('canDispatch', () => {
    it('should return true for valid transition', () => {
      expect(store.canDispatch('START_REQUESTED')).toBe(true);
    });

    it('should return false for invalid transition', () => {
      expect(store.canDispatch('STOP_REQUESTED')).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('should notify on state change', async () => {
      const listener = vi.fn();
      store.subscribe(listener);

      await store.dispatch('START_REQUESTED');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ runtimeState: 'STARTING' })
      );
    });

    it('should return unsubscribe function', async () => {
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);

      await store.dispatch('START_REQUESTED');
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      await store.dispatch('START_CONFIRMED');
      expect(listener).toHaveBeenCalledTimes(1); // Not called again
    });
  });

  describe('state persistence', () => {
    it('should survive store recreation', async () => {
      await store.updateState({ activeProfileId: 'persistent-id' });

      // Create new store with same storage
      const newStore = new StateStore(storage);
      await newStore.init();

      expect(newStore.getState().activeProfileId).toBe('persistent-id');
    });
  });
});

describe('StateStore write ordering', () => {
  it('publishes a representative command mutation exactly once', async () => {
    const store = new StateStore(new InMemoryStorageAdapter());
    await store.init();
    const publish = vi.fn();
    store.setOnStateChange(publish);

    await store.updateSettings({ delayMinSeconds: 7 });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(store.getState().settings.delayMinSeconds).toBe(7);
  });

  it('publishes once for each committed step in a multi-step lifecycle', async () => {
    const store = new StateStore(new InMemoryStorageAdapter());
    await store.init();
    const publishedStates: RuntimeState[] = [];
    store.setOnStateChange(() => publishedStates.push(store.getState().runtimeState));

    await store.dispatch('START_REQUESTED');
    await store.resetRuntimeCounters();
    await store.dispatch('START_CONFIRMED');

    expect(publishedStates).toEqual(['STARTING', 'STARTING', 'RUNNING']);
  });

  it('persists independent parallel updates in call order from the last saved state', async () => {
    const storage = new ControlledStorage();
    const store = new StateStore(storage);
    await store.init();

    const first = store.updateState({ mode: 'live' });
    const second = store.updateState({ selectedResumeHash: 'resume-1' });
    await vi.waitFor(() => expect(storage.writes).toHaveLength(1));
    expect(storage.writes[0].state.mode).toBe('live');
    expect(storage.writes[0].state.selectedResumeHash).toBeNull();

    storage.writes[0].resolve();
    await vi.waitFor(() => expect(storage.writes).toHaveLength(2));
    expect(storage.writes[1].state.mode).toBe('live');
    expect(storage.writes[1].state.selectedResumeHash).toBe('resume-1');
    storage.writes[1].resolve();
    await Promise.all([first, second]);

    expect(store.getState()).toMatchObject({ mode: 'live', selectedResumeHash: 'resume-1' });
    expect(storage.persisted).toMatchObject({ mode: 'live', selectedResumeHash: 'resume-1' });
  });

  it('keeps memory and listeners unchanged on failure, then runs the next write', async () => {
    const storage = new ControlledStorage();
    const store = new StateStore(storage);
    await store.init();
    const listener = vi.fn();
    const onStateChange = vi.fn();
    store.subscribe(listener);
    store.setOnStateChange(onStateChange);

    const first = store.updateState({ mode: 'live' });
    const firstError = expect(first).rejects.toThrow('storage failed');
    const second = store.updateState({ selectedResumeHash: 'resume-1' });
    await vi.waitFor(() => expect(storage.writes).toHaveLength(1));
    storage.writes[0].reject(new Error('storage failed'));
    await firstError;
    expect(store.getState()).toMatchObject({ mode: 'backend', selectedResumeHash: null });
    expect(listener).not.toHaveBeenCalled();
    expect(onStateChange).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(storage.writes).toHaveLength(2));
    expect(storage.writes[1].state.mode).toBe('backend');
    storage.writes[1].resolve();
    await second;
    expect(store.getState()).toMatchObject({ mode: 'backend', selectedResumeHash: 'resume-1' });
    expect(storage.persisted).toMatchObject({ mode: 'backend', selectedResumeHash: 'resume-1' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  it('notifies once per successful write in persisted order', async () => {
    const storage = new ControlledStorage();
    const store = new StateStore(storage);
    await store.init();
    const events: string[] = [];
    store.subscribe((state) => events.push(`listener:${state.mode}:${state.selectedResumeHash}`));
    store.setOnStateChange(() => events.push(`broadcast:${store.getState().mode}:${store.getState().selectedResumeHash}`));

    const first = store.updateState({ mode: 'live' });
    const second = store.updateState({ selectedResumeHash: 'resume-1' });
    await vi.waitFor(() => expect(storage.writes).toHaveLength(1));
    expect(events).toEqual([]);
    storage.writes[0].resolve();
    await vi.waitFor(() => expect(storage.writes).toHaveLength(2));
    expect(events).toEqual(['listener:live:null', 'broadcast:live:null']);
    storage.writes[1].resolve();
    await Promise.all([first, second]);
    expect(events).toEqual([
      'listener:live:null', 'broadcast:live:null',
      'listener:live:resume-1', 'broadcast:live:resume-1',
    ]);
  });

  it('serializes a former direct queue write with updateState', async () => {
    const vacancy = {
      vacancyId: '100001', url: 'https://hh.ru/vacancy/100001', title: 'Test',
      source: 'search_dom' as const, discoveredAt: 1, profileId: null, status: 'discovered' as const,
    };
    const storage = new ControlledStorage({ ...INITIAL_STATE, profileOrder: ['existing'], vacancyQueue: [vacancy] });
    const store = new StateStore(storage);
    await store.init();

    const first = store.markVacancyProcessed('100001');
    const second = store.updateState({ selectedResumeHash: 'resume-1' });
    await vi.waitFor(() => expect(storage.writes).toHaveLength(1));
    storage.writes[0].resolve();
    await vi.waitFor(() => expect(storage.writes).toHaveLength(2));
    expect(storage.writes[1].state.vacancyQueue[0].status).toBe('processed');
    storage.writes[1].resolve();
    await Promise.all([first, second]);
    expect(store.getState().vacancyQueue[0].status).toBe('processed');
    expect(storage.persisted).toMatchObject({ selectedResumeHash: 'resume-1' });
    expect(storage.persisted.vacancyQueue[0].status).toBe('processed');
  });

  it('keeps search sync fields when a concurrent diff is saved', async () => {
    const storage = new ControlledStorage();
    const store = new StateStore(storage);
    await store.init();
    const url = 'https://hh.ru/search/vacancy?text=typescript';
    const diff = { synced: true, mismatches: [] };

    const sync = store.markSearchSynced(url, 'profile-1');
    const saveDiff = store.setSearchSyncDiff(diff);
    await vi.waitFor(() => expect(storage.writes).toHaveLength(1));
    storage.writes[0].resolve();
    await vi.waitFor(() => expect(storage.writes).toHaveLength(2));
    expect(storage.writes[1].state.liveMode).toMatchObject({
      searchSyncStatus: 'synced',
      lastAppliedSearchUrl: url,
      lastAppliedProfileId: 'profile-1',
      searchSyncDiff: diff,
    });
    storage.writes[1].resolve();
    await Promise.all([sync, saveDiff]);
    expect(store.getState().liveMode).toEqual(storage.persisted.liveMode);
  });

  it('removes processed vacancies without losing a concurrently added vacancy', async () => {
    const processed = {
      vacancyId: '100001', url: 'https://hh.ru/vacancy/100001', title: 'Processed',
      source: 'search_dom' as const, discoveredAt: 1, profileId: null, status: 'processed' as const,
    };
    const storage = new ControlledStorage({ ...INITIAL_STATE, profileOrder: ['existing'], vacancyQueue: [processed] });
    const store = new StateStore(storage);
    await store.init();

    const add = store.materializeVacanciesFromSearch([
      { vacancyId: '100002', url: 'https://hh.ru/vacancy/100002', title: 'New' },
    ], null);
    await vi.waitFor(() => expect(storage.writes).toHaveLength(1));
    const remove = store.removeProcessedVacancies();
    expect(storage.writes).toHaveLength(1);
    storage.writes[0].resolve();
    await vi.waitFor(() => expect(storage.writes).toHaveLength(2));
    expect(storage.writes[1].state.vacancyQueue.map((item) => item.vacancyId)).toEqual(['100002']);
    storage.writes[1].resolve();
    await Promise.all([add, remove]);
    expect(store.getState().vacancyQueue.map((item) => item.vacancyId)).toEqual(['100002']);
    expect(storage.persisted.vacancyQueue.map((item) => item.vacancyId)).toEqual(['100002']);
  });

  it('keeps a committed write successful when callbacks throw', async () => {
    const storage = new ControlledStorage();
    const store = new StateStore(storage);
    await store.init();
    const log = vi.spyOn(FileLogger, 'log').mockResolvedValue(undefined);
    const first = vi.fn(() => { throw new Error('listener failed'); });
    const second = vi.fn();
    const onStateChange = vi.fn(() => { throw new Error('broadcast failed'); });
    store.subscribe(first);
    store.subscribe(second);
    store.setOnStateChange(onStateChange);

    try {
      const write = store.updateState({ mode: 'live' });
      await vi.waitFor(() => expect(storage.writes).toHaveLength(1));
      storage.writes[0].resolve();
      await expect(write).resolves.toBeUndefined();
      expect(store.getState().mode).toBe('live');
      expect(storage.persisted.mode).toBe('live');
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
      expect(onStateChange).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('service_worker', 'error', expect.stringContaining('listener'), expect.any(Object));
      expect(log).toHaveBeenCalledWith('service_worker', 'error', expect.stringContaining('onStateChange'), expect.any(Object));
    } finally {
      log.mockRestore();
    }
  });

  it('continues the queue after a transform throws', async () => {
    const storage = new ControlledStorage();
    const store = new StateStore(storage);
    await store.init();

    const invalid = store.dispatch('STOP_REQUESTED');
    const rejected = expect(invalid).rejects.toThrow('Invalid transition');
    const next = store.updateState({ mode: 'live' });
    await rejected;
    await vi.waitFor(() => expect(storage.writes).toHaveLength(1));
    expect(storage.writes[0].state.mode).toBe('live');
    storage.writes[0].resolve();
    await next;
    expect(store.getState().mode).toBe('live');
    expect(storage.persisted.mode).toBe('live');
  });
});

describe('StateStore interrupted runtime reconciliation', () => {
  const persistentState = (runtimeState: RuntimeState): AppState => ({
    ...INITIAL_STATE,
    runtimeState,
    profileOrder: ['existing'],
    runtime: {
      ...INITIAL_STATE.runtime,
      currentPhase: 'apply',
      processed: 7,
      success: 3,
      manualActions: 2,
      pausedReason: 'old_reason',
      lastEventAt: 100,
    },
    vacancyQueue: [{
      vacancyId: 'vacancy-1',
      url: 'https://hh.ru/vacancy/1',
      title: 'Vacancy',
      source: 'search_dom',
      discoveredAt: 10,
      profileId: 'profile-1',
      status: 'queued',
    }],
    applyAttempts: [{
      id: 'attempt-1',
      vacancyId: 'vacancy-1',
      outcome: 'success',
      message: 'saved',
      createdAt: 11,
    }],
    manualActions: [{
      id: 'manual-1',
      type: 'manual_review',
      vacancyId: 'vacancy-1',
      createdAt: 12,
      status: 'pending',
      reasonCode: 'review',
    }],
  });

  it.each(['STARTING', 'RUNNING', 'STOPPING'] as const)(
    'recovers persisted %s to STOPPED and preserves durable work',
    async (runtimeState) => {
      vi.useFakeTimers();
      vi.setSystemTime(200);
      const storage = new RecordingStorage(persistentState(runtimeState));
      const store = new StateStore(storage);
      const log = vi.spyOn(FileLogger, 'log').mockResolvedValue(undefined);

      try {
        await store.init();
        const result = await store.reconcileInterruptedRuntime();

        expect(result).toEqual({ recovered: true, previousState: runtimeState });
        expect(storage.writes).toHaveLength(1);
        expect(store.getState()).toMatchObject({
          runtimeState: 'STOPPED',
          runtime: {
            currentPhase: 'idle',
            processed: 7,
            success: 3,
            manualActions: 2,
            pausedReason: null,
            lastEventAt: 200,
          },
          vacancyQueue: persistentState(runtimeState).vacancyQueue,
          applyAttempts: persistentState(runtimeState).applyAttempts,
          manualActions: persistentState(runtimeState).manualActions,
        });
        expect(storage.persisted).toEqual(store.getState());
        expect(log).toHaveBeenCalledWith('service_worker', 'warn', expect.any(String), {
          previousState: runtimeState,
          newState: 'STOPPED',
          reason: 'worker_restart',
        });
      } finally {
        log.mockRestore();
        vi.useRealTimers();
      }
    }
  );

  it.each([
    'IDLE',
    'STOPPED',
    'ERROR',
    'PAUSED_BY_USER',
    'PAUSED_MANUAL_ACTION',
    'PAUSED_NO_VACANCIES',
  ] as const)('keeps stable persisted %s without a write', async (runtimeState) => {
    const storage = new RecordingStorage(persistentState(runtimeState));
    const store = new StateStore(storage);
    await store.init();

    await expect(store.reconcileInterruptedRuntime()).resolves.toEqual({ recovered: false });
    expect(storage.writes).toHaveLength(0);
    expect(store.getState()).toEqual(persistentState(runtimeState));
  });

  it('does not publish failed recovery to memory and allows retry', async () => {
    const storage = new RecordingStorage(persistentState('RUNNING'));
    const store = new StateStore(storage);
    await store.init();
    storage.failNextWrite = true;

    await expect(store.reconcileInterruptedRuntime()).rejects.toThrow('storage failed');
    expect(store.getState().runtimeState).toBe('RUNNING');
    expect(storage.persisted.runtimeState).toBe('RUNNING');

    await expect(store.reconcileInterruptedRuntime()).resolves.toEqual({
      recovered: true,
      previousState: 'RUNNING',
    });
    expect(store.getState().runtimeState).toBe('STOPPED');
  });

  it('permits START_REQUESTED after recovery', async () => {
    const storage = new RecordingStorage(persistentState('STARTING'));
    const store = new StateStore(storage);
    await store.init();

    await store.reconcileInterruptedRuntime();
    await store.dispatch('START_REQUESTED');

    expect(store.getState().runtimeState).toBe('STARTING');
  });
});
