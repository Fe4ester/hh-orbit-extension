// Storage abstraction layer

import { AppState, INITIAL_STATE } from './types';

export interface StorageAdapter {
  get(): Promise<AppState>;
  set(state: AppState): Promise<void>;
  clear(): Promise<void>;
}

// Chrome extension storage adapter
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
    // Schema migration logic
    if (!state.schemaVersion || state.schemaVersion < 1) {
      return { ...INITIAL_STATE, ...state, schemaVersion: 1 };
    }

    // Add manualActions if missing
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

    return state;
  }
}

// In-memory storage for tests
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
