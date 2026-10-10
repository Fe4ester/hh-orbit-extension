import { describe, expect, it } from 'vitest';
import { buildCandidateContext } from '../src/questionnaires/candidateContext';
import { buildAnswerPrompt } from '../src/questionnaires/answerPrompt';
import { compactCandidateContext } from '../src/questionnaires/contextCompactor';
import type { CandidateContext, Questionnaire } from '../src/questionnaires/types';

const stored: CandidateContext = {
  resumeFacts: ['устаревшее резюме'],
  profileFacts: ['Подтверждённый факт профиля'],
  savedAnswers: [{ prompt: 'Готовы к удалённой работе?', answer: 'Да' }],
  instructions: 'Отвечать кратко и по-русски',
  legendFile: { name: 'legend.md', content: 'Python-разработчик', loadedAt: 1 },
};

const questionnaire: Questionnaire = {
  id: 'q-1',
  vacancyId: '123',
  source: 'hh_backend',
  questions: [{ id: 'work-format', type: 'text', prompt: 'Какой формат работы вам подходит?', required: true }],
  detectedAt: 1,
};

describe('candidate context', () => {
  it('combines vacancy, current resume, profile, legend, instructions, and approved answer memory', () => {
    const context = buildCandidateContext({
      stored,
      resumeFacts: ['Резюме HH: пять лет Python'],
      profile: {
        name: 'Python backend',
        keywordsInclude: ['Python', 'FastAPI'],
        coverLetterTemplate: 'Здравствуйте. Работаю с Python.',
      },
      vacancy: { vacancyId: '123', vacancyTitle: 'Senior Python', company: 'Example' },
      legendFile: stored.legendFile,
    });

    expect(context).toMatchObject({
      vacancyFacts: [
        'Идентификатор вакансии HH: 123',
        'Название вакансии: Senior Python',
        'Работодатель: Example',
      ],
      resumeFacts: ['Резюме HH: пять лет Python'],
      savedAnswers: stored.savedAnswers,
      instructions: stored.instructions,
      legendFile: stored.legendFile,
    });
    expect(context.profileFacts).toEqual(expect.arrayContaining([
      'Подтверждённый факт профиля',
      'Профиль поиска: Python backend',
      'Целевые направления: Python, FastAPI',
      'Сопроводительное письмо профиля:\nЗдравствуйте. Работаю с Python.',
    ]));
    expect(stored.resumeFacts).toEqual(['устаревшее резюме']);
  });

  it('keeps source boundaries and original saved-answer prompts after compaction', () => {
    const context = buildCandidateContext({
      stored,
      resumeFacts: ['Резюме HH: пять лет Python'],
      vacancy: { vacancyId: '123', vacancyTitle: 'Senior Python' },
      legendFile: stored.legendFile,
    });
    const compacted = compactCandidateContext(context, questionnaire, 6_000).context;
    const prompt = buildAnswerPrompt(questionnaire, compacted);
    const payload = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2));

    expect(compacted.savedAnswers).toEqual(stored.savedAnswers);
    expect(compacted.instructions).toBe(stored.instructions);
    expect(payload.candidateContext).toMatchObject({
      vacancy: expect.arrayContaining(['Название вакансии: Senior Python']),
      resume: ['Резюме HH: пять лет Python'],
      saved_answer: ['Готовы к удалённой работе?\nДа'],
      user_instruction: expect.arrayContaining([
        'Отвечать кратко и по-русски',
        'Python-разработчик',
      ]),
    });
  });
});
