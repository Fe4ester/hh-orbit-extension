import { MAX_CONTEXT_CHARS } from './contextCompactor';
import type { CandidateContext, Questionnaire, SuggestedAnswer } from './types';

export interface AnswerMemoryEntry {
  prompt: string;
  answer: string;
}

export interface AnswerMemoryPolicy {
  rememberNewAnswers: boolean;
  updateRememberedAnswers: boolean;
}

const PLACEHOLDER_ANSWERS = new Set([
  '-', '—', 'n/a', 'нет ответа', 'требуется уточнение',
  'требуется уточнение перед отправкой',
]);

export function normalizeMemoryQuestion(prompt: string): string {
  return prompt.normalize('NFKC').toLocaleLowerCase('ru').match(/[\p{L}\p{N}]+/gu)?.join(' ') ?? '';
}

export function isPlaceholderAnswerText(value: string | undefined): boolean {
  if (!value?.trim()) return true;
  return PLACEHOLDER_ANSWERS.has(value.trim().toLocaleLowerCase('ru').replace(/[.!]+$/u, ''));
}

export function answerMemoryEntries(
  questionnaire: Questionnaire,
  answers: SuggestedAnswer[]
): AnswerMemoryEntry[] {
  const answersByQuestion = new Map(answers.map(answer => [answer.questionId, answer]));
  return questionnaire.questions.flatMap(question => {
    const answer = answersByQuestion.get(question.id);
    if (!answer) return [];
    const selected = new Set(answer.selectedValues ?? []);
    const choiceText = question.options
      ?.filter(option => selected.has(option.value))
      .map(option => option.label)
      .join(', ');
    const value = answer.text?.trim() || choiceText?.trim();
    return isPlaceholderAnswerText(value) ? [] : [{ prompt: question.prompt.trim(), answer: value! }];
  });
}

export function updateAnswerMemory(
  existing: AnswerMemoryEntry[],
  incoming: AnswerMemoryEntry[],
  policy: AnswerMemoryPolicy
): AnswerMemoryEntry[] {
  const result: AnswerMemoryEntry[] = [];
  const indexByQuestion = new Map<string, number>();
  for (const rawEntry of existing) {
    const entry = { prompt: rawEntry.prompt.trim(), answer: rawEntry.answer.trim() };
    const key = normalizeMemoryQuestion(entry.prompt);
    if (!key || isPlaceholderAnswerText(entry.answer)) continue;
    const existingIndex = indexByQuestion.get(key);
    if (existingIndex === undefined) {
      indexByQuestion.set(key, result.length);
      result.push(entry);
    } else {
      result[existingIndex] = entry;
    }
  }

  for (const rawEntry of incoming) {
    const entry = { prompt: rawEntry.prompt.trim(), answer: rawEntry.answer.trim() };
    const key = normalizeMemoryQuestion(entry.prompt);
    if (!key || isPlaceholderAnswerText(entry.answer)) continue;
    const existingIndex = indexByQuestion.get(key);
    if (existingIndex !== undefined) {
      if (policy.updateRememberedAnswers) result[existingIndex] = entry;
      continue;
    }
    if (!policy.rememberNewAnswers) continue;
    indexByQuestion.set(key, result.length);
    result.push(entry);
  }

  const storedChars = () => result.reduce(
    (total, entry) => total + entry.prompt.length + entry.answer.length,
    0
  );
  while (result.length > 0 && storedChars() > MAX_CONTEXT_CHARS) result.shift();
  return result;
}

export function rememberAnswersInContext(
  context: CandidateContext,
  questionnaire: Questionnaire,
  answers: SuggestedAnswer[],
  policy: AnswerMemoryPolicy
): CandidateContext {
  return {
    ...context,
    savedAnswers: updateAnswerMemory(
      context.savedAnswers,
      answerMemoryEntries(questionnaire, answers),
      policy
    ),
  };
}
