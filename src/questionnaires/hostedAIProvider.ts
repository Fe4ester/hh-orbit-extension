import { compactCandidateContext } from './contextCompactor';
import {
  answerResponseFormat,
  buildAnswerPrompt,
  parseAnswerContent,
} from './answerPrompt';
import { unansweredReviewPlan, validateAnswers } from './answerValidation';
import {
  buildLegendArtifactPrompt,
  legendArtifactResponseFormat,
  parseLegendArtifact,
} from './legendArtifact';
import type { AIModelInfo, AIModelPricing, AIProvider, AIProviderHealth } from './provider';
import { getProviderDefinition } from './providerCatalog';
import type {
  AIProviderId,
  AnswerPlan,
  CandidateContext,
  LegendArtifact,
  Questionnaire,
  SuggestedAnswer,
} from './types';

interface HostedAIProviderOptions {
  providerId: AIProviderId;
  modelId: string;
  timeoutMs: number;
  temperature: number;
  apiKey?: string | null;
  customBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface Message { role: 'system' | 'user' | 'assistant'; content: string }

interface TextBlock { type?: string; text?: string; content?: string | TextBlock[] }
interface OpenAIResponsePayload {
  output_text?: string;
  output?: Array<{ content?: TextBlock[] }>;
  choices?: Array<{ message?: { content?: string } }>;
}
interface GeminiResponsePayload {
  output_text?: string;
  outputs?: TextBlock[];
  steps?: Array<{ outputs?: TextBlock[]; content?: TextBlock[] }>;
}
interface AnthropicResponsePayload { content?: TextBlock[] }
interface ModelListPayload {
  data?: Array<{
    id?: string;
    name?: string;
    display_name?: string;
    description?: string;
    context_length?: number;
    context_window?: number;
    max_completion_tokens?: number;
    owned_by?: string;
    pricing?: { prompt?: string; completion?: string };
  }>;
  models?: Array<{
    name?: string;
    displayName?: string;
    description?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
  }>;
}
interface ApiErrorPayload { error?: { message?: string }; message?: string }

function pricePerMillion(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed * 1_000_000;
}

function normalizePricing(raw: { prompt?: string; completion?: string } | undefined): AIModelPricing | undefined {
  const inputPerMillion = pricePerMillion(raw?.prompt);
  const outputPerMillion = pricePerMillion(raw?.completion);
  if (inputPerMillion === undefined && outputPerMillion === undefined) return undefined;
  return { currency: 'USD', inputPerMillion, outputPerMillion };
}

function readableModelName(id: string): string {
  return id.split('/').pop()?.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) || id;
}

function mergeModelDetails(live: AIModelInfo[], fallback: AIModelInfo[]): AIModelInfo[] {
  if (live.length === 0) return fallback;
  const fallbackById = new Map(fallback.map(model => [model.id, model]));
  return live.map(model => ({ ...fallbackById.get(model.id), ...model }));
}

function normalizeRemoteBaseUrl(providerId: AIProviderId, raw: string): string {
  if (!raw.trim()) throw new Error('Укажите адрес OpenAI-compatible API');
  const url = new URL(raw);
  if (url.protocol !== 'https:') {
    throw new Error('Удалённый AI-сервер должен использовать HTTPS');
  }
  if (providerId !== 'custom_openai') {
    const expected = new URL(getProviderDefinition(providerId).baseUrl);
    if (url.origin !== expected.origin) throw new Error('Адрес API не соответствует провайдеру');
  }
  return url.toString().replace(/\/$/, '');
}

function extractOpenAIText(payload: unknown): string | null {
  const response = payload as OpenAIResponsePayload;
  if (typeof response.output_text === 'string') return response.output_text;
  const responseText = response.output?.flatMap(item => item.content ?? [])
    .find(item => item.type === 'output_text')?.text;
  if (typeof responseText === 'string') return responseText;
  const chatText = response.choices?.[0]?.message?.content;
  return typeof chatText === 'string' ? chatText : null;
}

function extractGeminiText(payload: unknown): string | null {
  const response = payload as GeminiResponsePayload;
  if (typeof response.output_text === 'string') return response.output_text;
  const blocks = [
    ...(response.outputs ?? []),
    ...(response.steps?.flatMap(step => step.outputs ?? step.content ?? []) ?? []),
  ];
  for (const block of blocks) {
    if (typeof block?.text === 'string') return block.text;
    if (typeof block?.content === 'string') return block.content;
    if (Array.isArray(block?.content)) {
      const text = block.content.map(item => item.text ?? '').join('');
      if (text) return text;
    }
  }
  return null;
}

function safeApiError(status: number, payload: unknown): Error {
  const body = payload as ApiErrorPayload;
  const raw = body.error?.message ?? body.message;
  const message = typeof raw === 'string' ? raw.slice(0, 300) : '';
  if (status === 401 || status === 403) return new Error('API-ключ не принят провайдером');
  if (status === 429) return new Error('Лимит провайдера исчерпан. Повторите позже или выберите другую модель');
  return new Error(message ? `AI API: ${message}` : `AI API вернул HTTP ${status}`);
}

export class HostedAIProvider implements AIProvider {
  readonly id: AIProviderId;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HostedAIProviderOptions) {
    this.id = options.providerId;
    const definition = getProviderDefinition(this.id);
    this.baseUrl = normalizeRemoteBaseUrl(
      this.id,
      this.id === 'custom_openai' ? options.customBaseUrl ?? '' : definition.baseUrl,
    );
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    if (this.id !== 'custom_openai' && !options.apiKey) throw new Error('Добавьте API-ключ провайдера');
  }

  async listModels(): Promise<string[]> {
    return (await this.listModelDetails()).map(model => model.id);
  }

  async listModelDetails(): Promise<AIModelInfo[]> {
    const definition = getProviderDefinition(this.id);
    const path = definition.protocol === 'gemini' ? '/models?pageSize=1000' : '/models';
    const payload = await this.requestJson(path, { method: 'GET' }) as ModelListPayload;
    const liveModels: AIModelInfo[] = definition.protocol === 'gemini'
      ? (payload.models ?? []).flatMap(model => {
          const id = String(model.name ?? '').replace(/^models\//, '');
          if (!id) return [];
          return [{
            id,
            name: model.displayName || readableModelName(id),
            description: model.description,
            contextWindow: model.inputTokenLimit,
            maxOutputTokens: model.outputTokenLimit,
          }];
        })
      : (payload.data ?? []).flatMap(model => {
          if (!model.id) return [];
          const pricing = normalizePricing(model.pricing);
          return [{
            id: model.id,
            name: model.name || model.display_name || readableModelName(model.id),
            description: model.description,
            contextWindow: model.context_length ?? model.context_window,
            maxOutputTokens: model.max_completion_tokens,
            ownedBy: model.owned_by,
            pricing,
            free: pricing !== undefined
              && pricing.inputPerMillion === 0
              && pricing.outputPerMillion === 0,
          }];
        });
    return mergeModelDetails(liveModels, definition.modelDetails);
  }

  async testConnection(): Promise<AIProviderHealth> {
    try {
      const models = await this.listModels();
      return { available: true, message: models.length > 0 ? `Подключение работает · моделей: ${models.length}` : 'Подключение работает' };
    } catch (error) {
      return { available: false, message: error instanceof Error ? error.message : 'Проверка не удалась' };
    }
  }

  async generateAnswers(input: { questionnaire: Questionnaire; context: CandidateContext; modelId: string }): Promise<AnswerPlan> {
    const modelId = input.modelId || this.options.modelId;
    if (!modelId) throw new Error('Выберите модель');
    const compacted = compactCandidateContext(input.context, input.questionnaire);
    const maxTokens = Math.min(1_024, Math.max(128, input.questionnaire.questions.reduce(
      (total, question) => total + (question.type === 'text' ? 120 : 40), 32,
    )));
    const content = await this.complete(modelId, [
      { role: 'system', content: 'Draft truthful job-application answers from supplied evidence. Return only JSON.' },
      { role: 'user', content: buildAnswerPrompt(input.questionnaire, compacted.context) },
    ], maxTokens, this.options.temperature, answerResponseFormat());
    let answers: SuggestedAnswer[];
    try {
      answers = validateAnswers(parseAnswerContent(content), input.questionnaire, compacted.context);
    } catch {
      answers = unansweredReviewPlan(input.questionnaire);
    }
    return { questionnaireId: input.questionnaire.id, providerId: this.id, modelId, answers, generatedAt: Date.now() };
  }

  async prepareLegend(input: { name: string; content: string; modelId: string }): Promise<LegendArtifact> {
    const modelId = input.modelId || this.options.modelId;
    if (!modelId) throw new Error('Выберите модель');
    const content = await this.complete(modelId, [
      { role: 'system', content: 'Create a minimal reusable candidate profile. Obey every output size limit. Return only JSON.' },
      { role: 'user', content: buildLegendArtifactPrompt(input.name, input.content) },
    ], 512, 0, legendArtifactResponseFormat());
    return parseLegendArtifact({ name: input.name, sourceContent: input.content, modelId, responseContent: content });
  }

  private async complete(model: string, messages: Message[], maxTokens: number, temperature: number, responseFormat: Record<string, unknown>): Promise<string> {
    const protocol = getProviderDefinition(this.id).protocol;
    let path: string;
    let body: unknown;
    if (this.id === 'openai') {
      path = '/responses';
      body = {
        model,
        input: messages.map(message => ({ role: message.role, content: message.content })),
        max_output_tokens: maxTokens,
        text: { format: responseFormat },
      };
    } else if (protocol === 'anthropic') {
      path = '/messages';
      body = {
        model, max_tokens: maxTokens, temperature,
        system: messages.filter(message => message.role === 'system').map(message => message.content).join('\n'),
        messages: messages.filter(message => message.role !== 'system'),
      };
    } else if (protocol === 'gemini') {
      path = '/interactions';
      body = {
        model,
        store: false,
        input: messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n'),
        generation_config: { temperature, max_output_tokens: maxTokens, thinking_level: 'low' },
      };
    } else {
      path = '/chat/completions';
      body = { model, temperature, max_tokens: maxTokens, stream: false, messages, response_format: responseFormat };
    }
    const payload = await this.requestJson(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const content = protocol === 'anthropic'
      ? (payload as AnthropicResponsePayload).content?.find(block => block.type === 'text')?.text
      : protocol === 'gemini'
        ? extractGeminiText(payload)
        : extractOpenAIText(payload);
    if (typeof content !== 'string' || !content.trim()) throw new Error('Провайдер не вернул текст ответа');
    return content;
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const headers = new Headers(init.headers);
    const key = this.options.apiKey;
    const protocol = getProviderDefinition(this.id).protocol;
    if (key) {
      if (protocol === 'anthropic') {
        headers.set('x-api-key', key);
        headers.set('anthropic-version', '2023-06-01');
        headers.set('anthropic-dangerous-direct-browser-access', 'true');
      } else if (protocol === 'gemini') {
        headers.set('x-goog-api-key', key);
      } else {
        headers.set('Authorization', `Bearer ${key}`);
      }
    }
    if (this.id === 'openrouter') {
      headers.set('HTTP-Referer', 'https://hh-orbit.local');
      headers.set('X-OpenRouter-Title', 'HH Orbit');
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw safeApiError(response.status, payload);
      return payload;
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`AI API не ответил за ${Math.round(this.options.timeoutMs / 1000)} с`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
