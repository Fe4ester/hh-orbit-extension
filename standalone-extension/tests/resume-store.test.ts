// Resume store integration tests

import { describe, it, expect, beforeEach } from 'vitest';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';
import { ResumeCandidate } from '../src/state/types';
import { getSelectedResume } from '../src/state/selectors';

describe('StateStore - Resume Actions', () => {
  let store: StateStore;
  let storage: InMemoryStorageAdapter;

  const mockResumes: ResumeCandidate[] = [
    {
      hash: 'resume_1',
      title: 'Frontend Developer',
      url: 'https://hh.ru/resume/1',
      isActive: true,
    },
    {
      hash: 'resume_2',
      title: 'Backend Developer',
      url: 'https://hh.ru/resume/2',
      isActive: true,
    },
  ];

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter();
    store = new StateStore(storage);
    await store.init();
  });

  describe('setResumeCandidates', () => {
    it('should store resume candidates', async () => {
      await store.setResumeCandidates(mockResumes);

      const state = store.getState();
      expect(state.resumeCandidates).toEqual(mockResumes);
    });

    it('should persist to storage', async () => {
      await store.setResumeCandidates(mockResumes);

      const persisted = await storage.get();
      expect(persisted.resumeCandidates).toEqual(mockResumes);
    });
  });

  describe('selectResume', () => {
    beforeEach(async () => {
      await store.setResumeCandidates(mockResumes);
    });

    it('should select existing resume', async () => {
      await store.selectResume('resume_1');

      const state = store.getState();
      expect(state.selectedResumeHash).toBe('resume_1');
    });

    it('should allow selecting null', async () => {
      await store.selectResume('resume_1');
      await store.selectResume(null);

      const state = store.getState();
      expect(state.selectedResumeHash).toBeNull();
    });

    it('should throw if resume not in candidates', async () => {
      await expect(store.selectResume('non_existent')).rejects.toThrow(
        'Resume non_existent not found in candidates'
      );
    });

    it('should persist selection', async () => {
      await store.selectResume('resume_2');

      const persisted = await storage.get();
      expect(persisted.selectedResumeHash).toBe('resume_2');
    });
  });

  describe('bindResumeToProfile', () => {
    beforeEach(async () => {
      await store.setResumeCandidates(mockResumes);
    });

    it('should bind resume to profile', async () => {
      const state = store.getState();
      const profileId = state.profileOrder[0];

      await store.bindResumeToProfile(profileId, 'resume_1');

      const updated = store.getState();
      expect(updated.profiles[profileId].selectedResumeHash).toBe('resume_1');
    });

    it('should allow binding null', async () => {
      const state = store.getState();
      const profileId = state.profileOrder[0];

      await store.bindResumeToProfile(profileId, 'resume_1');
      await store.bindResumeToProfile(profileId, null);

      const updated = store.getState();
      expect(updated.profiles[profileId].selectedResumeHash).toBeNull();
    });

    it('should throw if profile not found', async () => {
      await expect(store.bindResumeToProfile('non_existent', 'resume_1')).rejects.toThrow(
        'Profile non_existent not found'
      );
    });

    it('should throw if resume not in candidates', async () => {
      const state = store.getState();
      const profileId = state.profileOrder[0];

      await expect(store.bindResumeToProfile(profileId, 'missing')).rejects.toThrow(
        'Resume missing not found in candidates'
      );
    });
  });

  describe('applyProfileResumeBinding', () => {
    beforeEach(async () => {
      await store.setResumeCandidates(mockResumes);
    });

    it('should apply bound resume if candidate exists', async () => {
      const state = store.getState();
      const profileId = state.profileOrder[0];

      await store.bindResumeToProfile(profileId, 'resume_2');
      await store.applyProfileResumeBinding(profileId);

      const updated = store.getState();
      expect(updated.selectedResumeHash).toBe('resume_2');
    });

    it('should not apply if bound resume missing from candidates', async () => {
      const state = store.getState();
      const profileId = state.profileOrder[0];

      // Bind resume
      await store.bindResumeToProfile(profileId, 'resume_1');

      // Remove candidates
      await store.setResumeCandidates([]);

      // Try to apply
      await store.applyProfileResumeBinding(profileId);

      const updated = store.getState();
      expect(updated.selectedResumeHash).toBeNull();
    });

    it('should do nothing if profile has no binding', async () => {
      const state = store.getState();
      const profileId = state.profileOrder[0];

      await store.selectResume('resume_1');
      await store.applyProfileResumeBinding(profileId);

      const updated = store.getState();
      expect(updated.selectedResumeHash).toBe('resume_1'); // Unchanged
    });
  });

  describe('setActiveProfile auto-applies binding', () => {
    beforeEach(async () => {
      await store.setResumeCandidates(mockResumes);
    });

    it('should auto-apply bound resume when selecting profile', async () => {
      const profileId = await store.createProfile({ name: 'Test Profile' });
      await store.bindResumeToProfile(profileId, 'resume_2');

      await store.setActiveProfile(profileId);

      const state = store.getState();
      expect(state.selectedResumeHash).toBe('resume_2');
    });

    it('should not fake selection if bound resume missing', async () => {
      const profileId = await store.createProfile({ name: 'Test Profile' });
      await store.bindResumeToProfile(profileId, 'resume_1');

      // Remove candidates
      await store.setResumeCandidates([]);

      await store.setActiveProfile(profileId);

      const state = store.getState();
      expect(state.selectedResumeHash).toBeNull();
    });
  });

  describe('resume persistence', () => {
    it('should survive store recreation', async () => {
      await store.setResumeCandidates(mockResumes);
      await store.selectResume('resume_2');

      // Create new store with same storage
      const newStore = new StateStore(storage);
      await newStore.init();

      const state = newStore.getState();
      expect(state.resumeCandidates).toEqual(mockResumes);
      expect(state.selectedResumeHash).toBe('resume_2');
    });
  });

  describe('selector consistency', () => {
    it('should return same selected resume after reload', async () => {
      await store.setResumeCandidates(mockResumes);
      await store.selectResume('resume_1');

      const beforeReload = getSelectedResume(store.getState());

      // Reload
      const newStore = new StateStore(storage);
      await newStore.init();

      const afterReload = getSelectedResume(newStore.getState());

      expect(afterReload).toEqual(beforeReload);
    });
  });
});
