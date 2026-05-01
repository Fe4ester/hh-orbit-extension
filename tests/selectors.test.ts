// Profile selectors tests

import { describe, it, expect } from 'vitest';
import {
  getActiveProfile,
  getProfilesList,
  hasProfileFilters,
  formatProfileSummary,
  getActiveProfileSummary,
} from '../src/state/selectors';
import { AppState, Profile } from '../src/state/types';
import { INITIAL_STATE } from '../src/state/types';

describe('Profile Selectors', () => {
  const mockProfile: Profile = {
    id: 'profile-1',
    name: 'Test Profile',
    keywordsInclude: ['React', 'TypeScript'],
    keywordsExclude: ['PHP'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const mockState: AppState = {
    ...INITIAL_STATE,
    profiles: {
      'profile-1': mockProfile,
    },
    profileOrder: ['profile-1'],
    activeProfileId: 'profile-1',
  };

  describe('getActiveProfile', () => {
    it('should return active profile', () => {
      const profile = getActiveProfile(mockState);
      expect(profile).toEqual(mockProfile);
    });

    it('should return null if no active profile', () => {
      const state = { ...mockState, activeProfileId: null };
      const profile = getActiveProfile(state);
      expect(profile).toBeNull();
    });

    it('should return null if active profile not found', () => {
      const state = { ...mockState, activeProfileId: 'non-existent' };
      const profile = getActiveProfile(state);
      expect(profile).toBeNull();
    });
  });

  describe('getProfilesList', () => {
    it('should return profiles in order', () => {
      const profile2: Profile = {
        ...mockProfile,
        id: 'profile-2',
        name: 'Profile 2',
      };

      const state: AppState = {
        ...mockState,
        profiles: {
          'profile-1': mockProfile,
          'profile-2': profile2,
        },
        profileOrder: ['profile-2', 'profile-1'],
      };

      const profiles = getProfilesList(state);
      expect(profiles).toHaveLength(2);
      expect(profiles[0].id).toBe('profile-2');
      expect(profiles[1].id).toBe('profile-1');
    });

    it('should filter out missing profiles', () => {
      const state: AppState = {
        ...mockState,
        profileOrder: ['profile-1', 'non-existent'],
      };

      const profiles = getProfilesList(state);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].id).toBe('profile-1');
    });
  });

  describe('hasProfileFilters', () => {
    it('should return true if profile has keywords', () => {
      expect(hasProfileFilters(mockProfile)).toBe(true);
    });

    it('should return false if profile has no filters', () => {
      const emptyProfile: Profile = {
        ...mockProfile,
        keywordsInclude: [],
        keywordsExclude: [],
      };

      expect(hasProfileFilters(emptyProfile)).toBe(false);
    });
  });

  describe('formatProfileSummary', () => {
    it('should format profile summary correctly', () => {
      const summary = formatProfileSummary(mockProfile);

      expect(summary.name).toBe('Test Profile');
      expect(summary.hasFilters).toBe(true);
      expect(summary.keywordsCount).toBe(2);
      expect(summary.hasCoverLetter).toBe(false);
    });

    it('should detect cover letter', () => {
      const profileWithLetter: Profile = {
        ...mockProfile,
        coverLetterTemplate: 'Hello',
      };

      const summary = formatProfileSummary(profileWithLetter);
      expect(summary.hasCoverLetter).toBe(true);
    });
  });

  describe('getActiveProfileSummary', () => {
    it('should return summary for active profile', () => {
      const summary = getActiveProfileSummary(mockState);

      expect(summary).not.toBeNull();
      expect(summary?.name).toBe('Test Profile');
      expect(summary?.hasFilters).toBe(true);
    });

    it('should return null if no active profile', () => {
      const state = { ...mockState, activeProfileId: null };
      const summary = getActiveProfileSummary(state);

      expect(summary).toBeNull();
    });
  });

  describe('consistency between views', () => {
    it('should return same summary for same profile', () => {
      // Simulate Home view
      const homeSummary = getActiveProfileSummary(mockState);

      // Simulate Profiles view
      const profile = getActiveProfile(mockState);
      const profilesSummary = profile ? formatProfileSummary(profile) : null;

      expect(homeSummary).toEqual(profilesSummary);
    });
  });
});
