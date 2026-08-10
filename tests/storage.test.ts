// Storage adapter tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryStorageAdapter, ExtensionStorageAdapter } from '../src/state/storage';
import { INITIAL_STATE } from '../src/state/types';

describe('InMemoryStorageAdapter', () => {
  let adapter: InMemoryStorageAdapter;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
  });

  it('should return initial state on first get', async () => {
    const state = await adapter.get();
    expect(state).toEqual(INITIAL_STATE);
  });

  it('should persist state', async () => {
    const newState = { ...INITIAL_STATE, activeProfileId: 'test-123' };
    await adapter.set(newState);

    const retrieved = await adapter.get();
    expect(retrieved.activeProfileId).toBe('test-123');
  });

  it('should clear state', async () => {
    await adapter.set({ ...INITIAL_STATE, activeProfileId: 'test' });
    await adapter.clear();

    const state = await adapter.get();
    expect(state).toEqual(INITIAL_STATE);
  });
});

describe('ExtensionStorageAdapter', () => {
  let adapter: ExtensionStorageAdapter;

  beforeEach(() => {
    adapter = new ExtensionStorageAdapter();
    vi.clearAllMocks();
  });

  it('should return initial state when storage is empty', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({} as any);

    const state = await adapter.get();
    expect(state).toEqual(INITIAL_STATE);
  });

  it('should retrieve persisted state', async () => {
    const persistedState = { ...INITIAL_STATE, activeProfileId: 'stored' };
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      app_state: persistedState,
    } as any);

    const state = await adapter.get();
    expect(state.activeProfileId).toBe('stored');
  });

  it('should persist state to chrome.storage', async () => {
    const newState = { ...INITIAL_STATE, runtimeState: 'RUNNING' as const };
    await adapter.set(newState);

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      app_state: newState,
    });
  });

  it('should migrate old schema versions', async () => {
    const oldState = { ...INITIAL_STATE, schemaVersion: 0 };
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      app_state: oldState,
    } as any);

    const state = await adapter.get();
    expect(state.schemaVersion).toBe(1);
  });

  it('normalizes a removed local provider while migrating an old schema', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      app_state: {
        ...INITIAL_STATE,
        schemaVersion: 0,
        questionnaires: {
          settings: {
            provider: { type: 'local_runtime', modelId: 'legacy-local-model', timeoutMs: 180_000 },
          },
          queue: [],
        },
      },
    } as any);

    const state = await adapter.get();
    expect(state.questionnaires.settings.provider).toMatchObject({
      type: 'openrouter',
      modelId: 'openrouter/free',
      timeoutMs: 90_000,
    });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ app_state: state });
  });

  it('should add questionnaire defaults to existing state', async () => {
    const { questionnaires: _questionnaires, ...legacyState } = INITIAL_STATE;
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      app_state: legacyState,
    } as any);

    const state = await adapter.get();
    expect(state.questionnaires.settings.provider.type).toBe('openrouter');
    expect(state.questionnaires.settings.provider.modelId).toBe('openrouter/free');
    expect(state.questionnaires.queue).toEqual([]);
  });

  it('should preserve persisted provider settings', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      app_state: {
        ...INITIAL_STATE,
        questionnaires: {
          settings: {
            provider: { type: 'groq', modelId: 'openai/gpt-oss-120b', timeoutMs: 60_000 },
          },
          queue: [],
        },
      },
    } as any);

    const state = await adapter.get();
    expect(state.questionnaires.settings.provider.type).toBe('groq');
    expect(state.questionnaires.settings.provider.modelId).toBe('openai/gpt-oss-120b');
    expect(state.questionnaires.settings.provider.timeoutMs).toBe(60_000);
    expect(state.questionnaires.settings.requireReview).toBe(true);
    expect(state.questionnaires.settings.context.resumeFacts).toEqual([]);
  });

  it('migrates unsupported legacy providers to the default hosted provider', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      app_state: {
        ...INITIAL_STATE,
        questionnaires: {
          settings: { provider: { type: 'unsupported_provider', modelId: 'old-model' } },
          queue: [],
        },
      },
    } as any);

    const state = await adapter.get();
    expect(state.questionnaires.settings.provider).toMatchObject({
      type: 'openrouter',
      modelId: 'openrouter/free',
    });
  });

  it('should handle missing chrome API gracefully', async () => {
    const originalChrome = global.chrome;
    // @ts-ignore
    global.chrome = undefined;

    const state = await adapter.get();
    expect(state).toEqual(INITIAL_STATE);

    global.chrome = originalChrome;
  });
});
