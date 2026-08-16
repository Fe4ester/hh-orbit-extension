# AI Providers — тестирование

Справка по тестированию AI-провайдеров анкетного модуля.

Реализация: [`src/questionnaires/hostedAIProvider.ts`](../src/questionnaires/hostedAIProvider.ts) (`HostedAIProvider`), каталог провайдеров и моделей — [`providerCatalog.ts`](../src/questionnaires/providerCatalog.ts).

## Поддерживаемые провайдеры

| Провайдер | Env var для интеграционных тестов | Ключ | Особенности |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) | Responses API |
| Anthropic Claude | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/settings/keys) | Messages API |
| Google Gemini | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | [aistudio.google.com](https://aistudio.google.com/app/apikey) | Есть free tier |
| OpenRouter | `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai/settings/keys) | Free-маршруты, много моделей одним ключом |
| Groq | `GROQ_API_KEY` | [console.groq.com](https://console.groq.com/keys) | **Бесплатный ключ без карты**, очень быстрый |
| DeepSeek | `DEEPSEEK_API_KEY` | [platform.deepseek.com](https://platform.deepseek.com/api_keys) | Недорогой |
| Свой gateway | `CUSTOM_OPENAI_BASE_URL` (+ `CUSTOM_OPENAI_API_KEY`) | — | Любой OpenAI-compatible сервер, только HTTPS |

## Юнит-тесты (без ключей)

Все ответы замоканы. Покрывают контракты протоколов (endpoints, заголовки авторизации, форматы ответов), списки моделей, обработку ошибок (401/413/429), таймауты, retry-логику:

```bash
npm test -- tests/hosted-ai-provider.test.ts
```

## Интеграционные тесты (с реальными ключами)

Покрывают **только слой подключения** — `testConnection` и `listModelDetails`. Генерация контента (`generateAnswers` / `prepareLegend`) в интеграционные тесты намеренно не входит.

Тесты провайдера запускаются, только если задан его ключ; остальные скипаются:

```bash
# Бесплатный старт — Groq (ключ без карты)
export GROQ_API_KEY=gsk_...
npm test -- tests/hosted-ai-provider-integration.test.ts

# Несколько провайдеров сразу
export ANTHROPIC_API_KEY=sk-ant-...
export OPENROUTER_API_KEY=sk-or-...
npm test -- tests/hosted-ai-provider-integration.test.ts
```

## Troubleshooting

| Сообщение | Причина |
|---|---|
| `Добавьте API-ключ провайдера` | Для hosted-провайдера не задан ключ (не относится к custom gateway) |
| `API-ключ не принят провайдером` | 401/403 — неверный или просроченный ключ |
| `Лимит провайдера исчерпан…` | 429 — rate limit (Groq/Gemini free tier — минутные лимиты) |
| `Контекст не помещается в запрос…` | 413 — модель не вмещает контекст; для легенд есть автоповтор с меньшим объёмом |
| `AI API не ответил за N с` | Таймаут (максимум 90 с) |
| `Удалённый AI-сервер должен использовать HTTPS` | Custom gateway принимается только по HTTPS |
