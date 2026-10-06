import type { ManualAction } from '../state/types';
import type { AnswerPlan, Questionnaire, QuestionnaireQueueItem } from './types';

export function createManualAnswerPlan(
  questionnaire: Questionnaire,
  generatedAt: number
): AnswerPlan {
  return {
    questionnaireId: questionnaire.id,
    providerId: 'manual',
    modelId: 'manual',
    generatedAt,
    answers: questionnaire.questions.map(question => ({
      questionId: question.id,
      selectedValues: question.options ? [] : undefined,
      text: question.type === 'text' || question.type === 'number' ? '' : undefined,
      confidence: 0,
      evidence: [],
      requiresReview: true,
    })),
  };
}

export function selectPendingManualQuestionnaires(
  actions: ManualAction[],
  queue: QuestionnaireQueueItem[] = []
): ManualAction[] {
  const acceptedActionIds = new Set(
    queue
      .filter(item => item.status !== 'failed')
      .map(item => item.manualActionId)
      .filter((id): id is string => Boolean(id))
  );
  return actions
    .filter(action =>
      action.status === 'pending'
      && (action.type === 'questionnaire' || action.type === 'test')
      && Boolean(action.url)
      && !acceptedActionIds.has(action.id)
    )
    .sort((left, right) => left.createdAt - right.createdAt);
}
