import { describe, expect, it } from 'vitest';
import { formatResumeLabel } from '../src/components/resumeLabel';
import { ResumeCandidate } from '../src/state/types';

describe('formatResumeLabel', () => {
  it('adds a stable separator before inactive status', () => {
    const resume: ResumeCandidate = {
      hash: 'inactive',
      title: 'Frontend Developer',
      isActive: false,
      source: 'hh_detected',
    };

    expect(formatResumeLabel(resume)).toBe('Frontend Developer (неактивно)');
  });

  it('adds a stable separator before demo marker', () => {
    const resume: ResumeCandidate = {
      hash: 'demo',
      title: 'Frontend Developer',
      source: 'demo',
    };

    expect(formatResumeLabel(resume)).toBe('Frontend Developer [DEMO]');
  });

  it('keeps separators between all suffixes', () => {
    const resume: ResumeCandidate = {
      hash: 'inactive-demo',
      title: 'Frontend Developer',
      isActive: false,
      source: 'demo',
    };

    expect(formatResumeLabel(resume)).toBe('Frontend Developer (неактивно) [DEMO]');
  });
});
