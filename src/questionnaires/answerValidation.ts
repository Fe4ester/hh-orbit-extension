import type {
  CandidateContext,
  CandidateEvidence,
  Questionnaire,
  SuggestedAnswer,
} from './types';

function scalarText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

const SUPPORT_STOP_WORDS = new Set([
  'answer', 'describe', 'experience', 'familiar', 'have', 'know', 'no', 'please', 'yes',
  'ваш', 'ваша', 'ваше', 'ваши', 'вам', 'вы', 'да', 'есть', 'знакомы', 'или',
  'как', 'ли', 'нет', 'опишите', 'опыт', 'пожалуйста', 'расскажите', 'что',
]);

function supportWords(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase('ru')
      .match(/[\p{L}\p{N}+#.-]+/gu)
      ?.filter(word => word.length >= 3 && !SUPPORT_STOP_WORDS.has(word))
      .map(word => word.length > 4 ? word.slice(0, 4) : word) ?? []
  );
}

function evidenceSupportsChoice(
  reference: string,
  question: Questionnaire['questions'][number],
  selectedValues: string[]
): boolean {
  const selected = new Set(selectedValues);
  const subject = supportWords([
    question.prompt,
    ...(question.options
      ?.filter(option => selected.has(option.value))
      .map(option => option.label) ?? []),
  ].join(' '));
  if (subject.size === 0) return true;
  const evidence = supportWords(reference);
  return [...subject].some(word => evidence.has(word));
}

function evidenceSource(value: unknown): CandidateEvidence['source'] | null {
  if (value === 'resume' || value === 'profile' || value === 'saved_answer') return value;
  if (
    value === 'user_instruction'
    || value === 'legend'
    || value === 'legendFile'
    || value === 'instruction'
  ) {
    return 'user_instruction';
  }
  return null;
}

function inferredSalaryValue(evidence: CandidateEvidence[]): string | null {
  for (const item of evidence) {
    const match = item.reference.match(
      /\[INFERRED DEFAULT — REVIEW REQUIRED\]\s*salary_expectation:\s*(.+?)(?:\.\s*Основание:|$)/iu
    );
    if (match?.[1]?.trim()) return match[1].trim().replace(/[.\s]+$/u, '');
  }
  return null;
}

function normalizeRawAnswer(value: unknown): Record<string, unknown> | null {
  const directText = scalarText(value);
  if (directText !== undefined) return { text: directText };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const text = scalarText(source.text)
    ?? scalarText(source.answer)
    ?? scalarText(source.response)
    ?? scalarText(source.value);
  const selectedValues = source.selectedValues ?? source.selected_values;
  return {
    ...source,
    ...(text !== undefined ? { text } : {}),
    ...(selectedValues !== undefined ? { selectedValues } : {}),
  };
}

function normalizeAnswerArray(
  payload: unknown,
  questionnaire: Questionnaire
): Record<string, unknown>[] | null {
  let values: unknown[] | null = null;
  if (Array.isArray(payload)) {
    values = payload;
  } else if (payload && typeof payload === 'object') {
    const source = payload as Record<string, unknown>;
    const collection = source.answers ?? source.responses;
    if (Array.isArray(collection)) {
      values = collection;
    } else if (collection !== undefined) {
      if (collection && typeof collection === 'object') {
        const normalizedCollection = normalizeRawAnswer(collection);
        values = normalizedCollection
          && (
            normalizedCollection.text !== undefined
            || normalizedCollection.selectedValues !== undefined
          )
          ? [collection]
          : Object.values(collection);
      } else {
        values = [collection];
      }
    } else {
      const singular = source.answer ?? source.response ?? source.result;
      if (singular !== undefined) {
        values = Array.isArray(singular) ? singular : [singular];
      } else if (
        source.text !== undefined
        || source.selectedValues !== undefined
        || source.selected_values !== undefined
      ) {
        values = [source];
      } else if (questionnaire.questions.length === 1) {
        const scalarValues = Object.entries(source)
          .filter(([key]) => !['error', 'message', 'reason'].includes(key.toLowerCase()))
          .map(([, value]) => value)
          .filter(value => scalarText(value) !== undefined);
        if (scalarValues.length > 0) values = scalarValues;
      }
    }
  }
  if (!values) return null;

  const normalized = values
    .map(normalizeRawAnswer)
    .filter((answer): answer is Record<string, unknown> => answer !== null);
  if (questionnaire.questions.length === 1 && normalized.length > 1) {
    const textParts = normalized.map(answer => scalarText(answer.text));
    if (textParts.every((text): text is string => text !== undefined)) {
      return [{
        text: textParts.map((text, index) => `${index + 1}. ${text}`).join('\n\n'),
      }];
    }
  }
  return normalized;
}

function reviewAnswer(
  question: Questionnaire['questions'][number],
  warning = 'AI-модель не смогла подготовить корректный ответ'
): SuggestedAnswer {
  return {
    questionId: question.id,
    selectedValues: question.options ? [] : undefined,
    text: question.type === 'text' || question.type === 'number'
      ? 'Требуется уточнение перед отправкой'
      : undefined,
    confidence: 0,
    evidence: [],
    requiresReview: true,
    warning,
  };
}

function validateRawAnswer(
  rawAnswer: Record<string, unknown>,
  index: number,
  questionnaire: Questionnaire,
  questions: Map<string, Questionnaire['questions'][number]>,
  seen: Set<string>,
  contextText: string
): SuggestedAnswer {
  const candidate = rawAnswer as Partial<SuggestedAnswer>;
  const questionId = candidate.questionId ?? questionnaire.questions[index]?.id;
  if (!questionId || !questions.has(questionId)) {
    throw new Error('AI answer references an unknown question');
  }
  if (seen.has(questionId)) {
    throw new Error(`AI response contains duplicate answer for ${questionId}`);
  }
  seen.add(questionId);

  const question = questions.get(questionId)!;
  const options = question.options ?? [];
  const optionByValue = new Map(options.map(option => [option.value, option.value]));
  const optionByLabel = new Map(options.map(option => [
    option.label.trim().toLocaleLowerCase('ru'),
    option.value,
  ]));
  if (
    candidate.selectedValues !== undefined
    && (
      !Array.isArray(candidate.selectedValues)
      || candidate.selectedValues.some(value => typeof value !== 'string')
    )
  ) {
    throw new Error(`AI answer contains an invalid option for ${questionId}`);
  }
  const selectedValues = candidate.selectedValues?.map(value =>
    optionByValue.get(value)
    ?? optionByLabel.get(value.trim().toLocaleLowerCase('ru'))
  );
  if (selectedValues?.some(value => !value)) {
    throw new Error(`AI answer contains an invalid option for ${questionId}`);
  }

  const confidence = typeof candidate.confidence === 'number'
    ? Math.min(1, Math.max(0, candidate.confidence))
    : 0;
  const exactEvidence = Array.isArray(candidate.evidence)
    ? candidate.evidence.flatMap(item => {
        const source = evidenceSource(item?.source);
        if (
          !source
          || typeof item?.reference !== 'string'
          || item.reference.trim().length < 4
          || !contextText.includes(item.reference.trim().toLocaleLowerCase('ru'))
        ) {
          return [];
        }
        return [{ source, reference: item.reference.trim() }];
      })
    : [];
  const evidence = options.length > 0 && selectedValues?.length
    ? exactEvidence.filter(item =>
        evidenceSupportsChoice(item.reference, question, selectedValues as string[])
      )
    : exactEvidence;
  if (options.length > 0 && selectedValues?.length && evidence.length === 0) {
    return reviewAnswer(question, 'Выбор модели не подтверждён резюме или легендой');
  }
  const unresolved = selectedValues?.length === 0
    && (!candidate.text || candidate.text.includes('Требуется уточнение'));
  const usesInferredDefault = evidence.some(item =>
    item.reference.includes('INFERRED DEFAULT — REVIEW REQUIRED')
  );
  const salaryValue = inferredSalaryValue(evidence);

  return {
    questionId,
    selectedValues: selectedValues as string[] | undefined,
    text: salaryValue
      ? `Ожидаемый уровень дохода: ${salaryValue}.`
      : typeof candidate.text === 'string'
        ? candidate.text
        : undefined,
    confidence: usesInferredDefault
      ? Math.min(confidence, 0.65)
      : evidence.length > 0
        ? confidence
        : Math.min(confidence, 0.5),
    evidence,
    requiresReview: true,
    warning: typeof candidate.warning === 'string'
      ? candidate.warning
      : usesInferredDefault
        ? 'Профильное предположение — проверьте перед отправкой'
        : unresolved
        ? 'Недостаточно данных в резюме и легенде'
        : undefined,
  };
}

export function validateAnswers(
  payload: unknown,
  questionnaire: Questionnaire,
  context: CandidateContext
): SuggestedAnswer[] {
  const rawAnswers = normalizeAnswerArray(payload, questionnaire);
  if (!rawAnswers) {
    const keys = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? Object.keys(payload as Record<string, unknown>).slice(0, 8).join(', ')
      : typeof payload;
    throw new Error(`AI response does not contain usable answers (shape: ${keys || 'empty'})`);
  }

  const questions = new Map(questionnaire.questions.map(question => [question.id, question]));
  const seen = new Set<string>();
  const contextText = JSON.stringify(context).toLocaleLowerCase('ru');
  const byQuestionId = new Map(
    rawAnswers
      .filter(answer => typeof answer.questionId === 'string')
      .map(answer => [answer.questionId as string, answer])
  );

  return questionnaire.questions.map((question, index) => {
    const rawAnswer = byQuestionId.get(question.id) ?? rawAnswers[index];
    if (!rawAnswer) return reviewAnswer(question, 'Модель не подготовила ответ');
    try {
      return validateRawAnswer(
        rawAnswer,
        index,
        questionnaire,
        questions,
        seen,
        contextText
      );
    } catch {
      return reviewAnswer(question);
    }
  });
}

export function unansweredReviewPlan(questionnaire: Questionnaire): SuggestedAnswer[] {
  return questionnaire.questions.map(question => reviewAnswer(question));
}
