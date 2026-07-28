import { INITIAL_STATE } from './types';
import type { AppState } from './types';
import {
  DEFAULT_QUESTIONNAIRE_AI_SETTINGS,
  INITIAL_QUESTIONNAIRE_STATE,
} from '../questionnaires/types';
import { isAIProviderId } from '../questionnaires/providerCatalog';

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

    return this.migrate(result[this.key]);
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

  private migrate(state: any): AppState {
    if (!state.schemaVersion || state.schemaVersion < 1) {
      return { ...INITIAL_STATE, ...state, schemaVersion: 1 };
    }

    if (!state.manualActions) {
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
      : DEFAULT_QUESTIONNAIRE_AI_SETTINGS.provider.type;
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
          modelId: isAIProviderId(persistedProvider?.type) && typeof persistedProvider.modelId === 'string'
            ? persistedProvider.modelId
            : DEFAULT_QUESTIONNAIRE_AI_SETTINGS.provider.modelId,
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
