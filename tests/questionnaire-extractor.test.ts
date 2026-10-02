import { extractQuestionnaire } from '../src/live/questionnaireExtractor';

describe('extractQuestionnaire', () => {
  it('extracts choice, open-answer, and textarea questions from HH fields', () => {
    document.body.innerHTML = `
      <form name="vacancy_response">
        <div data-qa="task-body">
          <h3 data-qa="task-question">Есть опыт с Python?</h3>
          <label><input required type="radio" name="task_101" value="yes">Да</label>
          <label><input type="radio" name="task_101" value="no">Нет</label>
          <input type="text" name="task_101_text">
        </div>
        <div data-qa="task-body">
          <h3 data-qa="task-question">Расскажите о проекте</h3>
          <textarea required name="task_202_text"></textarea>
        </div>
      </form>
    `;

    const questionnaire = extractQuestionnaire(document, {
      vacancyId: '123',
      detectedAt: 10,
    });

    expect(questionnaire.questions).toEqual([
      expect.objectContaining({
        id: 'task_101',
        type: 'single',
        prompt: 'Есть опыт с Python?',
        required: true,
        allowsCustomText: true,
        options: [
          { value: 'yes', label: 'Да' },
          { value: 'no', label: 'Нет' },
        ],
      }),
      expect.objectContaining({
        id: 'task_202',
        type: 'text',
        prompt: 'Расскажите о проекте',
        required: true,
      }),
    ]);
  });

  it('throws when no supported question fields exist', () => {
    document.body.innerHTML = '<div data-qa="vacancy-response-questionnaire"></div>';
    expect(() => extractQuestionnaire(document, { vacancyId: '123' }))
      .toThrow('No supported HH questionnaire fields found');
  });
});
