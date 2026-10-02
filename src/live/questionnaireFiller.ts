import type {
  AnswerPlan,
  Questionnaire,
  SuggestedAnswer,
} from '../questionnaires/types';

export interface QuestionnaireFillReport {
  filledQuestionIds: string[];
  skippedQuestionIds: string[];
  errors: Array<{ questionId: string; message: string }>;
}

function attributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function dispatchFieldEvents(field: HTMLInputElement | HTMLTextAreaElement): void {
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillTextField(
  doc: Document,
  questionId: string,
  answer: SuggestedAnswer,
): boolean {
  if (answer.text === undefined) return false;
  const field = doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[name="${attributeValue(`${questionId}_text`)}"], textarea[name="${attributeValue(questionId)}"], input[name="${attributeValue(questionId)}"]`
  );
  if (!field) return false;

  const prototype = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(field, answer.text);
  dispatchFieldEvents(field);
  return true;
}

function fillChoiceFields(
  doc: Document,
  questionId: string,
  selectedValues: string[] | undefined,
): boolean {
  if (!selectedValues || selectedValues.length === 0) return false;
  const fields = Array.from(
    doc.querySelectorAll<HTMLInputElement>(`input[name="${attributeValue(questionId)}"]`)
  );
  if (fields.length === 0) return false;

  let changed = false;
  for (const field of fields) {
    const shouldSelect = selectedValues.includes(field.value);
    if (field.type === 'radio' && !shouldSelect) continue;
    if (field.checked !== shouldSelect) {
      field.checked = shouldSelect;
      dispatchFieldEvents(field);
      changed = true;
    } else if (shouldSelect) {
      changed = true;
    }
  }
  return changed;
}

export function fillQuestionnaire(
  doc: Document,
  questionnaire: Questionnaire,
  plan: AnswerPlan,
): QuestionnaireFillReport {
  if (plan.questionnaireId !== questionnaire.id) {
    throw new Error('Answer plan belongs to a different questionnaire');
  }

  const report: QuestionnaireFillReport = {
    filledQuestionIds: [],
    skippedQuestionIds: [],
    errors: [],
  };
  const questions = new Map(questionnaire.questions.map(question => [question.id, question]));

  for (const answer of plan.answers) {
    const question = questions.get(answer.questionId);
    if (!question) {
      report.errors.push({ questionId: answer.questionId, message: 'Question not found' });
      continue;
    }
    if (answer.requiresReview) {
      report.skippedQuestionIds.push(answer.questionId);
      continue;
    }

    try {
      const choiceFilled = question.type === 'single' || question.type === 'multiple' || question.type === 'boolean'
        ? fillChoiceFields(doc, question.id, answer.selectedValues)
        : false;
      const textFilled = question.type === 'text' || question.type === 'number' || question.allowsCustomText
        ? fillTextField(doc, question.id, answer)
        : false;
      const filled = choiceFilled || textFilled;
      if (filled) report.filledQuestionIds.push(answer.questionId);
      else report.errors.push({ questionId: answer.questionId, message: 'Matching field or answer not found' });
    } catch (error) {
      report.errors.push({
        questionId: answer.questionId,
        message: error instanceof Error ? error.message : 'Fill failed',
      });
    }
  }

  return report;
}
