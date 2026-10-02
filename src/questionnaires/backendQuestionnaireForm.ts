import type {
  AnswerPlan,
  Questionnaire,
  QuestionnaireOption,
  QuestionnaireQuestion,
  QuestionType,
} from './types';

interface BackendFormField {
  name: string;
  type: string;
  value: string;
  id?: string;
  required: boolean;
  position: number;
}

export interface BackendQuestionnaireFormContract {
  questionnaire: Questionnaire;
  sourceUrl: string;
  actionUrl: string;
  hiddenFields: Array<{ name: string; value: string }>;
  submitFields: Array<{ name: string; value: string }>;
  fields: BackendFormField[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

function decodeHtml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === '#') {
      const radix = code[1]?.toLowerCase() === 'x' ? 16 : 10;
      const digits = radix === 16 ? code.slice(2) : code.slice(1);
      const point = Number.parseInt(digits, radix);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });
}

export function extractBackendPageText(value: string): string {
  return decodeHtml(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function attributes(tag: string): Record<string, string> {
  const body = tag
    .replace(/^<\s*\/?\s*[^\s>]+/, '')
    .replace(/\/?>\s*$/, '');
  const result: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of body.matchAll(pattern)) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wrappingLabel(formHtml: string, field: BackendFormField): string {
  if (field.id) {
    const explicit = new RegExp(
      `<label\\b[^>]*for=["']${escapeRegExp(field.id)}["'][^>]*>([\\s\\S]*?)<\\/label>`,
      'i'
    ).exec(formHtml);
    if (explicit) return extractBackendPageText(explicit[1]);
  }

  const opening = formHtml.lastIndexOf('<label', field.position);
  const previousClosing = formHtml.lastIndexOf('</label>', field.position);
  const closing = formHtml.indexOf('</label>', field.position);
  if (opening > previousClosing && closing >= 0) {
    return extractBackendPageText(formHtml.slice(opening, closing));
  }
  return field.value;
}

function promptBeforeField(formHtml: string, position: number): string {
  const prefix = formHtml.slice(Math.max(0, position - 8_000), position);
  const marker = /<([a-z][\w:-]*)\b[^>]*data-qa=["']task-question["'][^>]*>([\s\S]*?)<\/\1>/gi;
  const prompts = Array.from(prefix.matchAll(marker));
  const prompt = prompts[prompts.length - 1]?.[2];
  if (prompt) {
    const text = extractBackendPageText(prompt);
    if (text) return text;
  }

  const heading = /<(?:legend|h[1-6])\b[^>]*>([\s\S]*?)<\/(?:legend|h[1-6])>/gi;
  const headings = Array.from(prefix.matchAll(heading));
  const headingText = extractBackendPageText(headings[headings.length - 1]?.[1] ?? '');
  if (!headingText) throw new Error('Не удалось определить текст вопроса HH');
  return headingText;
}

function questionType(fields: BackendFormField[]): QuestionType {
  if (fields.some(field => field.type === 'checkbox')) return 'multiple';
  if (fields.some(field => field.type === 'radio')) {
    const values = fields.map(field => field.value.toLowerCase());
    return values.length === 2
      && values.every(value => ['true', 'false', 'yes', 'no', '1', '0'].includes(value))
      ? 'boolean'
      : 'single';
  }
  if (fields.some(field => field.type === 'number')) return 'number';
  if (fields.some(field => field.type === 'textarea' || field.type === 'text')) return 'text';
  return 'unknown';
}

function questionOptions(
  formHtml: string,
  fields: BackendFormField[]
): QuestionnaireOption[] | undefined {
  const options = fields
    .filter(field => field.type === 'radio' || field.type === 'checkbox')
    .map(field => ({
      value: field.value,
      label: wrappingLabel(formHtml, field),
    }));
  return options.length > 0 ? options : undefined;
}

function parseFields(formHtml: string): BackendFormField[] {
  const fields: BackendFormField[] = [];
  const inputPattern = /<input\b[^>]*>/gi;
  for (const match of formHtml.matchAll(inputPattern)) {
    const attrs = attributes(match[0]);
    if (!attrs.name) continue;
    fields.push({
      name: attrs.name,
      type: (attrs.type || 'text').toLowerCase(),
      value: attrs.value || '',
      id: attrs.id,
      required: 'required' in attrs || attrs['aria-required'] === 'true',
      position: match.index ?? 0,
    });
  }

  const textareaPattern = /<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi;
  for (const match of formHtml.matchAll(textareaPattern)) {
    const openingTag = match[0].match(/^<textarea\b[^>]*>/i)?.[0] ?? '';
    const attrs = attributes(openingTag);
    if (!attrs.name) continue;
    fields.push({
      name: attrs.name,
      type: 'textarea',
      value: extractBackendPageText(match[0].replace(/^<textarea\b[^>]*>|<\/textarea>$/gi, '')),
      id: attrs.id,
      required: 'required' in attrs || attrs['aria-required'] === 'true',
      position: match.index ?? 0,
    });
  }
  return fields.sort((left, right) => left.position - right.position);
}

function questionnaireFromFields(
  formHtml: string,
  fields: BackendFormField[],
  vacancyId: string
): Questionnaire {
  const grouped = new Map<string, BackendFormField[]>();
  for (const field of fields.filter(current =>
    current.name.startsWith('task_') && current.type !== 'hidden'
  )) {
    const id = field.name.replace(/_text$/, '');
    grouped.set(id, [...(grouped.get(id) ?? []), field]);
  }

  const questions: QuestionnaireQuestion[] = Array.from(grouped, ([id, questionFields]) => ({
    id,
    type: questionType(questionFields),
    prompt: promptBeforeField(formHtml, questionFields[0].position),
    required: questionFields.some(field => field.required),
    options: questionOptions(formHtml, questionFields),
    allowsCustomText:
      questionFields.some(field => field.type === 'textarea' || field.type === 'text')
      && questionFields.some(field => field.type === 'radio' || field.type === 'checkbox'),
  }));
  if (questions.length === 0) {
    throw new Error('HH не вернул поддерживаемые поля анкеты');
  }

  return {
    id: `hh_${vacancyId}_${questions.map(question => question.id).join('_')}`,
    vacancyId,
    source: 'hh_backend',
    questions,
    detectedAt: Date.now(),
  };
}

export function parseBackendQuestionnaireForm(
  html: string,
  sourceUrl: string,
  vacancyId: string
): BackendQuestionnaireFormContract {
  const forms = Array.from(html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi));
  const form = forms.find(match => {
    const attrs = attributes(`<form ${match[1]}>`);
    return attrs.name === 'vacancy_response'
      || attrs.id === 'RESPONSE_MODAL_FORM_ID'
      || match[2].includes('name="task_')
      || match[2].includes("name='task_");
  });
  if (!form) throw new Error('HH не вернул форму анкеты');

  const formAttrs = attributes(`<form ${form[1]}>`);
  const formHtml = form[2];
  const fields = parseFields(formHtml);
  const questionnaire = questionnaireFromFields(formHtml, fields, vacancyId);
  const actionUrl = new URL(formAttrs.action || sourceUrl, sourceUrl).toString();
  const hiddenFields = fields
    .filter(field => field.type === 'hidden')
    .map(field => ({ name: field.name, value: field.value }));
  const submitFields = fields
    .filter(field => field.type === 'submit' && field.name)
    .map(field => ({ name: field.name, value: field.value }));

  return {
    questionnaire,
    sourceUrl,
    actionUrl,
    hiddenFields,
    submitFields,
    fields,
  };
}

export function buildBackendQuestionnaireBody(
  contract: BackendQuestionnaireFormContract,
  answerPlan: AnswerPlan,
  resumeHash: string
): FormData {
  if (answerPlan.questionnaireId !== contract.questionnaire.id) {
    throw new Error('Черновик относится к другой версии анкеты');
  }

  const body = new FormData();
  for (const field of contract.hiddenFields) {
    if (!field.name.startsWith('task_') && field.name !== 'resume_hash') {
      body.append(field.name, field.value);
    }
  }
  body.set('resume_hash', resumeHash);

  for (const question of contract.questionnaire.questions) {
    const answer = answerPlan.answers.find(candidate => candidate.questionId === question.id);
    if (!answer) {
      if (question.required) throw new Error(`Нет ответа на обязательный вопрос: ${question.prompt}`);
      continue;
    }
    const selectedValues = answer.selectedValues ?? [];
    const text = answer.text?.trim() ?? '';
    if (question.required && selectedValues.length === 0 && !text) {
      throw new Error(`Нет ответа на обязательный вопрос: ${question.prompt}`);
    }
    if (question.options?.length) {
      const allowedValues = new Set(question.options.map(option => option.value));
      if (selectedValues.some(value => !allowedValues.has(value))) {
        throw new Error(`Недопустимый вариант ответа: ${question.prompt}`);
      }
    }

    const fields = contract.fields.filter(field =>
      field.name === question.id || field.name === `${question.id}_text`
    );
    const choiceField = fields.find(field => field.type === 'radio' || field.type === 'checkbox');
    const textField = fields.find(field => field.type === 'textarea' || field.type === 'text');

    for (const selectedValue of selectedValues) {
      body.append(choiceField?.name ?? question.id, selectedValue);
    }
    if (text) {
      body.set(textField?.name ?? `${question.id}_text`, text);
    }
  }

  for (const field of contract.submitFields) {
    body.append(field.name, field.value);
  }
  return body;
}
