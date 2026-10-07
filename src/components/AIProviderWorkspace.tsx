import { t, getLanguage } from '../i18n';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AI_PROVIDER_CATALOG,
  DEFAULT_AI_PROVIDER_ID,
  getProviderDefinition,
  isAIProviderId,
  type AIModelInfo,
  type AIProviderId,
  type QuestionnaireAISettingsPatch,
} from '../questionnaires';
import { SelectMenu } from './SelectMenu';

interface Props {
  provider: NonNullable<QuestionnaireAISettingsPatch['provider']> & {
    type: AIProviderId;
    modelId: string;
    temperature: number;
    timeoutMs: number;
  };
  onPatch: (patch: QuestionnaireAISettingsPatch) => void;
}

type CredentialStatus = { configured: boolean; hint?: string };
type Notice = { kind: 'success' | 'error' | 'info'; text: string };
type CheckStatus = { state: 'idle' | 'busy' | 'ready' | 'error'; message: string };

async function send<T>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as T | { error?: unknown };
  if (
    response
    && typeof response === 'object'
    && 'error' in response
    && typeof response.error === 'string'
    && response.error
  ) {
    throw new Error(response.error);
  }
  return response as T;
}

function formatTokens(value: number | undefined): string | null {
  if (!value) return null;
  if (value >= 1_000_000) return t("{0} млн токенов", (value / 1_000_000).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 1 }));
  return t("{0} тыс. токенов", Math.round(value / 1_000).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'ru-RU'));
}

function formatPrice(value: number | undefined): string {
  if (value === undefined) return '—';
  if (value === 0) return t("бесплатно");
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
}

export const AIProviderWorkspace: React.FC<Props> = ({ provider, onPatch }) => {
  const hasKnownProvider = isAIProviderId(provider.type);
  const providerType = hasKnownProvider ? provider.type : DEFAULT_AI_PROVIDER_ID;
  const definition = getProviderDefinition(providerType);
  const modelId = hasKnownProvider ? provider.modelId : definition.defaultModel;
  const [credential, setCredential] = useState('');
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus>({ configured: false });
  const [modelDetails, setModelDetails] = useState<AIModelInfo[]>(definition.modelDetails);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [catalogStatus, setCatalogStatus] = useState<CheckStatus>({ state: 'idle', message: t('Не проверен') });
  const [generationStatus, setGenerationStatus] = useState<CheckStatus>({ state: 'idle', message: t('Не проверена') });
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const selectedModel = useMemo<AIModelInfo>(() => (
    modelDetails.find(model => model.id === modelId)
    ?? definition.modelDetails.find(model => model.id === modelId)
    ?? { id: modelId, name: modelId || t("Модель не выбрана") }
  ), [definition.modelDetails, modelDetails, modelId]);
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLocaleLowerCase('ru-RU');
    if (!query) return modelDetails;
    return modelDetails.filter(model => `${model.name} ${model.id} ${model.description ?? ''}`.toLocaleLowerCase('ru-RU').includes(query));
  }, [modelDetails, modelSearch]);

  useEffect(() => {
    let cancelled = false;
    void send<CredentialStatus>({ type: 'AI_PROVIDER_CREDENTIAL_STATUS', providerId: providerType })
      .then(status => {
        if (!cancelled) setCredentialStatus(status);
      })
      .catch(error => {
        if (cancelled) return;
        setCredentialStatus({ configured: false });
        setNotice({
          kind: 'error',
          text: error instanceof Error ? error.message : t("Не удалось проверить сохранённый ключ"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [providerType]);

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!modelPickerRef.current?.contains(target)) setModelMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeMenus);
    return () => document.removeEventListener('pointerdown', closeMenus);
  }, []);

  useEffect(() => {
    if (modelMenuOpen) modelSearchRef.current?.focus();
  }, [modelMenuOpen]);

  const selectProvider = (type: AIProviderId) => {
    const next = AI_PROVIDER_CATALOG[type];
    onPatch({ provider: { type, modelId: next.defaultModel, customBaseUrl: type === 'custom_openai' ? provider.customBaseUrl ?? '' : undefined } });
  };

  const selectModel = (modelId: string) => {
    onPatch({ provider: { modelId } });
    setGenerationStatus({ state: 'idle', message: t('Не проверена') });
    setModelMenuOpen(false);
    setModelSearch('');
  };

  const saveCredential = async () => {
    setBusy('credential');
    setNotice(null);
    try {
      const result = await send<CredentialStatus>({
        type: 'AI_PROVIDER_SAVE_CREDENTIAL', providerId: providerType, credential,
      });
      setCredentialStatus(result);
      setCredential('');
      setCatalogStatus({ state: 'idle', message: t('Не проверен') });
      setGenerationStatus({ state: 'idle', message: t('Не проверена') });
      setNotice({ kind: 'success', text: t("Ключ сохранён на этом устройстве") });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : t("Не удалось сохранить ключ") });
    } finally {
      setBusy(null);
    }
  };

  const removeCredential = async () => {
    setBusy('credential');
    setNotice(null);
    try {
      await send({ type: 'AI_PROVIDER_DELETE_CREDENTIAL', providerId: providerType });
      setCredentialStatus({ configured: false });
      setCatalogStatus({ state: 'idle', message: t('Не проверен') });
      setGenerationStatus({ state: 'idle', message: t('Не проверена') });
      setNotice({ kind: 'info', text: t("Ключ удалён") });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : t("Не удалось удалить ключ") });
    } finally {
      setBusy(null);
    }
  };

  const ensureCustomPermission = async (): Promise<void> => {
    if (providerType !== 'custom_openai' || !provider.customBaseUrl) return;
    const origin = `${new URL(provider.customBaseUrl).origin}/*`;
    if (chrome.permissions && !await chrome.permissions.contains({ origins: [origin] })) {
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) throw new Error(t("Разрешите расширению обращаться к выбранному API"));
    }
  };

  const refreshModels = async () => {
    setBusy('models');
    setNotice(null);
    setCatalogStatus({ state: 'busy', message: t('Проверяем ключ…') });
    try {
      await ensureCustomPermission();
      const result = await send<{ models?: string[]; modelDetails?: AIModelInfo[]; error?: string }>({ type: 'QUESTIONNAIRE_LIST_MODELS' });
      if (result.error) throw new Error(result.error);
      const next = result.modelDetails?.length
        ? result.modelDetails
        : (result.models ?? []).map(id => ({ id, name: id }));
      setModelDetails(next);
      if (next.length === 0) {
        setCatalogStatus({ state: 'error', message: t('Совместимые текстовые модели не найдены') });
        return;
      }
      let message = t('Доступно моделей: {0}', next.length);
      if (providerType !== 'custom_openai' && !next.some(model => model.id === modelId)) {
        onPatch({ provider: { modelId: next[0].id } });
        setGenerationStatus({ state: 'idle', message: t('Не проверена') });
        message = t('Выбрана доступная модель: {0}', next[0].name);
      }
      setCatalogStatus({
        state: 'ready',
        message,
      });
    } catch (error) {
      setCatalogStatus({
        state: 'error',
        message: error instanceof Error ? error.message : t("Не удалось получить модели"),
      });
    } finally {
      setBusy(null);
    }
  };

  const testGeneration = async () => {
    setBusy('generation');
    setNotice(null);
    setGenerationStatus({ state: 'busy', message: t('Проверяем модель…') });
    try {
      await ensureCustomPermission();
      const result = await send<{ available: boolean; message?: string }>({
        type: 'QUESTIONNAIRE_TEST_GENERATION',
        modelId,
      });
      setGenerationStatus({
        state: result.available ? 'ready' : 'error',
        message: result.message || (result.available ? t('Генерация работает') : t('Проверка генерации не удалась')),
      });
    } catch (error) {
      setGenerationStatus({
        state: 'error',
        message: error instanceof Error ? error.message : t('Проверка генерации не удалась'),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="ai-provider-workspace" aria-labelledby="ai-provider-title">
      <div className="ai-provider-heading">
        <div><strong id="ai-provider-title">{t("AI для анкет")}</strong><small>{t("Подключите провайдера и проверьте выбранную модель")}</small></div>
        <span data-ready={credentialStatus.configured}>
          {credentialStatus.configured ? t("Ключ сохранён") : t("Нужен ключ")}
        </span>
      </div>

      <div className="ai-readiness" aria-live="polite">
        <div data-state={credentialStatus.configured ? 'ready' : 'idle'}>
          <span aria-hidden="true">1</span><strong>{t('Ключ')}</strong><small>{credentialStatus.configured ? t('Сохранён') : t('Не добавлен')}</small>
        </div>
        <div data-state={catalogStatus.state}>
          <span aria-hidden="true">2</span><strong>{t('Модели')}</strong><small>{catalogStatus.message}</small>
        </div>
        <div data-state={generationStatus.state}>
          <span aria-hidden="true">3</span><strong>{t('Генерация')}</strong><small>{generationStatus.message}</small>
        </div>
      </div>

      <div className="ai-provider-picker">
        <label className="ai-provider-picker-label" htmlFor="ai-provider-select">{t("Провайдер")}</label>
        <SelectMenu
          id="ai-provider-select"
          value={providerType}
          placeholder={t('Выберите провайдера')}
          options={Object.values(AI_PROVIDER_CATALOG).map(item => ({
            value: item.id,
            label: `${item.name} · ${t(item.badge)}`,
            description: t(item.bestFor),
          }))}
          onChange={value => selectProvider(value as AIProviderId)}
        />
      </div>

      <details className="ai-provider-explanation">
        <summary>{t('О провайдере и передаче данных')}</summary>
        <div><strong>{t("Для чего подходит")}</strong><span>{t(definition.bestFor)}</span></div>
        <div><strong>{t("Что происходит с данными")}</strong><span>{t(definition.dataPolicy)}</span></div>
        <div><strong>{t("Как подключить")}</strong><span>{t(definition.setupHint)}</span></div>
      </details>

      <div className="hosted-ai-settings">
          {definition.freeTier && <div className="ai-free-tier"><strong>{t("Бесплатный старт")}</strong><span>{t(definition.freeTier)}</span></div>}
          {providerType === 'custom_openai' && (
            <label className="ai-provider-field">
              <span>{t("Адрес API")}</span>
              <input type="url" value={provider.customBaseUrl ?? ''} placeholder={t("Адрес OpenAI-compatible API")} onChange={event => onPatch({ provider: { customBaseUrl: event.target.value } })} />
              <small>{t("Сервер должен использовать HTTPS. OpenCode подключается здесь, если gateway предоставляет OpenAI-compatible API.")}</small>
            </label>
          )}

          <div className="ai-credential-card">
            <div><strong>{definition.credentialLabel}</strong><small>{credentialStatus.configured ? t("Сохранён: {0}", credentialStatus.hint) : t("Хранится отдельно на этом устройстве и не попадает в логи")}</small></div>
            <input type="password" value={credential} autoComplete="off" placeholder={credentialStatus.configured ? t("Введите новый ключ для замены") : t("Вставьте API-ключ")} onChange={event => setCredential(event.target.value)} />
            <div>
              <button type="button" className="btn btn-primary btn-sm" disabled={!credential.trim() || busy !== null} onClick={() => void saveCredential()}>{busy === 'credential' ? t("Сохраняем…") : credentialStatus.configured ? t("Заменить ключ") : t("Сохранить ключ")}</button>
              {credentialStatus.configured && <button type="button" className="btn btn-quiet btn-sm" disabled={busy !== null} onClick={() => void removeCredential()}>{t("Удалить")}</button>}
              {definition.credentialUrl && <a href={definition.credentialUrl} target="_blank" rel="noreferrer">{t("Получить ключ ↗")}</a>}
            </div>
          </div>

          <div className="ai-model-picker" ref={modelPickerRef}>
            <label className="ai-provider-picker-label" htmlFor="ai-model-select">{t("Модель")}</label>
            <button
              id="ai-model-select"
              type="button"
              className="ai-model-picker-trigger"
              aria-haspopup="dialog"
              aria-expanded={modelMenuOpen}
              aria-controls="ai-model-list"
              onClick={() => setModelMenuOpen(open => !open)}
              onKeyDown={event => {
                if (event.key === 'Escape') setModelMenuOpen(false);
              }}
            >
              <span><strong>{selectedModel.name}</strong><small>{selectedModel.id}</small></span>
              <span className="ai-provider-chevron" aria-hidden="true">⌄</span>
            </button>
            <dialog className="ai-model-menu" aria-label={t('Выбор AI-модели')} open={modelMenuOpen}>
              <input
                ref={modelSearchRef}
                type="search"
                value={modelSearch}
                placeholder={t("Найти модель")}
                aria-label={t("Поиск модели")}
                onChange={event => setModelSearch(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    setModelMenuOpen(false);
                    setModelSearch('');
                  }
                }}
              />
              <ul id="ai-model-list">
                {filteredModels.map(model => (
                  <li key={model.id}>
                    <button
                      type="button"
                      data-selected={model.id === modelId}
                      aria-current={model.id === modelId ? 'true' : undefined}
                      onClick={() => selectModel(model.id)}
                    >
                      <span><strong>{model.name}</strong><small>{t(model.description || model.id)}</small></span>
                      <span className="ai-model-menu-meta">
                        {model.free && <em>Free</em>}
                        {model.contextWindow && <b>{formatTokens(model.contextWindow)}</b>}
                        {model.pricing && <b>in {formatPrice(model.pricing.inputPerMillion)} · out {formatPrice(model.pricing.outputPerMillion)}</b>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {filteredModels.length === 0 && <div className="ai-model-empty">{t("Ничего не найдено")}</div>}
            </dialog>
          </div>

          <div className="ai-model-details">
            <div><strong>{selectedModel.name}</strong><code>{selectedModel.id}</code></div>
            {selectedModel.description && <p>{t(selectedModel.description)}</p>}
            <div className="ai-model-facts">
              {selectedModel.contextWindow && <span><b>{t("Контекст")}</b>{formatTokens(selectedModel.contextWindow)}</span>}
              {selectedModel.maxOutputTokens && <span><b>{t("Макс. ответ")}</b>{formatTokens(selectedModel.maxOutputTokens)}</span>}
              {selectedModel.pricing && <span><b>{t("За 1 млн токенов")}</b>input {formatPrice(selectedModel.pricing.inputPerMillion)} · output {formatPrice(selectedModel.pricing.outputPerMillion)}</span>}
              {selectedModel.free && <span><b>{t("Стоимость")}</b>{t("Бесплатная модель или маршрут")}</span>}
              {!selectedModel.pricing && !selectedModel.free && <span><b>{t("Стоимость")}</b>{t("API списка моделей не публикует цену")}</span>}
            </div>
            <div className="ai-model-details-actions">
              {definition.pricingUrl && <a href={definition.pricingUrl} target="_blank" rel="noreferrer">{t("Официальный прайсинг ↗")}</a>}
              <details>
                <summary>{t("Указать ID вручную")}</summary>
                <input value={modelId} aria-label={t("ID модели")} onChange={event => onPatch({ provider: { modelId: event.target.value } })} />
              </details>
            </div>
          </div>

          <div className="ai-provider-actions">
            <button type="button" className="btn btn-secondary" disabled={busy !== null || (!credentialStatus.configured && providerType !== 'custom_openai')} onClick={() => void refreshModels()}>{busy === 'models' ? t("Проверяем…") : catalogStatus.state === 'ready' ? t('Обновить модели') : t('Проверить ключ')}</button>
            <button type="button" className="btn btn-primary" disabled={busy !== null || !modelId || (!credentialStatus.configured && providerType !== 'custom_openai')} onClick={() => void testGeneration()}>{busy === 'generation' ? t('Проверяем модель…') : t('Проверить генерацию')}</button>
          </div>
      </div>
      {notice && <div className="questionnaire-notice" data-kind={notice.kind}>{t(notice.text)}</div>}
    </section>
  );
};
