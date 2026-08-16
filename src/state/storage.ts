import { INITIAL_STATE } from './types';
import type { AppState } from './types';
import {
  DEFAULT_QUESTIONNAIRE_AI_SETTINGS,
  INITIAL_QUESTIONNAIRE_STATE,
} from '../questionnaires/types';
import {
  DEFAULT_AI_PROVIDER_ID,
  getProviderDefinition,
  isAIProviderId,
} from '../questionnaires/providerCatalog';

const MIN_PROVIDER_TIMEOUT_MS = 5_000;
const MAX_PROVIDER_TIMEOUT_MS = 90_000;

function normalizedTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_QUESTIONNAIRE_AI_SETTINGS.provider.timeoutMs;
  }
  return Math.min(MAX_PROVIDER_TIMEOUT_MS, Math.max(MIN_PROVIDER_TIMEOUT_MS, Math.round(value)));
}

export interface StorageAdapter {
  get(): Promise<AppState>;
  set(state: AppState): Promise<void>;
  clear(): Promise<void>;
}

export class ExtensionStorageAdapter implements StorageAdapter {
  private readonly key = 'app_state';

  async get(): Promise<AppState> {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return { ...INITIAL_STATE };
    }

    const result = await chrome.storage.local.get(this.key);
    if (!result[this.key]) {
      return { ...INITIAL_STATE };
    }

    const migrated = this.migrate(result[this.key]);
    await chrome.storage.local.set({ [this.key]: migrated });
    return migrated;
  }

  async set(state: AppState): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return;
    }

    await chrome.storage.local.set({ [this.key]: state });
  }

  async clear(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return;
    }

    await chrome.storage.local.remove(this.key);
  }

  private migrate(persistedState: any): AppState {
    const state = {
      ...INITIAL_STATE,
      ...persistedState,
      schemaVersion: 1,
    };

    if (!Array.isArray(state.manualActions)) {
      state.manualActions = [];
    }

    if (!state.settings) {
      state.settings = { ...INITIAL_STATE.settings };
    } else {
      state.settings = {
        ...INITIAL_STATE.settings,
        ...state.settings,
      };
    }

    if (!state.runtime) {
      state.runtime = { ...INITIAL_STATE.runtime };
    } else {
      state.runtime = {
        ...INITIAL_STATE.runtime,
        ...state.runtime,
      };
    }

    const persistedProvider = state.questionnaires?.settings?.provider;
    const providerType = isAIProviderId(persistedProvider?.type)
      ? persistedProvider.type
      : DEFAULT_AI_PROVIDER_ID;
    const providerDefinition = getProviderDefinition(providerType);
    const persistedModelId = typeof persistedProvider?.modelId === 'string'
      ? persistedProvider.modelId.trim()
      : '';
    state.questionnaires = {
      ...INITIAL_QUESTIONNAIRE_STATE,
      ...state.questionnaires,
      settings: {
        ...DEFAULT_QUESTIONNAIRE_AI_SETTINGS,
        ...state.questionnaires?.settings,
        provider: {
          ...DEFAULT_QUESTIONNAIRE_AI_SETTINGS.provider,
          ...persistedProvider,
          type: providerType,
          modelId: isAIProviderId(persistedProvider?.type) && persistedModelId
            ? persistedModelId
            : providerDefinition.defaultModel,
          timeoutMs: normalizedTimeout(persistedProvider?.timeoutMs),
        },
        confidence: {
          ...DEFAULT_QUESTIONNAIRE_AI_SETTINGS.confidence,
          ...state.questionnaires?.settings?.confidence,
        },
        context: {
          ...DEFAULT_QUESTIONNAIRE_AI_SETTINGS.context,
          ...state.questionnaires?.settings?.context,
          resumeFacts: Array.isArray(state.questionnaires?.settings?.context?.resumeFacts)
            ? state.questionnaires.settings.context.resumeFacts
            : [],
          profileFacts: Array.isArray(state.questionnaires?.settings?.context?.profileFacts)
            ? state.questionnaires.settings.context.profileFacts
            : [],
          savedAnswers: Array.isArray(state.questionnaires?.settings?.context?.savedAnswers)
            ? state.questionnaires.settings.context.savedAnswers
            : [],
        },
      },
      queue: Array.isArray(state.questionnaires?.queue) ? state.questionnaires.queue : [],
    };

    return state;
  }
}

export class InMemoryStorageAdapter implements StorageAdapter {
  private state: AppState = { ...INITIAL_STATE };

  async get(): Promise<AppState> {
    return { ...this.state };
  }

  async set(state: AppState): Promise<void> {
    this.state = { ...state };
  }

  async clear(): Promise<void> {
    this.state = { ...INITIAL_STATE };
  }
}
