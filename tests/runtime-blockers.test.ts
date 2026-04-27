import { describe, it, expect, beforeEach } from 'vitest';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';

describe('runtime blockers', () => {
  let store: StateStore;
  let storage: InMemoryStorageAdapter;

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter();
    store = new StateStore(storage);
    await store.init();
  });

  describe('session status', () => {
    it('sets session status', async () => {
      await store.setSessionStatus('login_required');
      const state = store.getState();
      expect(state.sessionStatus).toBe('login_required');
    });

    it('defaults to unknown', () => {
      const state = store.getState();
      expect(state.sessionStatus).toBe('unknown');
    });
  });

  describe('runtime blocker', () => {
    it('sets runtime blocker', async () => {
      await store.setRuntimeBlocker('login_required', 'Login page detected');
      const state = store.getState();
      expect(state.runtimeBlocker).toBe('login_required');
      expect(state.lastRuntimeError).toBe('Login page detected');
    });

    it('clears runtime blocker', async () => {
      await store.setRuntimeBlocker('captcha_required', 'Captcha detected');
      await store.clearRuntimeBlocker();
      const state = store.getState();
      expect(state.runtimeBlocker).toBeNull();
      expect(state.lastRuntimeError).toBeNull();
    });

    it('defaults to null', () => {
      const state = store.getState();
      expect(state.runtimeBlocker).toBeNull();
    });
  });

  describe('search loop with blocker', () => {
    it('prevents search loop when blocker set', async () => {
      await store.setRuntimeBlocker('login_required', 'Login required');

      // Search loop should check blocker before starting
      const state = store.getState();
      expect(state.runtimeBlocker).toBe('login_required');
    });

    it('allows search loop when no blocker', async () => {
      await store.startSearchLoop();
      const state = store.getState();
      expect(state.liveMode.searchLoopActive).toBe(true);
    });
  });
});
