import type { AIModelInfo } from './provider';
import type { AIProviderId } from './types';

export interface AIProviderDefinition {
  id: AIProviderId;
  name: string;
  description: string;
  baseUrl: string;
  defaultModel: string;
  modelDetails: AIModelInfo[];
  credentialLabel?: string;
  credentialUrl?: string;
  freeTier?: string;
  pricingUrl?: string;
  badge: string;
  bestFor: string;
  dataPolicy: string;
  setupHint: string;
  protocol: 'openai_chat' | 'anthropic' | 'gemini';
}

export const AI_PROVIDER_CATALOG: Record<AIProviderId, AIProviderDefinition> = {
  openai: {
    id: 'openai', name: 'OpenAI', description: 'GPT-модели OpenAI',
    baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-5.6-terra',
    modelDetails: [
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'Максимальное качество для сложных профессиональных вопросов.', contextWindow: 1_050_000, maxOutputTokens: 128_000 },
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', description: 'Баланс качества, скорости и стоимости; рекомендуемый вариант для анкет.', contextWindow: 1_050_000, maxOutputTokens: 128_000 },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', description: 'Экономичная модель для большого количества коротких анкет.', contextWindow: 1_050_000, maxOutputTokens: 128_000 },
    ], credentialLabel: 'OpenAI API key',
    credentialUrl: 'https://platform.openai.com/api-keys', badge: 'Качество',
    pricingUrl: 'https://openai.com/api/pricing/',
    bestFor: 'Сложные открытые вопросы, аккуратная работа с легендой и качественные формулировки.',
    dataPolicy: 'Контекст анкеты отправляется напрямую в OpenAI по вашему API-ключу.',
    setupHint: 'Нужен API-ключ OpenAI с доступным балансом. Оплата зависит от выбранной модели.',
    protocol: 'openai_chat',
  },
  anthropic: {
    id: 'anthropic', name: 'Claude', description: 'Модели Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-6',
    modelDetails: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: 'Сильный универсальный вариант для естественных и точных ответов.' },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', description: 'Максимальное качество Anthropic для сложных анкет.' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Быстрые и более экономичные короткие ответы.' },
    ],
    credentialLabel: 'Anthropic API key', credentialUrl: 'https://console.anthropic.com/settings/keys',
    pricingUrl: 'https://www.anthropic.com/pricing#api',
    badge: 'Тексты',
    bestFor: 'Развёрнутые ответы, естественный стиль и анкеты с большим контекстом.',
    dataPolicy: 'Контекст анкеты отправляется напрямую в Anthropic по вашему API-ключу.',
    setupHint: 'Нужен ключ Anthropic Console и положительный баланс API.',
    protocol: 'anthropic',
  },
  gemini: {
    id: 'gemini', name: 'Google Gemini', description: 'Быстрые Gemini-модели',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-3.6-flash',
    modelDetails: [
      { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', description: 'Быстрая актуальная Gemini-модель для текстовых задач.' },
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', description: 'Универсальная быстрая модель с длинным контекстом.' },
      { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', description: 'Экономичный вариант для массовой генерации.' },
    ],
    credentialLabel: 'Gemini API key', credentialUrl: 'https://aistudio.google.com/app/apikey',
    pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    freeTier: 'Есть бесплатный тариф; лимиты зависят от модели и региона. Google может использовать данные free tier для улучшения продуктов.',
    badge: 'Free tier',
    bestFor: 'Быстрый недорогой старт и обработка длинных легенд.',
    dataPolicy: 'Контекст отправляется в Google. Запросы выполняются с store=false, но для free tier действует политика Google по использованию данных.',
    setupHint: 'Бесплатный ключ можно создать в Google AI Studio.',
    protocol: 'gemini',
  },
  openrouter: {
    id: 'openrouter', name: 'OpenRouter', description: 'Один ключ для множества моделей',
    baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openrouter/free',
    modelDetails: [
      { id: 'openrouter/free', name: 'OpenRouter Free', description: 'Автоматически выбирает доступную бесплатную модель.', free: true },
      { id: 'openai/gpt-oss-120b:free', name: 'GPT-OSS 120B Free', description: 'Крупная открытая reasoning-модель через бесплатный маршрут.', free: true },
      { id: 'deepseek/deepseek-r1-0528:free', name: 'DeepSeek R1 Free', description: 'Reasoning-модель DeepSeek через бесплатный маршрут.', free: true },
    ],
    credentialLabel: 'OpenRouter API key', credentialUrl: 'https://openrouter.ai/settings/keys',
    pricingUrl: 'https://openrouter.ai/models',
    freeTier: 'Маршрутизатор openrouter/free выбирает доступную бесплатную модель',
    badge: 'Много моделей',
    bestFor: 'Эксперименты и переключение между десятками провайдеров с одним ключом.',
    dataPolicy: 'Контекст проходит через OpenRouter и выбранного им поставщика модели.',
    setupHint: 'Нужен ключ OpenRouter. Для бесплатных моделей доступны ограниченные квоты.',
    protocol: 'openai_chat',
  },
  groq: {
    id: 'groq', name: 'Groq', description: 'Очень быстрая генерация на hosted-моделях',
    baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'openai/gpt-oss-120b',
    modelDetails: [
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', description: 'Крупная открытая модель с сильным reasoning для сложных ответов.' },
      { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', description: 'Более быстрая открытая модель для массовой генерации.' },
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', description: 'Универсальная hosted-модель для качественных текстовых ответов.' },
    ],
    credentialLabel: 'Groq API key', credentialUrl: 'https://console.groq.com/keys',
    pricingUrl: 'https://groq.com/pricing',
    freeTier: 'Есть бесплатный тариф с дневными и минутными лимитами',
    badge: 'Быстро',
    bestFor: 'Очень быстрая генерация большого количества черновиков.',
    dataPolicy: 'Контекст отправляется напрямую в Groq и обрабатывается выбранной hosted-моделью.',
    setupHint: 'Ключ Groq можно получить бесплатно; действуют минутные и дневные лимиты.',
    protocol: 'openai_chat',
  },
  deepseek: {
    id: 'deepseek', name: 'DeepSeek', description: 'DeepSeek Chat и Reasoner',
    baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat',
    credentialLabel: 'DeepSeek API key',
    modelDetails: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', description: 'Универсальная модель для быстрых текстовых ответов.' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', description: 'Reasoning-модель для сложных технических вопросов.' },
    ],
    credentialUrl: 'https://platform.deepseek.com/api_keys', badge: 'Недорого',
    pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    bestFor: 'Недорогая генерация технических ответов и логические вопросы.',
    dataPolicy: 'Контекст анкеты отправляется напрямую в DeepSeek по вашему API-ключу.',
    setupHint: 'Нужен ключ DeepSeek Platform и доступный баланс API.',
    protocol: 'openai_chat',
  },
  custom_openai: {
    id: 'custom_openai', name: 'OpenCode / свой gateway',
    description: 'Любой сервер с OpenAI-compatible API', baseUrl: '', defaultModel: '', modelDetails: [],
    credentialLabel: 'API key (если требуется)', badge: 'Для своих',
    bestFor: 'Собственный сервер, корпоративный прокси или OpenCode-совместимый gateway.',
    dataPolicy: 'Данные отправляются на указанный вами адрес. Политика зависит от владельца gateway.',
    setupHint: 'Укажите HTTPS endpoint с OpenAI-compatible /models и /chat/completions.',
    protocol: 'openai_chat',
  },
};

export function getProviderDefinition(id: AIProviderId): AIProviderDefinition {
  return AI_PROVIDER_CATALOG[id];
}

export function isAIProviderId(value: unknown): value is AIProviderId {
  return typeof value === 'string' && value in AI_PROVIDER_CATALOG;
}
