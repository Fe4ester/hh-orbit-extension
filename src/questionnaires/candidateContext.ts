import type { CandidateContext } from './types';

interface CandidateProfileContext {
  name: string;
  keywordsInclude: string[];
  coverLetterTemplate?: string;
}

interface VacancyContext {
  vacancyId: string;
  vacancyTitle?: string;
  company?: string;
}

interface BuildCandidateContextInput {
  stored: CandidateContext;
  resumeFacts: string[];
  profile?: CandidateProfileContext;
  vacancy: VacancyContext;
  legendFile: CandidateContext['legendFile'];
}

export function buildCandidateContext(input: BuildCandidateContextInput): CandidateContext {
  const profileFacts = [...input.stored.profileFacts];
  if (input.profile) {
    profileFacts.push(`Профиль поиска: ${input.profile.name}`);
    if (input.profile.keywordsInclude.length > 0) {
      profileFacts.push(`Целевые направления: ${input.profile.keywordsInclude.join(', ')}`);
    }
    if (input.profile.coverLetterTemplate?.trim()) {
      profileFacts.push(`Сопроводительное письмо профиля:\n${input.profile.coverLetterTemplate.trim()}`);
    }
  }

  const vacancyFacts = [
    `Идентификатор вакансии HH: ${input.vacancy.vacancyId}`,
    input.vacancy.vacancyTitle?.trim()
      ? `Название вакансии: ${input.vacancy.vacancyTitle.trim()}`
      : '',
    input.vacancy.company?.trim()
      ? `Работодатель: ${input.vacancy.company.trim()}`
      : '',
  ].filter(Boolean);

  return {
    ...input.stored,
    vacancyFacts,
    resumeFacts: [...input.resumeFacts],
    profileFacts,
    savedAnswers: input.stored.savedAnswers.map(answer => ({ ...answer })),
    legendFile: input.legendFile,
  };
}
