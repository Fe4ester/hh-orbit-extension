import type { ManualAction } from '../state/types';
import type { QuestionnaireQueueItem } from './types';

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
