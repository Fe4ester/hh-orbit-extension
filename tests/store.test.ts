// State store tests

import { describe, it, expect, beforeEach } from 'vitest';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';

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
