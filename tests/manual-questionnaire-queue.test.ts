import { describe, expect, it } from 'vitest';
import { createManualAnswerPlan, selectPendingManualQuestionnaires } from '../src/questionnaires';
import type { QuestionnaireQueueItem } from '../src/questionnaires';
import type { ManualAction } from '../src/state/types';

function action(overrides: Partial<ManualAction>): ManualAction {
  return {
    id: 'action',
    type: 'questionnaire',
    vacancyId: '42',
    createdAt: 1,
    status: 'pending',
    reasonCode: 'questionnaire_required',
    url: 'https://hh.ru/vacancy/42',
    ...overrides,
  };
}

describe('selectPendingManualQuestionnaires', () => {
  it('selects processable questionnaires and tests in creation order', () => {
    const result = selectPendingManualQuestionnaires([
      action({ id: 'later', type: 'test', createdAt: 20 }),
      action({ id: 'cover', type: 'cover_letter_missing', createdAt: 5 }),
      action({ id: 'done', status: 'done', createdAt: 2 }),
      action({ id: 'missing-url', url: undefined, createdAt: 3 }),
      action({ id: 'first', createdAt: 10 }),
    ]);

    expect(result.map(item => item.id)).toEqual(['first', 'later']);
  });

  it('does not offer an action that already has a draft on review', () => {
    const queued: QuestionnaireQueueItem = {
      questionnaire: {
        id: 'questionnaire-42',
        vacancyId: '42',
        source: 'hh_backend',
        detectedAt: 1,
        questions: [],
      },
      manualActionId: 'accepted',
      status: 'needs_review',
      updatedAt: 2,
    };

    const result = selectPendingManualQuestionnaires([
      action({ id: 'accepted' }),
      action({ id: 'new', vacancyId: '43' }),
    ], [queued]);

    expect(result.map(item => item.id)).toEqual(['new']);
  });
});

describe('createManualAnswerPlan', () => {
  it('creates editable blank answers without AI placeholder text', () => {
    const plan = createManualAnswerPlan({
      id: 'questionnaire-42',
      vacancyId: '42',
      source: 'hh_backend',
      detectedAt: 1,
      questions: [
        { id: 'text', type: 'text', prompt: 'Опыт', required: true },
        {
          id: 'choice',
          type: 'single',
          prompt: 'Формат',
          required: true,
          options: [{ value: 'remote', label: 'Удалённо' }],
        },
      ],
    }, 100);

    expect(plan.providerId).toBe('manual');
    expect(plan.generatedAt).toBe(100);
    expect(plan.answers).toEqual([
      expect.objectContaining({ questionId: 'text', text: '', requiresReview: true }),
      expect.objectContaining({ questionId: 'choice', selectedValues: [], requiresReview: true }),
    ]);
  });
});
