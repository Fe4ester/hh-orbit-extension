import type { ResumeCandidate } from '../state/types';

export function formatResumeLabel(resume: ResumeCandidate): string {
  return [
    resume.title,
    resume.isActive === false ? '(неактивно)' : null,
    resume.source === 'demo' ? '[DEMO]' : null,
  ].filter(Boolean).join(' ');
}
