import { HostedAIProvider } from '../src/questionnaires';
import type { CandidateContext, Questionnaire } from '../src/questionnaires';

const questionnaire: Questionnaire = {
  id: 'q1', vacancyId: 'v1', source: 'hh_backend', detectedAt: 1,
  questions: [{ id: 'answer', type: 'text', prompt: 'Ваш опыт?', required: true }],
};
const context: CandidateContext = {
  resumeFacts: ['Python — 5 лет'], profileFacts: [], savedAnswers: [],
};
const answer = JSON.stringify({ answers: [{
  questionId: 'answer', text: 'Пять лет Python', confidence: 0.9,
  evidence: [{ source: 'resume', reference: 'Python — 5 лет' }], requiresReview: true,
}] });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('HostedAIProvider', () => {
  it('binds the WorkerGlobalScope fetch implementation', async () => {
    const originalFetch = globalThis.fetch;
    const workerFetch = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(json({ data: [{ id: 'openai/gpt-oss-120b' }] }));
    });
    globalThis.fetch = workerFetch as typeof fetch;
    try {
      const provider = new HostedAIProvider({
        providerId: 'groq', modelId: 'openai/gpt-oss-120b', apiKey: 'secret',
        timeoutMs: 1_000, temperature: 0.1,
      });

      await expect(provider.listModels()).resolves.toEqual(['openai/gpt-oss-120b']);
      expect(workerFetch).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('normalizes OpenRouter model descriptions and per-million-token pricing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({
      data: [{
        id: 'example/forms-model',
        name: 'Forms Model',
        description: 'Good at structured application forms',
        context_length: 131_072,
        pricing: { prompt: '0.0000005', completion: '0.0000015' },
      }],
    }));
    const provider = new HostedAIProvider({
      providerId: 'openrouter', modelId: 'example/forms-model', apiKey: 'secret',
      timeoutMs: 1_000, temperature: 0.1, fetchImpl,
    });

    await expect(provider.listModelDetails()).resolves.toEqual([{
      id: 'example/forms-model',
      name: 'Forms Model',
      description: 'Good at structured application forms',
      contextWindow: 131_072,
      maxOutputTokens: undefined,
      ownedBy: undefined,
      pricing: { currency: 'USD', inputPerMillion: 0.5, outputPerMillion: 1.5 },
      free: false,
    }]);
  });

  it('reads Gemini names, descriptions, and token limits from the model catalog', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({
      models: [{
        name: 'models/gemini-example',
        displayName: 'Gemini Example',
        description: 'Fast model for forms',
        inputTokenLimit: 1_000_000,
        outputTokenLimit: 65_536,
      }],
    }));
    const provider = new HostedAIProvider({
      providerId: 'gemini', modelId: 'gemini-example', apiKey: 'secret',
      timeoutMs: 1_000, temperature: 0.1, fetchImpl,
    });

    await expect(provider.listModelDetails()).resolves.toEqual([{
      id: 'gemini-example',
      name: 'Gemini Example',
      description: 'Fast model for forms',
      contextWindow: 1_000_000,
      maxOutputTokens: 65_536,
    }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uses OpenAI Responses API and bearer authentication', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ output_text: answer }));
    const provider = new HostedAIProvider({
      providerId: 'openai', modelId: 'gpt-5.4-mini', apiKey: 'secret',
      timeoutMs: 1_000, temperature: 0.1, fetchImpl,
    });

    const plan = await provider.generateAnswers({ questionnaire, context, modelId: '' });

    expect(plan.providerId).toBe('openai');
    expect(plan.answers[0].text).toBe('Пять лет Python');
    expect(fetchImpl).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({ method: 'POST' }));
    const request = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(new Headers(request.headers).get('Authorization')).toBe('Bearer secret');
    expect(JSON.parse(String(request.body))).toMatchObject({ model: 'gpt-5.4-mini', max_output_tokens: expect.any(Number) });
  });

  it('uses Anthropic Messages API headers and response blocks', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ content: [{ type: 'text', text: answer }] }));
    const provider = new HostedAIProvider({
      providerId: 'anthropic', modelId: 'claude-sonnet-4-6', apiKey: 'anthropic-secret',
      timeoutMs: 1_000, temperature: 0.1, fetchImpl,
    });

    await provider.generateAnswers({ questionnaire, context, modelId: '' });

    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
    const headers = new Headers(fetchImpl.mock.calls[0][1].headers);
    expect(headers.get('x-api-key')).toBe('anthropic-secret');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
  });

  it('uses the recommended Gemini Interactions API and API-key header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ output_text: answer }));
    const provider = new HostedAIProvider({
      providerId: 'gemini', modelId: 'gemini-3.6-flash', apiKey: 'gemini-secret',
      timeoutMs: 1_000, temperature: 0.1, fetchImpl,
    });

    await provider.generateAnswers({ questionnaire, context, modelId: '' });

    expect(fetchImpl.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(new Headers(fetchImpl.mock.calls[0][1].headers).get('x-goog-api-key')).toBe('gemini-secret');
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toMatchObject({ store: false });
  });

  it('uses the OpenAI-compatible contract for Groq', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ choices: [{ message: { content: answer } }] }));
    const provider = new HostedAIProvider({
      providerId: 'groq', modelId: 'openai/gpt-oss-120b', apiKey: 'groq-secret',
      timeoutMs: 1_000, temperature: 0.1, fetchImpl,
    });

    await provider.generateAnswers({ questionnaire, context, modelId: '' });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/chat/completions');
  });

  it('retries a rejected structured-output request without response_format', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ error: { message: 'response_format is unsupported' } }, 400))
      .mockResolvedValueOnce(json({ choices: [{ message: { content: answer } }] }));
    const provider = new HostedAIProvider({
      providerId: 'groq', modelId: 'openai/gpt-oss-120b', apiKey: 'groq-secret',
      timeoutMs: 1_000, temperature: 0.1, fetchImpl,
    });

    await expect(provider.generateAnswers({ questionnaire, context, modelId: '' }))
      .resolves.toMatchObject({ providerId: 'groq' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1].body));
    expect(firstBody).toHaveProperty('response_format');
    expect(secondBody).not.toHaveProperty('response_format');
  });

  it('retries an oversized legend with a smaller request', async () => {
    const legendResponse = JSON.stringify({
      profileTitle: 'Python-разработчик', seniority: 'senior', geography: 'Москва',
      summary: 'Senior Python-разработчик', confirmedFacts: ['Python'], inferredDefaults: [],
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ error: { message: 'Request Entity Too Large' } }, 413))
      .mockResolvedValueOnce(json({ choices: [{ message: { content: legendResponse } }] }));
    const provider = new HostedAIProvider({
      providerId: 'openrouter', modelId: 'openrouter/free', apiKey: 'secret',
      timeoutMs: 1_000, temperature: 0.1, fetchImpl,
    });

    await expect(provider.prepareLegend({
      name: 'legend.md',
      content: Array.from({ length: 2_000 }, (_, index) => `Python backend experience ${index}.`).join('\n\n'),
      modelId: '',
    })).resolves.toMatchObject({ profileTitle: 'Python-разработчик' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1][1].body).length)
      .toBeLessThan(String(fetchImpl.mock.calls[0][1].body).length);
  });

  it('rejects insecure remote custom gateways', () => {
    expect(() => new HostedAIProvider({
      providerId: 'custom_openai', customBaseUrl: 'http://example.com/v1', modelId: 'model',
      timeoutMs: 1_000, temperature: 0,
    })).toThrow('HTTPS');
  });

  it('does not expose provider response details for invalid credentials', async () => {
    const provider = new HostedAIProvider({
      providerId: 'groq', modelId: 'model', apiKey: 'bad-key', timeoutMs: 1_000, temperature: 0,
      fetchImpl: vi.fn().mockResolvedValue(json({ error: { message: 'token bad-key rejected' } }, 401)),
    });
    await expect(provider.testConnection()).resolves.toEqual({ available: false, message: 'API-ключ не принят провайдером' });
  });
});
