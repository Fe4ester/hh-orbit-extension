import type { CandidateContext, Questionnaire } from './types';

const MAX_CONTEXT_CHARS = 14_000;
const MAX_CHUNK_CHARS = 700;
const MIN_WORD_LENGTH = 3;
const STOP_WORDS = new Set([
  'and', 'are', 'for', 'from', 'have', 'how', 'the', 'this', 'what', 'with',
  'ваш', 'ваша', 'ваше', 'ваши', 'для', 'есть', 'или', 'как', 'какой', 'какая',
  'какие', 'опишите', 'пожалуйста', 'при', 'про', 'что', 'это',
]);

interface ContextChunk {
  source: 'resume' | 'profile' | 'saved_answer' | 'user_instruction';
  text: string;
  order: number;
  score: number;
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

  append('resume', context.resumeFacts);
  append('profile', context.profileFacts);
  append(
    'saved_answer',
    context.savedAnswers.map(item => `${item.prompt}\n${item.answer}`)
  );
  if (context.instructions?.trim()) append('user_instruction', [context.instructions]);
  const legendContent = context.legendFile?.artifact?.content ?? context.legendFile?.content;
  if (legendContent?.trim()) {
    append('user_instruction', [legendContent]);
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
    const sourcePriority = chunk.source === 'resume' ? 3 : chunk.source === 'user_instruction' ? 2 : 1;
    return {
      ...chunk,
      score: overlap * 100 + sourcePriority - chunk.order / 10_000,
    };
  });
}

function selectChunks(chunks: ContextChunk[]): ContextChunk[] {
  const selected: ContextChunk[] = [];
  const selectedOrders = new Set<number>();
  let usedChars = 0;

  const add = (chunk: ContextChunk) => {
    if (selectedOrders.has(chunk.order)) return;
    const cost = chunk.text.length + 2;
    if (selected.length > 0 && usedChars + cost > MAX_CONTEXT_CHARS) return;
    selected.push(chunk);
    selectedOrders.add(chunk.order);
    usedChars += cost;
  };

  for (const source of ['resume', 'user_instruction', 'profile', 'saved_answer'] as const) {
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
  questionnaire: Questionnaire
): CompactedCandidateContext {
  const chunks = sourceChunks(context);
  const selected = selectChunks(scoreChunks(chunks, questionnaire));
  const legendContent = textFor(selected, 'user_instruction').join('\n\n');
  const compacted: CandidateContext = {
    resumeFacts: textFor(selected, 'resume'),
    profileFacts: textFor(selected, 'profile'),
    savedAnswers: textFor(selected, 'saved_answer').map((answer, index) => ({
      prompt: `Сохранённый ответ ${index + 1}`,
      answer,
    })),
    instructions: '',
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
