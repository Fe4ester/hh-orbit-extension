import { parseAnswerContent } from './answerPrompt';
import type {
  LegendArtifact,
  LegendDefaultKey,
  LegendProfileDefault,
} from './types';

const DEFAULT_LEGEND_INPUT_CHARS = 8_000;
const DEFAULT_KEYS = new Set<LegendDefaultKey>([
  'salary_expectation',
  'employment_type',
  'work_format',
  'schedule',
  'start_availability',
  'relocation',
  'business_travel',
]);
const SENIORITY_VALUES = new Set<LegendArtifact['seniority']>([
  'intern', 'junior', 'middle', 'senior', 'lead', 'unknown',
]);

function compactLegendSource(content: string, maxChars = DEFAULT_LEGEND_INPUT_CHARS): string {
  const blocks = content
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);
  const unique = [...new Set(blocks)];
  let used = 0;
  const selected: string[] = [];
  for (const block of unique) {
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    selected.push(block.slice(0, remaining));
    used += Math.min(block.length, remaining) + 2;
  }
  return selected.join('\n\n');
}

export function buildLegendArtifactPrompt(
  name: string,
  content: string,
  maxSourceChars = DEFAULT_LEGEND_INPUT_CHARS
): string {
  return [
    'Convert the candidate legend into a compact reusable job-application profile.',
    'Preserve every explicit fact that may affect questionnaire answers.',
    'Do not invent employers, education, dates, years of experience, skills, achievements, languages, certificates, or personal history.',
    'You may infer only practical candidate preferences: salary expectation, employment type, work format, schedule, start availability, relocation, and business travel.',
    'For missing preferences, choose a conservative answer typical for an average candidate with this profile and seniority.',
    'If salary is missing, infer a realistic gross monthly RUB range. Use Moscow/Russia as the baseline when geography is missing.',
    'Every inferred preference must include a short rationale and must remain reviewable by the user.',
    'Keep confirmedFacts atomic, concise, and grounded in the source text.',
    'Select only the 8 most useful confirmedFacts. Keep every fact under 120 characters.',
    'Keep summary to one sentence under 240 characters.',
    'Return at most 3 inferredDefaults, prioritizing salary, work format, and availability.',
    'Keep each default value under 80 characters and each rationale under 100 characters.',
    'Do not repeat source passages, explain your process, or add fields outside the requested JSON.',
    'The complete JSON object must end within 450 output tokens.',
    'Do not include statements such as "not specified", "missing", "unknown", or "нет данных" in confirmedFacts or summary.',
    'Replace a missing preference with an inferred default instead of describing the field as absent.',
    'Return JSON only with: profileTitle, seniority, geography, summary, confirmedFacts, inferredDefaults.',
    'seniority must be one of intern, junior, middle, senior, lead, unknown.',
    'Each inferredDefaults item must contain key, value, rationale.',
    'Allowed keys: salary_expectation, employment_type, work_format, schedule, start_availability, relocation, business_travel.',
    'Write profileTitle, geography, summary, facts, default values, and rationales in Russian.',
    'Salary values must explicitly include ₽, gross or net, and the monthly period.',
    JSON.stringify({ sourceName: name, legend: compactLegendSource(content, maxSourceChars) }),
  ].join('\n\n');
}

export function legendArtifactResponseFormat(): Record<string, unknown> {
  return { type: 'json_object' };
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function describesMissingValue(value: string): boolean {
  return /(?:не указан|не задан|отсутству|нет данных|unknown|not specified|missing)/iu.test(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value
        .filter(item => typeof item === 'string')
        .map(item => item.trim())
        .filter(item => item && !describesMissingValue(item))
      )]
    : [];
}

function normalizeDefaults(value: unknown): LegendProfileDefault[] {
  if (!Array.isArray(value)) return [];
  const defaults: LegendProfileDefault[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    if (!DEFAULT_KEYS.has(source.key as LegendDefaultKey)) continue;
    const defaultValue = text(source.value);
    if (!defaultValue) continue;
    defaults.push({
      key: source.key as LegendDefaultKey,
      value: defaultValue,
      rationale: text(source.rationale, 'Профильное значение по умолчанию'),
    });
  }
  return [...new Map(defaults.map(item => [item.key, item])).values()];
}

function inferredSalary(seniority: LegendArtifact['seniority']): LegendProfileDefault {
  const ranges: Record<LegendArtifact['seniority'], string> = {
    intern: 'от 80 000 ₽ gross в месяц',
    junior: 'от 120 000 ₽ gross в месяц',
    middle: 'от 200 000 ₽ gross в месяц',
    senior: 'от 300 000 ₽ gross в месяц',
    lead: 'от 380 000 ₽ gross в месяц',
    unknown: 'от 180 000 ₽ gross в месяц',
  };
  return {
    key: 'salary_expectation',
    value: ranges[seniority],
    rationale: `Консервативный ориентир для профиля уровня ${seniority}; требуется проверка кандидатом`,
  };
}

function salaryDefaultIsComplete(value: string): boolean {
  return /(?:₽|руб|RUB)/iu.test(value)
    && /(?:gross|net|до вычета|на руки)/iu.test(value)
    && /(?:месяц|monthly)/iu.test(value);
}

function normalizeSalaryDefault(
  item: LegendProfileDefault,
  seniority: LegendArtifact['seniority']
): LegendProfileDefault {
  if (!salaryDefaultIsComplete(item.value)) return inferredSalary(seniority);
  const amounts = [...item.value.matchAll(/\d[\d\s.,]*/g)]
    .map(match => Number(match[0].replace(/\D/g, '')))
    .filter(amount => Number.isFinite(amount) && amount > 0)
    .slice(0, 2);
  if (amounts.length === 0) return inferredSalary(seniority);
  const conservativeFloors: Record<LegendArtifact['seniority'], number> = {
    intern: 60_000,
    junior: 90_000,
    middle: 150_000,
    senior: 220_000,
    lead: 280_000,
    unknown: 120_000,
  };
  if (Math.max(...amounts) < conservativeFloors[seniority]) {
    return inferredSalary(seniority);
  }
  const formatted = amounts
    .map(amount => amount.toLocaleString('ru-RU').replace(/\u00a0/g, ' '))
    .join('–');
  const basis = /(?:net|на руки)/iu.test(item.value) ? 'net' : 'gross';
  return {
    ...item,
    value: amounts.length === 1
      ? `от ${formatted} ₽ ${basis} в месяц`
      : `${formatted} ₽ ${basis} в месяц`,
  };
}

function hasExplicitSalary(content: string): boolean {
  return /(?:зарплат|доход|salary)[^\d]{0,40}\d|\d[\d\s]*(?:₽|руб)/iu.test(content);
}

function artifactContent(artifact: Omit<LegendArtifact, 'content'>): string {
  const facts = artifact.confirmedFacts.length > 0
    ? artifact.confirmedFacts.map(fact => `- ${fact}`).join('\n')
    : '- Подтверждённые факты не извлечены';
  const defaults = artifact.inferredDefaults.length > 0
    ? artifact.inferredDefaults.map(item =>
        `- [INFERRED DEFAULT — REVIEW REQUIRED] ${item.key}: ${item.value}. Основание: ${item.rationale}`
      ).join('\n')
    : '- Нет профильных предположений';
  return [
    `Профиль: ${artifact.profileTitle}`,
    `Уровень: ${artifact.seniority}`,
    `География: ${artifact.geography}`,
    `Кратко: ${artifact.summary}`,
    '',
    'Подтверждённые факты:',
    facts,
    '',
    'Профильные значения по умолчанию:',
    defaults,
  ].join('\n');
}

function detectSeniority(content: string): LegendArtifact['seniority'] {
  if (/(?:tech\s*lead|team\s*lead|руковод|тимлид|лид)/iu.test(content)) return 'lead';
  if (/(?:senior|старш|ведущ)/iu.test(content)) return 'senior';
  if (/(?:middle|мидл|средн)/iu.test(content)) return 'middle';
  if (/(?:junior|джун|младш)/iu.test(content)) return 'junior';
  if (/(?:intern|стаж[её]р)/iu.test(content)) return 'intern';
  return 'unknown';
}

function sourceFacts(content: string): string[] {
  const compacted = compactLegendSource(content);
  return [...new Set(compacted
    .split(/\n+|(?<=[.!?])\s+(?=[А-ЯA-Z])/u)
    .map(line => line
      .replace(/^\s*(?:#{1,6}|[-*+]\s+|\d+[.)]\s+)/u, '')
      .replace(/\s+/g, ' ')
      .trim()
    )
    .filter(line => line.length >= 3 && !describesMissingValue(line))
    .map(line => line.slice(0, 240))
  )].slice(0, 24);
}

function sourceProfileTitle(name: string, facts: string[]): string {
  const candidate = facts.find(fact => fact.length <= 120 && !/[.!?]$/.test(fact));
  if (candidate) return candidate;
  const filename = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return filename || 'Профиль кандидата';
}

function fallbackLegendArtifact(input: {
  name: string;
  sourceContent: string;
  modelId: string;
  now?: number;
}): LegendArtifact {
  const confirmedFacts = sourceFacts(input.sourceContent);
  const seniority = detectSeniority(input.sourceContent);
  const inferredDefaults = hasExplicitSalary(input.sourceContent)
    ? []
    : [inferredSalary(seniority)];
  const base: Omit<LegendArtifact, 'content'> = {
    version: 1,
    preparationMode: 'source_fallback',
    sourceName: input.name,
    modelId: input.modelId,
    generatedAt: input.now ?? Date.now(),
    profileTitle: sourceProfileTitle(input.name, confirmedFacts),
    seniority,
    geography: /москв/iu.test(input.sourceContent)
      ? 'Москва'
      : /санкт[- ]петербург|\bспб\b/iu.test(input.sourceContent)
        ? 'Санкт-Петербург'
        : 'Россия',
    summary: confirmedFacts.slice(0, 3).join('. ').slice(0, 500)
      || 'Профиль подготовлен напрямую из загруженной легенды',
    confirmedFacts,
    inferredDefaults,
  };
  return { ...base, content: artifactContent(base) };
}

function legendRecord(responseContent: string): Record<string, unknown> | null {
  try {
    const parsed = parseAnswerContent(responseContent);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    if (Array.isArray(parsed)) {
      const object = parsed.find(item => item && typeof item === 'object' && !Array.isArray(item));
      return (object as Record<string, unknown> | undefined) ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

export function parseLegendArtifact(input: {
  name: string;
  sourceContent: string;
  modelId: string;
  responseContent: string;
  now?: number;
}): LegendArtifact {
  const source = legendRecord(input.responseContent);
  if (!source || !(
    'profileTitle' in source
    || 'summary' in source
    || 'confirmedFacts' in source
    || 'inferredDefaults' in source
  )) {
    return fallbackLegendArtifact(input);
  }
  const seniority = SENIORITY_VALUES.has(source.seniority as LegendArtifact['seniority'])
    ? source.seniority as LegendArtifact['seniority']
    : 'unknown';
  const inferredDefaults = normalizeDefaults(source.inferredDefaults ?? source.defaults);
  if (!hasExplicitSalary(input.sourceContent)) {
    const salaryIndex = inferredDefaults.findIndex(item => item.key === 'salary_expectation');
    if (salaryIndex < 0) {
      inferredDefaults.unshift(inferredSalary(seniority));
    } else {
      inferredDefaults[salaryIndex] = normalizeSalaryDefault(
        inferredDefaults[salaryIndex],
        seniority
      );
    }
  }
  const base: Omit<LegendArtifact, 'content'> = {
    version: 1,
    preparationMode: 'ai',
    sourceName: input.name,
    modelId: input.modelId,
    generatedAt: input.now ?? Date.now(),
    profileTitle: text(source.profileTitle ?? source.profile, 'Профиль кандидата'),
    seniority,
    geography: text(source.geography ?? source.location, 'Россия / Москва'),
    summary: (() => {
      const summary = text(source.summary);
      return summary && !describesMissingValue(summary)
        ? summary
        : 'Компактный профиль из загруженной легенды';
    })(),
    confirmedFacts: stringArray(source.confirmedFacts ?? source.facts).slice(0, 60),
    inferredDefaults,
  };
  return { ...base, content: artifactContent(base) };
}
