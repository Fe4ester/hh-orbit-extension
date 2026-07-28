import type {
  QuestionType,
  Questionnaire,
  QuestionnaireOption,
  QuestionnaireQuestion,
  QuestionnaireSource,
} from '../questionnaires/types';

function normalizedText(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function attributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function fieldQuestionId(name: string): string {
  return name.replace(/_text$/, '');
}

function optionLabel(input: HTMLInputElement): string {
  const explicitLabel = input.id
    ? input.ownerDocument.querySelector(`label[for="${attributeValue(input.id)}"]`)
    : null;
  const wrappingLabel = input.closest('label');
  return normalizedText(explicitLabel ?? wrappingLabel) || input.value;
}

function detectQuestionType(fields: Array<HTMLInputElement | HTMLTextAreaElement>): QuestionType {
  if (fields.some(field => field.type === 'checkbox')) return 'multiple';
  if (fields.some(field => field.type === 'radio')) {
    const values = fields.map(field => field instanceof HTMLInputElement ? field.value.toLowerCase() : '');
    return values.length === 2 && values.every(value => ['true', 'false', 'yes', 'no', '1', '0'].includes(value))
      ? 'boolean'
      : 'single';
  }
  if (fields.some(field => field instanceof HTMLTextAreaElement || field.type === 'text')) return 'text';
  if (fields.some(field => field.type === 'number')) return 'number';
  return 'unknown';
}

function extractOptions(fields: Array<HTMLInputElement | HTMLTextAreaElement>): QuestionnaireOption[] | undefined {
  const options = fields
    .filter((field): field is HTMLInputElement => (
      field instanceof HTMLInputElement &&
      (field.type === 'radio' || field.type === 'checkbox')
    ))
    .map(field => ({ value: field.value, label: optionLabel(field) }));
  return options.length > 0 ? options : undefined;
}

function questionPrompt(
  doc: Document,
  questionId: string,
  fields: Array<HTMLInputElement | HTMLTextAreaElement>,
): string {
  const container = fields[0]?.closest('[data-qa="task-body"], fieldset, [class*="task"]');
  const prompt = normalizedText(
    container?.querySelector('[data-qa="task-question"], legend, h2, h3, h4')
  );
  if (prompt) return prompt;

  const labelledField = fields.find(field => field.id && doc.querySelector(`label[for="${attributeValue(field.id)}"]`));
  if (labelledField?.id) {
    const label = doc.querySelector(`label[for="${attributeValue(labelledField.id)}"]`);
    const text = normalizedText(label);
    if (text) return text;
  }
  return questionId;
}

export function extractQuestionnaire(
  doc: Document,
  options: {
    vacancyId: string;
    source?: QuestionnaireSource;
    detectedAt?: number;
  },
): Questionnaire {
  const fields = Array.from(
    doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[name^="task_"]:not([type="hidden"]), textarea[name^="task_"]'
    )
  );
  const grouped = new Map<string, Array<HTMLInputElement | HTMLTextAreaElement>>();

  for (const field of fields) {
    const questionId = fieldQuestionId(field.name);
    const current = grouped.get(questionId) ?? [];
    current.push(field);
    grouped.set(questionId, current);
  }

  const questions: QuestionnaireQuestion[] = Array.from(grouped, ([id, questionFields]) => ({
    id,
    type: detectQuestionType(questionFields),
    prompt: questionPrompt(doc, id, questionFields),
    required: questionFields.some(field => field.required || field.getAttribute('aria-required') === 'true'),
    options: extractOptions(questionFields),
    allowsCustomText: questionFields.some(
      field => field instanceof HTMLTextAreaElement || field.type === 'text'
    ) && questionFields.some(field => field instanceof HTMLInputElement && (
      field.type === 'radio' || field.type === 'checkbox'
    )),
  }));

  if (questions.length === 0) {
    throw new Error('No supported HH questionnaire fields found');
  }

  return {
    id: `hh_${options.vacancyId}_${questions.map(question => question.id).join('_')}`,
    vacancyId: options.vacancyId,
    source: options.source ?? 'hh_live',
    questions,
    detectedAt: options.detectedAt ?? Date.now(),
  };
}
