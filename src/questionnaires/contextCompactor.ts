import type { CandidateContext, Questionnaire } from './types';

export const MAX_CONTEXT_CHARS = 14_000;
export const MAX_GENERATION_CONTEXT_CHARS = 6_000;
const MAX_CHUNK_CHARS = 700;
const MIN_WORD_LENGTH = 3;
const STOP_WORDS = new Set([
  'and', 'are', 'for', 'from', 'have', 'how', 'the', 'this', 'what', 'with',
  'ваш', 'ваша', 'ваше', 'ваши', 'для', 'есть', 'или', 'как', 'какой', 'какая',
  'какие', 'опишите', 'пожалуйста', 'при', 'про', 'что', 'это',
]);

interface ContextChunk {
  source: 'vacancy' | 'resume' | 'profile' | 'saved_answer' | 'instruction' | 'legend';
  text: string;
  order: number;
  score: number;
  savedAnswer?: CandidateContext['savedAnswers'][number];
}

export interface CompactedCandidateContext {
  context: CandidateContext;
  originalChars: number;
  compactedChars: number;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase('ru')
      .match(/[\p{L}\p{N}+#.-]+/gu)
      ?.filter(word => word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word)) ?? []
  );
}

function splitText(text: string): string[] {
  const paragraphs = text
    .replace(/\r/g, '')
    .split(/\n{2,}|(?<=[.!?])\s+(?=[\p{Lu}\d#*-])/u)
    .map(part => part.trim())
    .filter(Boolean);

  return paragraphs.flatMap(paragraph => {
    if (paragraph.length <= MAX_CHUNK_CHARS) return [paragraph];
    const chunks: string[] = [];
    for (let offset = 0; offset < paragraph.length; offset += MAX_CHUNK_CHARS) {
      chunks.push(paragraph.slice(offset, offset + MAX_CHUNK_CHARS).trim());
    }
    return chunks.filter(Boolean);
  });
}

function sourceChunks(context: CandidateContext): ContextChunk[] {
  let order = 0;
  const chunks: ContextChunk[] = [];
  const append = (
    source: ContextChunk['source'],
    values: string[]
  ) => {
    for (const value of values.flatMap(splitText)) {
      chunks.push({ source, text: value, order: order++, score: 0 });
    }
  };

  append('vacancy', context.vacancyFacts ?? []);
  append('resume', context.resumeFacts);
  append('profile', context.profileFacts);
  for (const savedAnswer of context.savedAnswers) {
    chunks.push({
      source: 'saved_answer',
      text: `${savedAnswer.prompt}\n${savedAnswer.answer}`,
      order: order++,
      score: 0,
      savedAnswer,
    });
  }
  if (context.instructions?.trim()) append('instruction', [context.instructions]);
  const legendContent = context.legendFile?.artifact?.content ?? context.legendFile?.content;
  if (legendContent?.trim()) {
    append('legend', [legendContent]);
  }
  return chunks;
}

function scoreChunks(chunks: ContextChunk[], questionnaire: Questionnaire): ContextChunk[] {
  const query = words(questionnaire.questions.flatMap(question => [
    question.prompt,
    ...(question.options?.map(option => option.label) ?? []),
  ]).join(' '));

  return chunks.map(chunk => {
    const chunkWords = words(chunk.text);
    let overlap = 0;
    for (const word of query) {
      if (chunkWords.has(word)) overlap += 1;
    }
    const sourcePriority = chunk.source === 'resume'
      ? 4
      : chunk.source === 'vacancy'
        ? 3
        : chunk.source === 'legend' || chunk.source === 'instruction' ? 2 : 1;
    return {
      ...chunk,
      score: overlap * 100 + sourcePriority - chunk.order / 10_000,
    };
  });
}

function selectChunks(chunks: ContextChunk[], maxContextChars: number): ContextChunk[] {
  const selected: ContextChunk[] = [];
  const selectedOrders = new Set<number>();
  let usedChars = 0;

  const add = (chunk: ContextChunk) => {
    if (selectedOrders.has(chunk.order)) return;
    const cost = chunk.text.length + 2;
    if (selected.length > 0 && usedChars + cost > maxContextChars) return;
    selected.push(chunk);
    selectedOrders.add(chunk.order);
    usedChars += cost;
  };

  for (const source of ['vacancy', 'resume', 'legend', 'instruction', 'profile', 'saved_answer'] as const) {
    const first = chunks.find(chunk => chunk.source === source);
    if (first) add(first);
  }
  for (const chunk of [...chunks].sort((a, b) => b.score - a.score || a.order - b.order)) {
    add(chunk);
  }
  return selected.sort((a, b) => a.order - b.order);
}

function textFor(selected: ContextChunk[], source: ContextChunk['source']): string[] {
  return selected.filter(chunk => chunk.source === source).map(chunk => chunk.text);
}

export function compactCandidateContext(
  context: CandidateContext,
  questionnaire: Questionnaire,
  maxContextChars = MAX_CONTEXT_CHARS,
): CompactedCandidateContext {
  const chunks = sourceChunks(context);
  const selected = selectChunks(scoreChunks(chunks, questionnaire), maxContextChars);
  const legendContent = textFor(selected, 'legend').join('\n\n');
  const compacted: CandidateContext = {
    vacancyFacts: textFor(selected, 'vacancy'),
    resumeFacts: textFor(selected, 'resume'),
    profileFacts: textFor(selected, 'profile'),
    savedAnswers: selected.flatMap(chunk => chunk.savedAnswer ? [{ ...chunk.savedAnswer }] : []),
    instructions: textFor(selected, 'instruction').join('\n\n'),
    legendFile: context.legendFile
      ? { ...context.legendFile, content: legendContent }
      : null,
  };

  return {
    context: compacted,
    originalChars: JSON.stringify(context).length,
    compactedChars: JSON.stringify(compacted).length,
  };
}
