import { fillQuestionnaire } from '../src/live/questionnaireFiller';
import type { AnswerPlan, Questionnaire } from '../src/questionnaires';

const questionnaire: Questionnaire = {
  id: 'questionnaire_1',
  vacancyId: 'vacancy_1',
  source: 'hh_live',
  detectedAt: 1,
  questions: [
    {
      id: 'task_1',
      type: 'single',
      prompt: 'Choose',
      required: true,
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
    },
    {
      id: 'task_2',
      type: 'text',
      prompt: 'Explain',
      required: true,
    },
  ],
};

function plan(): AnswerPlan {
  return {
    questionnaireId: questionnaire.id,
    providerId: 'local',
    modelId: 'model',
    generatedAt: 1,
    answers: [
      {
        questionId: 'task_1',
        selectedValues: ['yes'],
        confidence: 1,
        evidence: [{ source: 'resume', reference: 'fact' }],
        requiresReview: false,
      },
      {
        questionId: 'task_2',
        text: 'Draft answer',
        confidence: 0.9,
        evidence: [{ source: 'profile', reference: 'fact' }],
        requiresReview: false,
      },
    ],
  };
}

describe('fillQuestionnaire', () => {
  it('fills choices and text without submitting the form', () => {
    document.body.innerHTML = `
      <form>
        <input type="radio" name="task_1" value="yes">
        <input type="radio" name="task_1" value="no">
        <textarea name="task_2_text"></textarea>
        <button type="submit">Submit</button>
      </form>
    `;
    const submit = vi.fn(event => event.preventDefault());
    document.querySelector('form')!.addEventListener('submit', submit);

    const report = fillQuestionnaire(document, questionnaire, plan());

    expect(report.errors).toEqual([]);
    expect((document.querySelector('[value="yes"]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Draft answer');
    expect(report.filledQuestionIds).toEqual(['task_1', 'task_2']);
    expect(submit).not.toHaveBeenCalled();
  });

  it('skips answers that still require review', () => {
    document.body.innerHTML = '<textarea name="task_2_text"></textarea>';
    const answerPlan = plan();
    answerPlan.answers[1].requiresReview = true;

    const report = fillQuestionnaire(document, questionnaire, answerPlan);

    expect(report.skippedQuestionIds).toContain('task_2');
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('rejects a plan for another questionnaire', () => {
    const answerPlan = plan();
    answerPlan.questionnaireId = 'other';
    expect(() => fillQuestionnaire(document, questionnaire, answerPlan))
      .toThrow('different questionnaire');
  });
});
