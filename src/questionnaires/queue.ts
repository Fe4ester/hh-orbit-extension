import type { AnswerPlan, Questionnaire, QuestionnaireQueueItem, QuestionnaireStatus } from './types';

const allowedTransitions: Record<QuestionnaireStatus, QuestionnaireStatus[]> = {
  detected: ['ready_for_ai', 'skipped'],
  ready_for_ai: ['generating', 'skipped'],
  generating: ['needs_review', 'failed'],
  needs_review: ['ready_for_ai', 'approved', 'skipped'],
  approved: ['needs_review', 'filled', 'skipped'],
  filled: ['submitted', 'approved'],
  submitted: [],
  failed: ['ready_for_ai', 'skipped'],
  skipped: ['ready_for_ai'],
};

export function enqueueQuestionnaire(questionnaire: Questionnaire, now: number = Date.now()): QuestionnaireQueueItem {
  return { questionnaire, status: 'detected', updatedAt: now };
}

export function transitionQuestionnaire(
  item: QuestionnaireQueueItem,
  status: QuestionnaireStatus,
  now: number = Date.now(),
): QuestionnaireQueueItem {
  if (!allowedTransitions[item.status].includes(status)) {
    throw new Error(`Cannot transition questionnaire from ${item.status} to ${status}`);
  }
  return { ...item, status, updatedAt: now, error: status === 'failed' ? item.error : undefined };
}

export function attachAnswerPlan(
  item: QuestionnaireQueueItem,
  answerPlan: AnswerPlan,
  now: number = Date.now(),
): QuestionnaireQueueItem {
  if (item.status !== 'generating') {
    throw new Error('Answer plans can only be attached while generating');
  }
  if (answerPlan.questionnaireId !== item.questionnaire.id) {
    throw new Error('Answer plan belongs to a different questionnaire');
  }
  return { ...item, answerPlan, status: 'needs_review', updatedAt: now };
}

export function failQuestionnaire(
  item: QuestionnaireQueueItem,
  error: string,
  now: number = Date.now(),
): QuestionnaireQueueItem {
  if (item.status !== 'generating') {
    throw new Error('Only a generating questionnaire can fail');
  }
  return { ...item, status: 'failed', error, updatedAt: now };
}
