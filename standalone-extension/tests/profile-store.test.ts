// Profile store integration tests

import { describe, it, expect, beforeEach } from 'vitest';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';
import { getActiveProfile } from '../src/state/selectors';

describe('StateStore - Profile Actions', () => {
  let store: StateStore;
  let storage: InMemoryStorageAdapter;

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter();
    store = new StateStore(storage);
    await store.init();
  });

  describe('createProfile', () => {
    it('should create and persist profile', async () => {
      const profileId = await store.createProfile({
        name: 'New Profile',
        keywordsInclude: ['React'],
      });

      const state = store.getState();
      expect(state.profiles[profileId]).toBeDefined();
      expect(state.profiles[profileId].name).toBe('New Profile');
      expect(state.profileOrder).toContain(profileId);
    });

    it('should persist to storage', async () => {
      const profileId = await store.createProfile({ name: 'Test' });

      const persisted = await storage.get();
      expect(persisted.profiles[profileId]).toBeDefined();
    });
  });

  describe('updateProfile', () => {
    it('should update profile fields', async () => {
      const state = store.getState();
      const profileId = state.profileOrder[0]; // Default profile

      await store.updateProfile(profileId, { name: 'Updated Name' });

      const updated = store.getState();
      expect(updated.profiles[profileId].name).toBe('Updated Name');
    });

    it('should throw if profile not found', async () => {
      await expect(
        store.updateProfile('non-existent', { name: 'Test' })
      ).rejects.toThrow('Profile non-existent not found');
    });

    it('should update updatedAt timestamp', async () => {
      const state = store.getState();
      const profileId = state.profileOrder[0];
      const originalTimestamp = state.profiles[profileId].updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));
      await store.updateProfile(profileId, { name: 'Updated' });

      const updated = store.getState();
      expect(updated.profiles[profileId].updatedAt).toBeGreaterThan(originalTimestamp);
    });
  });

  describe('deleteProfile', () => {
    it('should delete profile', async () => {
      const profileId = await store.createProfile({ name: 'To Delete' });

      await store.deleteProfile(profileId);

      const state = store.getState();
      expect(state.profiles[profileId]).toBeUndefined();
      expect(state.profileOrder).not.toContain(profileId);
    });

    it('should throw if profile not found', async () => {
      await expect(store.deleteProfile('non-existent')).rejects.toThrow(
        'Profile non-existent not found'
      );
    });

    it('should select next profile if active deleted', async () => {
      const profile1Id = await store.createProfile({ name: 'Profile 1' });
      await store.createProfile({ name: 'Profile 2' });

      await store.setActiveProfile(profile1Id);
      await store.deleteProfile(profile1Id);

      const state = store.getState();
      expect(state.activeProfileId).not.toBe(profile1Id);
      expect(state.activeProfileId).toBeDefined();
    });

    it('should set activeProfileId to null if last profile deleted', async () => {
      const state = store.getState();
      for (const profileId of state.profileOrder) {
        await store.deleteProfile(profileId);
      }

      const updated = store.getState();
      expect(updated.activeProfileId).toBeNull();
      expect(updated.profileOrder).toHaveLength(0);
    });
  });

  describe('duplicateProfile', () => {
    it('should create duplicate with new ID', async () => {
      const state = store.getState();
      const originalId = state.profileOrder[0];

      const duplicateId = await store.duplicateProfile(originalId);

      const updated = store.getState();
      expect(duplicateId).not.toBe(originalId);
      expect(updated.profiles[duplicateId]).toBeDefined();
      expect(updated.profiles[duplicateId].name).toContain('Copy of');
    });

    it('should insert after original in order', async () => {
      const profile1Id = await store.createProfile({ name: 'Profile 1' });
      await store.createProfile({ name: 'Profile 2' });

      const duplicateId = await store.duplicateProfile(profile1Id);

      const state = store.getState();
      const profile1Index = state.profileOrder.indexOf(profile1Id);
      const duplicateIndex = state.profileOrder.indexOf(duplicateId);

      expect(duplicateIndex).toBe(profile1Index + 1);
    });

    it('should throw if profile not found', async () => {
      await expect(store.duplicateProfile('non-existent')).rejects.toThrow(
        'Profile non-existent not found'
      );
    });
  });

  describe('setActiveProfile', () => {
    it('should set active profile', async () => {
      const profileId = await store.createProfile({ name: 'New Active' });

      await store.setActiveProfile(profileId);

      const state = store.getState();
      expect(state.activeProfileId).toBe(profileId);
    });

    it('should allow setting to null', async () => {
      await store.setActiveProfile(null);

      const state = store.getState();
      expect(state.activeProfileId).toBeNull();
    });

    it('should throw if profile not found', async () => {
      await expect(store.setActiveProfile('non-existent')).rejects.toThrow(
        'Profile non-existent not found'
      );
    });

    it('should persist active profile', async () => {
      const profileId = await store.createProfile({ name: 'Test' });
      await store.setActiveProfile(profileId);

      // Create new store with same storage
      const newStore = new StateStore(storage);
      await newStore.init();

      const state = newStore.getState();
      expect(state.activeProfileId).toBe(profileId);
    });
  });

  describe('default profiles', () => {
    it('should create default presets on init', () => {
      const state = store.getState();

      expect(state.profileOrder.length).toBeGreaterThanOrEqual(5);
      expect(state.activeProfileId).not.toBeNull();

      const names = state.profileOrder.map((id) => state.profiles[id].name);
      expect(names).toEqual(expect.arrayContaining(['Python', 'Rust', 'Frontend', 'Fullstack', 'QA']));
    });

    it('should keep existing profiles and not overwrite', async () => {
      const existingStore = new StateStore(storage);
      await existingStore.init();
      const state = existingStore.getState();
      const firstId = state.profileOrder[0];
      await existingStore.updateProfile(firstId, { name: 'Custom Name' });

      const reloaded = new StateStore(storage);
      await reloaded.init();
      const after = reloaded.getState();
      expect(after.profiles[firstId].name).toBe('Custom Name');
    });

    it('should set first preset as active', () => {
      const state = store.getState();
      const activeProfile = getActiveProfile(state);

      expect(activeProfile).not.toBeNull();
      expect(activeProfile?.name).toBe('Python');
    });
  });

  describe('profile persistence', () => {
    it('should survive store recreation', async () => {
      const profileId = await store.createProfile({
        name: 'Persistent Profile',
        keywordsInclude: ['React', 'TypeScript'],
      });

      await store.setActiveProfile(profileId);

      // Create new store with same storage
      const newStore = new StateStore(storage);
      await newStore.init();

      const state = newStore.getState();
      expect(state.profiles[profileId]).toBeDefined();
      expect(state.profiles[profileId].name).toBe('Persistent Profile');
      expect(state.profiles[profileId].keywordsInclude).toEqual(['React', 'TypeScript']);
      expect(state.activeProfileId).toBe(profileId);
    });
  });
});
