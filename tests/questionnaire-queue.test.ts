import {
  attachAnswerPlan,
  enqueueQuestionnaire,
  failQuestionnaire,
  transitionQuestionnaire,
  type Questionnaire,
} from '../src/questionnaires';

const questionnaire: Questionnaire = {
  id: 'questionnaire_1',
  vacancyId: 'vacancy_1',
  source: 'hh_live',
  detectedAt: 1,
  questions: [{ id: 'q_1', type: 'text', prompt: 'Tell us about your experience', required: true }],
};

describe('questionnaire queue', () => {
  it('requires review after an answer plan is generated', () => {
    const detected = enqueueQuestionnaire(questionnaire, 1);
    const ready = transitionQuestionnaire(detected, 'ready_for_ai', 2);
    const generating = transitionQuestionnaire(ready, 'generating', 3);
    const item = attachAnswerPlan(generating, {
      questionnaireId: questionnaire.id,
      providerId: 'local',
      modelId: 'test-model',
      generatedAt: 4,
      answers: [{ questionId: 'q_1', text: 'Draft', confidence: 0.9, evidence: [], requiresReview: true }],
    }, 4);

    expect(item.status).toBe('needs_review');
    expect(item.answerPlan?.answers).toHaveLength(1);
  });

  it('does not permit submit without explicit approval and fill stages', () => {
    const item = enqueueQuestionnaire(questionnaire);
    expect(() => transitionQuestionnaire(item, 'submitted')).toThrow('Cannot transition');
  });

  it('does not permit filling directly from review', () => {
    const ready = transitionQuestionnaire(enqueueQuestionnaire(questionnaire), 'ready_for_ai');
    const generating = transitionQuestionnaire(ready, 'generating');
    const review = attachAnswerPlan(generating, {
      questionnaireId: questionnaire.id,
      providerId: 'local',
      modelId: 'test-model',
      generatedAt: 4,
      answers: [],
    });

    expect(() => transitionQuestionnaire(review, 'filled')).toThrow('Cannot transition');
  });

  it('allows a failed generation to be retried', () => {
    const ready = transitionQuestionnaire(enqueueQuestionnaire(questionnaire), 'ready_for_ai');
    const generating = transitionQuestionnaire(ready, 'generating');
    const failed = failQuestionnaire(generating, 'timeout');
    expect(transitionQuestionnaire(failed, 'ready_for_ai').status).toBe('ready_for_ai');
  });

  it('allows a review draft to be regenerated', () => {
    const ready = transitionQuestionnaire(enqueueQuestionnaire(questionnaire), 'ready_for_ai');
    const generating = transitionQuestionnaire(ready, 'generating');
    const review = attachAnswerPlan(generating, {
      questionnaireId: questionnaire.id,
      providerId: 'local',
      modelId: 'test-model',
      generatedAt: 4,
      answers: [],
    });

    expect(transitionQuestionnaire(review, 'ready_for_ai').status).toBe('ready_for_ai');
  });
});
