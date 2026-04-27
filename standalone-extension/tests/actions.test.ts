// Profile actions tests

import { describe, it, expect } from 'vitest';
import {
  createProfile,
  updateProfile,
  duplicateProfile,
  CreateProfilePayload,
} from '../src/state/actions';

describe('Profile Actions', () => {
  describe('createProfile', () => {
    it('should create profile with all fields', () => {
      const payload: CreateProfilePayload = {
        name: 'Test Profile',
        keywordsInclude: ['React', 'TypeScript'],
        keywordsExclude: ['PHP'],
        experience: ['От 3 лет'],
        schedule: ['Удаленная работа'],
        employment: ['Полная занятость'],
        coverLetterTemplate: 'Hello',
      };

      const profile = createProfile(payload);

      expect(profile.id).toBeDefined();
      expect(profile.name).toBe('Test Profile');
      expect(profile.keywordsInclude).toEqual(['React', 'TypeScript']);
      expect(profile.keywordsExclude).toEqual(['PHP']);
      expect(profile.experience).toEqual(['От 3 лет']);
      expect(profile.schedule).toEqual(['Удаленная работа']);
      expect(profile.employment).toEqual(['Полная занятость']);
      expect(profile.coverLetterTemplate).toBe('Hello');
      expect(profile.createdAt).toBeDefined();
      expect(profile.updatedAt).toBeDefined();
    });

    it('should create profile with minimal fields', () => {
      const payload: CreateProfilePayload = {
        name: 'Minimal Profile',
      };

      const profile = createProfile(payload);

      expect(profile.name).toBe('Minimal Profile');
      expect(profile.keywordsInclude).toEqual([]);
      expect(profile.keywordsExclude).toEqual([]);
      expect(profile.experience).toEqual([]);
      expect(profile.schedule).toEqual([]);
      expect(profile.employment).toEqual([]);
    });

    it('should generate unique IDs', () => {
      const profile1 = createProfile({ name: 'Profile 1' });
      const profile2 = createProfile({ name: 'Profile 2' });

      expect(profile1.id).not.toBe(profile2.id);
    });
  });

  describe('updateProfile', () => {
    it('should update profile fields', async () => {
      const original = createProfile({ name: 'Original' });

      // Wait to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = updateProfile(original, { name: 'Updated' });

      expect(updated.name).toBe('Updated');
      expect(updated.id).toBe(original.id);
      expect(updated.updatedAt).toBeGreaterThan(original.updatedAt);
    });

    it('should preserve unchanged fields', () => {
      const original = createProfile({
        name: 'Original',
        keywordsInclude: ['React'],
      });

      const updated = updateProfile(original, { name: 'Updated' });

      expect(updated.keywordsInclude).toEqual(['React']);
    });
  });

  describe('duplicateProfile', () => {
    it('should create copy with new ID', () => {
      const original = createProfile({
        name: 'Original',
        keywordsInclude: ['React'],
      });

      const duplicate = duplicateProfile(original);

      expect(duplicate.id).not.toBe(original.id);
      expect(duplicate.name).toBe('Copy of Original');
      expect(duplicate.keywordsInclude).toEqual(['React']);
    });

    it('should have new timestamps', () => {
      const original = createProfile({ name: 'Original' });
      const duplicate = duplicateProfile(original);

      expect(duplicate.createdAt).toBeGreaterThanOrEqual(original.createdAt);
      expect(duplicate.updatedAt).toBeGreaterThanOrEqual(original.updatedAt);
    });
  });
});
