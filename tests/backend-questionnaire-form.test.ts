import { describe, expect, it } from 'vitest';
import {
  buildBackendQuestionnaireBody,
  parseBackendQuestionnaireForm,
  type AnswerPlan,
} from '../src/questionnaires';

const questionnaireHtml = `
  <html>
    <body>
      <form
        id="RESPONSE_MODAL_FORM_ID"
        name="vacancy_response"
        method="post"
        action="/applicant/vacancy_response"
      >
        <input type="hidden" name="_xsrf" value="fresh-xsrf">
        <input type="hidden" name="uidPk" value="user-context">
        <input type="hidden" name="guid" value="form-guid">
        <input type="hidden" name="startTime" value="123">
        <input type="hidden" name="testRequired" value="true">

        <section data-qa="task-body">
          <div data-qa="task-question">В каком городе вы живёте?</div>
          <textarea name="task_101_text" required></textarea>
        </section>

        <section data-qa="task-body">
          <div data-qa="task-question">Готовы работать удалённо?</div>
          <label><input type="radio" name="task_202" value="yes" required> Да</label>
          <label><input type="radio" name="task_202" value="no" required> Нет</label>
        </section>
      </form>
    </body>
  </html>
`;

describe('backend questionnaire form contract', () => {
  it('extracts employer questions without a browser tab', () => {
    const contract = parseBackendQuestionnaireForm(
      questionnaireHtml,
      'https://hh.ru/applicant/vacancy_response?vacancyId=42',
      '42'
    );

    expect(contract.actionUrl).toBe('https://hh.ru/applicant/vacancy_response');
    expect(contract.questionnaire).toMatchObject({
      id: 'hh_42_task_101_task_202',
      vacancyId: '42',
      source: 'hh_backend',
      questions: [
        {
          id: 'task_101',
          type: 'text',
          prompt: 'В каком городе вы живёте?',
          required: true,
        },
        {
          id: 'task_202',
          type: 'boolean',
          prompt: 'Готовы работать удалённо?',
          required: true,
          options: [
            { value: 'yes', label: 'Да' },
            { value: 'no', label: 'Нет' },
          ],
        },
      ],
    });
  });

  it('rebuilds the original HH form from an approved draft', () => {
    const contract = parseBackendQuestionnaireForm(
      questionnaireHtml,
      'https://hh.ru/applicant/vacancy_response?vacancyId=42',
      '42'
    );
    const answerPlan: AnswerPlan = {
      questionnaireId: contract.questionnaire.id,
      providerId: 'local',
      modelId: 'openrouter/free',
      generatedAt: 1,
      answers: [
        {
          questionId: 'task_101',
          text: 'Москва',
          confidence: 1,
          evidence: [{ source: 'user_instruction', reference: 'Проверено' }],
          requiresReview: false,
        },
        {
          questionId: 'task_202',
          selectedValues: ['yes'],
          confidence: 1,
          evidence: [{ source: 'user_instruction', reference: 'Проверено' }],
          requiresReview: false,
        },
      ],
    };

    const body = buildBackendQuestionnaireBody(contract, answerPlan, 'resume-hash');

    expect(body.get('_xsrf')).toBe('fresh-xsrf');
    expect(body.get('uidPk')).toBe('user-context');
    expect(body.get('guid')).toBe('form-guid');
    expect(body.get('resume_hash')).toBe('resume-hash');
    expect(body.get('task_101_text')).toBe('Москва');
    expect(body.getAll('task_202')).toEqual(['yes']);
  });

  it('rejects a stale draft for another version of the form', () => {
    const contract = parseBackendQuestionnaireForm(
      questionnaireHtml,
      'https://hh.ru/applicant/vacancy_response?vacancyId=42',
      '42'
    );
    const answerPlan: AnswerPlan = {
      questionnaireId: 'old-questionnaire',
      providerId: 'local',
      modelId: 'openrouter/free',
      generatedAt: 1,
      answers: [],
    };

    expect(() => buildBackendQuestionnaireBody(contract, answerPlan, 'resume-hash'))
      .toThrow('другой версии');
  });
});
