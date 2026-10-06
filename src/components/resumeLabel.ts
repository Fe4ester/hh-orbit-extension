import type { ResumeCandidate } from '../state/types';
import { t } from '../i18n';

export function formatResumeLabel(resume: ResumeCandidate): string {
  return [
    resume.title,
    resume.isActive === false ? t('(неактивно)') : null,
    resume.source === 'demo' ? '[DEMO]' : null,
  ].filter(Boolean).join(' ');
}
