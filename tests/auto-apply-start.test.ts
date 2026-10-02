import { describe, expect, it, vi } from 'vitest';
import { startAutoApply, type StartableAutoApplyEngine } from '../src/background/autoApplyStart';
import { BackendAutoApplyEngine } from '../src/runtime/backendAutoApplyEngine';
import { LiveAutoApplyEngineV2 } from '../src/runtime/liveAutoApplyEngineV2';
import { StateStore } from '../src/state/store';
import type { StorageAdapter } from '../src/state/storage';
import { INITIAL_STATE, type AppState } from '../src/state/types';

function createEngine(start: () => Promise<void>): StartableAutoApplyEngine {
  return { requestStart: vi.fn(start) };
}

describe('startAutoApply', () => {
  it('returns success only after the selected engine accepts startup', async () => {
    let accept!: () => void;
    const backend = createEngine(() => new Promise<void>((resolve) => { accept = resolve; }));
    const live = createEngine(vi.fn().mockResolvedValue(undefined));

    const resultPromise = startAutoApply('backend', { backend, live });
    let settled = false;
    void resultPromise.then(() => { settled = true; });
    await Promise.resolve();

    expect(settled).toBe(false);
    accept();
    await expect(resultPromise).resolves.toEqual({ success: true, runtimeState: 'RUNNING' });
    expect(live.requestStart).not.toHaveBeenCalled();
  });

  it('returns one failure contract when startup is rejected', async () => {
    const backend = createEngine(vi.fn().mockRejectedValue(new Error('start rejected')));
    const live = createEngine(vi.fn().mockResolvedValue(undefined));

    await expect(startAutoApply('backend', { backend, live })).resolves.toEqual({
      success: false,
      error: 'start rejected',
    });
  });
});

describe('BackendAutoApplyEngine requestStart', () => {
  it('resolves after RUNNING is persisted without waiting for the cycle', async () => {
    const persisted: AppState[] = [];
    const storage: StorageAdapter = {
      get: vi.fn().mockResolvedValue(INITIAL_STATE),
      set: vi.fn(async (state: AppState) => { persisted.push(state); }),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const store = new StateStore(storage);
    await store.init();
    let releaseAuth!: () => void;
    const checkAuth = vi.fn(() => new Promise<{ authorized: boolean }>((resolve) => { releaseAuth = () => resolve({ authorized: false }); }));
    const engine = new BackendAutoApplyEngine({
      store,
      httpClient: {
        checkAuth,
        getMyResumes: vi.fn(),
        fetchVacancies: vi.fn(),
        preflightApply: vi.fn(),
        applyToVacancy: vi.fn(),
      } as any,
      sleep: vi.fn().mockResolvedValue(undefined),
      log: vi.fn(),
    });

    await expect(engine.requestStart()).resolves.toBeUndefined();

    expect(store.getState().runtimeState).toBe('RUNNING');
    expect(persisted.at(-1)?.runtimeState).toBe('RUNNING');
    expect(checkAuth).toHaveBeenCalledTimes(1);

    releaseAuth();
    await vi.waitFor(() => expect(engine.isRunning()).toBe(false));
  });

  it('rejects a concurrent duplicate without a second FSM transition', async () => {
    const store = new StateStore({
      get: vi.fn().mockResolvedValue({ ...INITIAL_STATE, profileOrder: ['orphan'] }),
      set: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    });
    await store.init();
    let releaseAuth!: () => void;
    const engine = new BackendAutoApplyEngine({
      store,
      httpClient: {
        checkAuth: vi.fn(() => new Promise<{ authorized: boolean }>((resolve) => { releaseAuth = () => resolve({ authorized: false }); })),
      } as any,
      sleep: vi.fn().mockResolvedValue(undefined),
      log: vi.fn(),
    });
    const dispatch = vi.spyOn(store, 'dispatch');

    await engine.requestStart();
    await expect(engine.requestStart()).rejects.toThrow('already running');
    expect(dispatch.mock.calls.filter(([event]) => event === 'START_REQUESTED')).toHaveLength(1);

    releaseAuth();
    await vi.waitFor(() => expect(engine.isRunning()).toBe(false));
  });

  it('returns a startup persistence failure and never enters the cycle', async () => {
    const storage: StorageAdapter = {
      get: vi.fn().mockResolvedValue(INITIAL_STATE),
      set: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error('storage unavailable')),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const store = new StateStore(storage);
    await store.init();
    const checkAuth = vi.fn();
    const engine = new BackendAutoApplyEngine({
      store,
      httpClient: { checkAuth } as any,
      sleep: vi.fn().mockResolvedValue(undefined),
      log: vi.fn(),
    });

    await expect(engine.requestStart()).rejects.toThrow('storage unavailable');
    expect(checkAuth).not.toHaveBeenCalled();
    expect(store.getState().runtimeState).toBe('IDLE');
  });

  it('rejects an invalid FSM start without changing the persisted runtime state', async () => {
    const persisted = { ...INITIAL_STATE, profileOrder: ['existing'], runtimeState: 'PAUSED_BY_USER' as const };
    const storage: StorageAdapter = {
      get: vi.fn().mockResolvedValue(persisted),
      set: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const store = new StateStore(storage);
    await store.init();
    const engine = new BackendAutoApplyEngine({
      store,
      httpClient: { checkAuth: vi.fn() } as any,
      sleep: vi.fn().mockResolvedValue(undefined),
      log: vi.fn(),
    });

    await expect(engine.requestStart()).rejects.toThrow('Invalid transition');
    await vi.waitFor(() => expect(engine.isRunning()).toBe(false));

    expect(store.getState().runtimeState).toBe('PAUSED_BY_USER');
    expect(storage.set).not.toHaveBeenCalled();
  });
});

describe('LiveAutoApplyEngineV2 requestStart', () => {
  it('returns controlled-tab startup failure instead of acknowledging the run', async () => {
    const store = new StateStore({
      get: vi.fn().mockResolvedValue({ ...INITIAL_STATE, profileOrder: ['orphan'] }),
      set: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    });
    await store.init();
    const engine = new LiveAutoApplyEngineV2({
      store,
      acquisitionService: { acquireForProfile: vi.fn() } as any,
      sleep: vi.fn().mockResolvedValue(undefined),
      log: vi.fn(),
    });

    await expect(engine.requestStart()).rejects.toThrow('no_active_profile');
    await vi.waitFor(() => expect(engine.isRunning()).toBe(false));

    expect(store.getState().runtimeState).toBe('STOPPED');
  });
});
