import { HostedAIProvider } from '../src/questionnaires';
import { AI_PROVIDER_CATALOG } from '../src/questionnaires/providerCatalog';
import type { AIProviderId } from '../src/questionnaires';

/**
 * Интеграционные тесты HostedAIProvider с реальными API.
 *
 * Покрывают только слой подключения (testConnection / listModelDetails) —
 * генерация ответов и легенд (generateAnswers / prepareLegend) сюда
 * намеренно не входит.
 *
 * Тесты каждого провайдера запускаются, только когда задан его ключ:
 *   OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY (или GOOGLE_API_KEY),
 *   OPENROUTER_API_KEY, GROQ_API_KEY, DEEPSEEK_API_KEY.
 * Для своего gateway: CUSTOM_OPENAI_BASE_URL (+ CUSTOM_OPENAI_API_KEY).
 *
 * Бесплатный старт: ключ Groq (без карты) или OpenRouter (free-маршруты).
 */

const PROVIDER_KEYS: Record<Exclude<AIProviderId, 'custom_openai'>, string | undefined> = {
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  openrouter: process.env.OPENROUTER_API_KEY,
  groq: process.env.GROQ_API_KEY,
  deepseek: process.env.DEEPSEEK_API_KEY,
};

const TIMEOUT_MS = 30_000;

describe('HostedAIProvider integration', () => {
  for (const [providerId, apiKey] of Object.entries(PROVIDER_KEYS) as Array<
    [Exclude<AIProviderId, 'custom_openai'>, string | undefined]
  >) {
    const definition = AI_PROVIDER_CATALOG[providerId];

    (apiKey ? describe : describe.skip)(definition.name, () => {
      const createProvider = () =>
        new HostedAIProvider({
          providerId,
          modelId: definition.defaultModel,
          apiKey,
          timeoutMs: TIMEOUT_MS,
          temperature: 0,
        });

      it('passes the connection test', { timeout: TIMEOUT_MS + 5_000 }, async () => {
        const health = await createProvider().testConnection();
        expect(health.available, health.message).toBe(true);
      });

      it('lists at least one model', { timeout: TIMEOUT_MS + 5_000 }, async () => {
        const models = await createProvider().listModelDetails();
        expect(models.length).toBeGreaterThan(0);
        for (const model of models) {
          expect(model.id).toBeTruthy();
          expect(model.name).toBeTruthy();
        }
      });
    });
  }

  const customBaseUrl = process.env.CUSTOM_OPENAI_BASE_URL;
  (customBaseUrl ? describe : describe.skip)('Custom OpenAI-compatible gateway', () => {
    it('passes the connection test', { timeout: TIMEOUT_MS + 5_000 }, async () => {
      const provider = new HostedAIProvider({
        providerId: 'custom_openai',
        customBaseUrl,
        modelId: '',
        apiKey: process.env.CUSTOM_OPENAI_API_KEY,
        timeoutMs: TIMEOUT_MS,
        temperature: 0,
      });

      const health = await provider.testConnection();
      expect(health.available, health.message).toBe(true);
    });
  });
});
