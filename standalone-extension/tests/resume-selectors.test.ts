// Resume selectors tests

import { describe, it, expect } from 'vitest';
import {
  getResumeCandidates,
  getSelectedResume,
  getActiveProfileBoundResume,
  isSelectedResumeAvailable,
} from '../src/state/selectors';
import { AppState, ResumeCandidate } from '../src/state/types';
import { INITIAL_STATE } from '../src/state/types';

describe('Resume Selectors', () => {
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

  const mockState: AppState = {
    ...INITIAL_STATE,
    activeProfileId: 'p1',
    profiles: {
      p1: {
        id: 'p1',
        name: 'Test Profile',
        keywordsInclude: [],
        keywordsExclude: [],
        experience: [],
        schedule: [],
        employment: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    profileOrder: ['p1'],
    resumeCandidates: mockResumes,
    selectedResumeHash: 'resume_1',
  };

  describe('getResumeCandidates', () => {
    it('should return all resume candidates', () => {
      const candidates = getResumeCandidates(mockState);
      expect(candidates).toEqual(mockResumes);
    });

    it('should return empty array if no candidates', () => {
      const state = { ...mockState, resumeCandidates: [] };
      const candidates = getResumeCandidates(state);
      expect(candidates).toEqual([]);
    });
  });

  describe('getSelectedResume', () => {
    it('should return selected resume', () => {
      const resume = getSelectedResume(mockState);
      expect(resume).toEqual(mockResumes[0]);
    });

    it('should return null if no selection', () => {
      const state = { ...mockState, selectedResumeHash: null };
      const resume = getSelectedResume(state);
      expect(resume).toBeNull();
    });

    it('should return null if selected resume not in candidates', () => {
      const state = { ...mockState, selectedResumeHash: 'non_existent' };
      const resume = getSelectedResume(state);
      expect(resume).toBeNull();
    });
  });

  describe('getActiveProfileBoundResume', () => {
    it('should return bound resume from active profile', () => {
      const profileId = mockState.activeProfileId as string;
      const state: AppState = {
        ...mockState,
        profiles: {
          ...mockState.profiles,
          [profileId]: {
            ...mockState.profiles[profileId],
            selectedResumeHash: 'resume_2',
          },
        },
      };

      const resume = getActiveProfileBoundResume(state);
      expect(resume).toEqual(mockResumes[1]);
    });

    it('should return null if profile has no binding', () => {
      const resume = getActiveProfileBoundResume(mockState);
      expect(resume).toBeNull();
    });

    it('should return null if no active profile', () => {
      const state = { ...mockState, activeProfileId: null };
      const resume = getActiveProfileBoundResume(state);
      expect(resume).toBeNull();
    });
  });

  describe('isSelectedResumeAvailable', () => {
    it('should return true if selected resume exists', () => {
      expect(isSelectedResumeAvailable(mockState)).toBe(true);
    });

    it('should return false if no selection', () => {
      const state = { ...mockState, selectedResumeHash: null };
      expect(isSelectedResumeAvailable(state)).toBe(false);
    });

    it('should return false if selected resume not in candidates', () => {
      const state = { ...mockState, selectedResumeHash: 'missing' };
      expect(isSelectedResumeAvailable(state)).toBe(false);
    });
  });

  describe('consistency between Home and Profiles', () => {
    it('should return same selected resume for both views', () => {
      // Home view
      const homeResume = getSelectedResume(mockState);

      // Profiles view
      const profilesResume = getSelectedResume(mockState);

      expect(homeResume).toEqual(profilesResume);
    });
  });
});
