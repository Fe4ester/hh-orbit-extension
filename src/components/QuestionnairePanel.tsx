import { t } from '../i18n';
import React, { useRef, useState } from 'react';
import type { ResumeCandidate } from '../state/types';
import {
  extractBackendPageText,
  type QuestionnaireAISettingsPatch,
  type QuestionnaireQueueItem,
  type QuestionnaireState,
  type SuggestedAnswer,
} from '../questionnaires';
import { AIProviderWorkspace } from './AIProviderWorkspace';

interface QuestionnairePanelProps {
  state: QuestionnaireState;
  onPatch: (patch: QuestionnaireAISettingsPatch) => void;
  selectedResume: ResumeCandidate | null;
  manualQuestionnaireCount: number;
  view?: 'combined' | 'settings' | 'workspace';
}

const STATUS_LABELS: Record<QuestionnaireQueueItem['status'], string> = {
  detected: 'Обнаружен',
  ready_for_ai: 'Готов к AI',
  generating: 'Генерация',
  needs_review: 'Нужно проверить',
  approved: 'Одобрен',
  filled: 'Заполнен',
  submitted: 'Отправлен',
  failed: 'Ошибка',
  skipped: 'Пропущен',
};

function send<T = { success?: boolean; error?: string }>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function answerFor(item: QuestionnaireQueueItem, questionId: string): SuggestedAnswer | undefined {
  return item.answerPlan?.answers.find(answer => answer.questionId === questionId);
}

const RequiredContextEditor: React.FC<{
  value: string;
  onSave: (value: string) => void;
}> = ({ value, onSave }) => {
  const [draft, setDraft] = useState(value);
  return (
    <div className="questionnaire-required-context">
      <label htmlFor="questionnaire-required-context">{t("Обязательный контекст для ответов")}</label>
      <small>{t("Опишите факты и правила, которые AI должен учитывать в каждом ответе.")}</small>
      <textarea
        id="questionnaire-required-context"
        value={draft}
        placeholder={t("Например: отвечать от первого лица, писать кратко, не указывать готовность к переезду.")}
        onChange={event => setDraft(event.target.value)}
      />
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={draft.trim() === value.trim()}
        onClick={() => onSave(draft.trim())}
      >{t("Сохранить контекст")}</button>
    </div>
  );
};

export const QuestionnairePanel: React.FC<QuestionnairePanelProps> = ({
  state,
  onPatch,
  selectedResume,
  manualQuestionnaireCount,
  view = 'combined',
}) => {
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRevisionsRef = useRef(new Map<string, Set<Promise<void>>>());
  const failedRevisionIdsRef = useRef(new Set<string>());
  const settings = state.settings;
  const actionableCount = state.queue.filter(item =>
    ['detected', 'ready_for_ai', 'failed', 'needs_review', 'approved'].includes(item.status)
  ).length;
  const activeQueue = state.queue.filter(item => item.status !== 'submitted' && item.status !== 'skipped');
  const historyQueue = state.queue.filter(item => item.status === 'submitted' || item.status === 'skipped');
  const showSettings = view !== 'workspace';
  const showWorkspace = view !== 'settings';

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    successText: string | ((response: { legendFile?: { artifact?: { preparationMode?: string } } }) => string),
  ) => {
    setBusyAction(key);
    setNotice(null);
    try {
      const response = await action() as {
        success?: boolean;
        error?: string;
        item?: { status?: string; error?: string };
        legendFile?: { artifact?: { preparationMode?: string } };
      };
      if (response?.error) throw new Error(response.error);
      if (response?.item?.status === 'failed') {
        throw new Error(response.item.error || t('Не удалось подготовить черновик'));
      }
      setNotice({ kind: 'success', text: typeof successText === 'function' ? successText(response) : successText });
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : t("Операция не выполнена"),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const importContext = async (file: File) => {
    if (file.size > 2_000_000) {
      setNotice({ kind: 'error', text: t("Файл контекста должен быть меньше 2 МБ") });
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error(t("Файл пуст"));
      setBusyAction('prepare-legend');
      setNotice({ kind: 'info', text: t("AI собирает компактный профиль легенды…") });
      const response = await send<{ success?: boolean; error?: string; legendFile?: { artifact?: { preparationMode?: string } } }>({
        type: 'QUESTIONNAIRE_PREPARE_LEGEND',
        name: file.name,
        content: text,
      });
      if (response.error) throw new Error(response.error);
      setNotice({ kind: 'success', text: response.legendFile?.artifact?.preparationMode === 'source_fallback'
        ? t('Легенда загружена из файла без AI. Проверьте профиль перед использованием.')
        : t('AI-профиль легенды готов: {0}', file.name) });
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : t("Не удалось обработать файл контекста"),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const revise = (
    item: QuestionnaireQueueItem,
    questionId: string,
    value: { text?: string; selectedValues?: string[] }
  ) => {
    const questionnaireId = item.questionnaire.id;
    failedRevisionIdsRef.current.delete(questionnaireId);
    const revisions = pendingRevisionsRef.current.get(questionnaireId) ?? new Set<Promise<void>>();
    pendingRevisionsRef.current.set(questionnaireId, revisions);

    let revision!: Promise<void>;
    revision = send({
      type: 'QUESTIONNAIRE_REVISE_ANSWER',
      id: questionnaireId,
      questionId,
      value,
    }).then(response => {
      if (response?.error) throw new Error(response.error);
      setNotice({ kind: 'success', text: t("Ответ сохранён") });
    }).catch(error => {
      failedRevisionIdsRef.current.add(questionnaireId);
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : t("Не удалось сохранить ответ"),
      });
    }).finally(() => {
      revisions.delete(revision);
      if (revisions.size === 0) pendingRevisionsRef.current.delete(questionnaireId);
    });
    revisions.add(revision);
    return revision;
  };

  const submitAfterPendingRevisions = async (questionnaireId: string, message: unknown) => {
    const revisions = [...(pendingRevisionsRef.current.get(questionnaireId) ?? [])];
    if (revisions.length > 0) await Promise.all(revisions);
    if (failedRevisionIdsRef.current.has(questionnaireId)) {
      throw new Error(t("Ответ не сохранён. Повторите правку перед отправкой"));
    }
    return send(message);
  };

  return (
    <section className={`questionnaire-panel questionnaire-panel-${view}`}>
      {view === 'combined' && (
        <header className="questionnaire-panel-header">
          <span className="questionnaire-spark" aria-hidden="true">✦</span>
          <span>
            <strong>{t("Анкеты")}</strong>
            <small>{manualQuestionnaireCount > 0
              ? t("Ожидают подготовки: {0}", manualQuestionnaireCount)
              : t("Черновики перед отправкой в HH")}</small>
          </span>
          <span className="questionnaire-summary-meta">
            <span className="beta-badge">Beta</span>
            {actionableCount > 0 && <span className="section-count">{actionableCount}</span>}
          </span>
        </header>
      )}

      {showSettings && (
        <div className="questionnaire-settings">
          <AIProviderWorkspace key={settings.provider.type} provider={settings.provider} onPatch={onPatch} />

          <div className="questionnaire-context">
            <div className="questionnaire-context-heading">
              <strong>{t("Контекст AI")}</strong>
              <small>{t("Один файл-легенда + выбранное резюме HH")}</small>
            </div>
            <RequiredContextEditor
              key={settings.context.instructions ?? ''}
              value={settings.context.instructions ?? ''}
              onSave={value => {
                onPatch({ context: { instructions: value } });
                setNotice({ kind: 'success', text: t("Контекст сохранён") });
              }}
            />
            <div className="questionnaire-context-sources">
              <div data-ready={Boolean(settings.context.legendFile)}>
                <span>{settings.context.legendFile ? '✓' : '1'}</span>
                <div>
                  <strong>{settings.context.legendFile?.name || t("Загрузите легенду")}</strong>
                  <small>{settings.context.legendFile
                    ? settings.context.legendFile.artifact
                      ? t("{0} · {1} фактов · {2} предположений", settings.context.legendFile.artifact.preparationMode === 'source_fallback'
                        ? t('Профиль собран из файла без AI - проверьте факты')
                        : 'AI-профиль готов', settings.context.legendFile.artifact.confirmedFacts.length, settings.context.legendFile.artifact.inferredDefaults.length)
                      : t("{0} символов · требуется AI-анализ", settings.context.legendFile.content.length.toLocaleString('ru-RU'))
                    : t("Поддерживаются .md, .txt и .json до 2 МБ")}</small>
                </div>
              </div>
              <div data-ready={Boolean(selectedResume)}>
                <span>{selectedResume ? '✓' : '2'}</span>
                <div>
                  <strong>{selectedResume?.title || t("Выберите резюме в разделе \"Профиль\"")}</strong>
                  <small>{selectedResume
                    ? t("Текст резюме будет добавлен автоматически")
                    : t("Без резюме обработка не начнётся")}</small>
                </div>
              </div>
            </div>
            <div className="questionnaire-context-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.json,text/plain,text/markdown,application/json"
            hidden
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void importContext(file);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busyAction === 'prepare-legend'}
            onClick={() => fileInputRef.current?.click()}
          >
            {busyAction === 'prepare-legend'
              ? t("Анализируем…")
              : settings.context.legendFile
                ? t("Заменить легенду")
                : t("Загрузить легенду")}
          </button>
          {settings.context.legendFile && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busyAction === 'prepare-legend'}
              onClick={() => {
                const legend = settings.context.legendFile;
                if (!legend) return;
                void run(
                  'prepare-legend',
                  () => send({
                    type: 'QUESTIONNAIRE_PREPARE_LEGEND',
                    name: legend.name,
                    content: legend.content,
                  }),
                  response => response.legendFile?.artifact?.preparationMode === 'source_fallback'
                    ? t('Легенда загружена из файла без AI. Проверьте профиль перед использованием.')
                    : t('AI-профиль легенды пересобран')
                );
              }}
            >{t("Пересобрать AI-профиль") + " "}</button>
          )}
          {settings.context.legendFile && (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => onPatch({ context: { legendFile: null } })}
            >{t("Удалить") + " "}</button>
          )}
          <small>{t("Файл хранится только на этом компьютере.")}</small>
            </div>
            {settings.context.legendFile?.artifact && (
              <details className="legend-artifact-preview">
                <summary>
                  <strong>{settings.context.legendFile.artifact.profileTitle}</strong>
                  <span>{settings.context.legendFile.artifact.seniority}</span>
                </summary>
                <p>{settings.context.legendFile.artifact.summary}</p>
                {settings.context.legendFile.artifact.inferredDefaults.length > 0 && (
                  <div>
                    <strong>{t("Предположения для обязательной проверки")}</strong>
                    {settings.context.legendFile.artifact.inferredDefaults.map(item => (
                      <span key={item.key}>{item.key}: {item.value}</span>
                    ))}
                  </div>
                )}
              </details>
            )}
          </div>

          <section className="questionnaire-memory" aria-labelledby="questionnaire-memory-title">
            <div className="questionnaire-memory-heading">
              <span>
                <strong id="questionnaire-memory-title">{t("Память ответов")}</strong>
                <small>{t("Подтверждённые ответы добавляются в контекст AI")}</small>
              </span>
              <span className="questionnaire-memory-count">
                {settings.context.savedAnswers.length}
              </span>
            </div>
            <div className="questionnaire-memory-options">
              <label className="settings-switch" aria-labelledby="questionnaire-memory-remember-label">
                <span>
                  <strong id="questionnaire-memory-remember-label">{t("Запоминать новые ответы")}</strong>
                  <small>{t("Только после вашего одобрения")}</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={settings.answerMemory.rememberNewAnswers}
                  checked={settings.answerMemory.rememberNewAnswers}
                  onChange={event => onPatch({
                    answerMemory: { rememberNewAnswers: event.target.checked },
                  })}
                />
              </label>
              <label className="settings-switch" aria-labelledby="questionnaire-memory-update-label">
                <span>
                  <strong id="questionnaire-memory-update-label">{t("Обновлять сохранённые")}</strong>
                  <small>{t("Заменять прежний ответ, если вы его изменили")}</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={settings.answerMemory.updateRememberedAnswers}
                  checked={settings.answerMemory.updateRememberedAnswers}
                  onChange={event => onPatch({
                    answerMemory: { updateRememberedAnswers: event.target.checked },
                  })}
                />
              </label>
            </div>
            <button
              type="button"
              className="btn btn-quiet btn-sm questionnaire-memory-clear"
              disabled={settings.context.savedAnswers.length === 0}
              onClick={() => onPatch({ context: { savedAnswers: [] } })}
            >{t("Очистить память") + " "}</button>
          </section>
        </div>
      )}

      {notice && !(showWorkspace && activeQueue.some(item => item.error === notice.text)) && <div className="questionnaire-notice" data-kind={notice.kind}>{t(notice.text)}</div>}
      {showSettings && state.lastError && <div className="questionnaire-notice" data-kind="error">{t(state.lastError)}</div>}

      {showWorkspace && (
        <div className="questionnaire-workspace">
          <div className="questionnaire-review-flow" aria-label={t("Этапы обработки анкеты")}>
            <span><b>1</b>{t("Заполните ответы")}</span>
            <span><b>2</b>{t("Проверьте черновик")}</span>
            <span><b>3</b>{t("Одобрите отправку")}</span>
          </div>

          {state.lastError && !activeQueue.some(item => item.error === state.lastError) && <div className="questionnaire-notice" data-kind="error">{t(state.lastError)}</div>}
          <div className="questionnaire-queue">
            {activeQueue.length === 0 && (
              <div className="empty-state-mini questionnaire-empty-state">
                <span className="empty-state-check">✓</span>
                <span><strong>{manualQuestionnaireCount > 0 ? t("Черновики ещё не созданы") : t("Нет анкет в работе")}</strong><small>{manualQuestionnaireCount > 0 ? t("У ожидающей анкеты нажмите \"Заполнить\" или \"Заполнить с AI\".") : t("Анкеты появятся здесь, когда работодатель запросит ответы.")}</small></span>
              </div>
            )}
            {activeQueue.map(item => (
              <QuestionnaireQueueCard
                key={item.questionnaire.id}
                item={item}
                busyAction={busyAction}
                onRun={run}
                onRevise={revise}
                onSubmit={submitAfterPendingRevisions}
              />
            ))}
            {historyQueue.length > 0 && (
              <details className="questionnaire-history">
                <summary>{t("История") + " "}<span>{historyQueue.length}</span></summary>
                <div>
                  {historyQueue.map(item => (
                    <QuestionnaireQueueCard
                      key={item.questionnaire.id}
                      item={item}
                      busyAction={busyAction}
                      onRun={run}
                      onRevise={revise}
                      onSubmit={submitAfterPendingRevisions}
                    />
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

interface QueueCardProps {
  item: QuestionnaireQueueItem;
  busyAction: string | null;
  onRun: (key: string, action: () => Promise<unknown>, successText: string) => Promise<void>;
  onRevise: (
    item: QuestionnaireQueueItem,
    questionId: string,
    value: { text?: string; selectedValues?: string[] }
  ) => Promise<void>;
  onSubmit: (questionnaireId: string, message: unknown) => Promise<unknown>;
}

interface QueueActionButtonProps {
  actionKey: string;
  className: string;
  disabled?: boolean;
  label: string;
  message: unknown;
  onRun: QueueCardProps['onRun'];
  successText: string;
}

const QueueActionButton: React.FC<QueueActionButtonProps> = ({
  actionKey,
  className,
  disabled,
  label,
  message,
  onRun,
  successText,
}) => (
  <button
    type="button"
    className={className}
    disabled={disabled}
    onClick={() => onRun(actionKey, () => send(message), successText)}
  >
    {label}
  </button>
);

const QuestionnaireQueueCard: React.FC<QueueCardProps> = ({
  item,
  busyAction,
  onRun,
  onRevise,
  onSubmit,
}) => {
  const id = item.questionnaire.id;
  const vacancyTitle = item.vacancyTitle
    ? extractBackendPageText(item.vacancyTitle)
    : t("Вакансия {0}", item.questionnaire.vacancyId);
  const company = item.company ? extractBackendPageText(item.company) : '';
  const isManualDraft = item.answerPlan?.providerId === 'manual';
  const primaryAction = ['detected', 'ready_for_ai', 'failed'].includes(item.status)
    ? {
        key: `process:${id}`,
        label: t("Сгенерировать"),
        message: { type: 'QUESTIONNAIRE_PROCESS_ONE', id },
        successText: t("Черновик подготовлен"),
        isSubmit: false,
      }
    : item.status === 'needs_review'
      ? {
          key: `submit:${id}`,
          label: t("Одобрить и отправить"),
          message: { type: 'QUESTIONNAIRE_APPROVE_AND_SUBMIT', id },
          successText: t("Анкета отправлена в HH"),
          isSubmit: true,
        }
      : item.status === 'approved'
        ? {
            key: `submit:${id}`,
            label: t("Отправить в HH"),
            message: { type: 'QUESTIONNAIRE_APPROVE_AND_SUBMIT', id },
            successText: t("Анкета отправлена в HH"),
            isSubmit: true,
          }
        : null;
  return (
    <details className="questionnaire-card" open={item.status === 'needs_review'}>
      <summary>
        <span>
          <strong>{vacancyTitle}</strong>
          <small>
            {company ? `${company} · ` : ''}
            {item.questionnaire.questions.length}{" " + t("вопросов") + " "}</small>
        </span>
        <span className="questionnaire-status" data-status={item.status}>
          {isManualDraft && item.status === 'needs_review' ? t("Ручное заполнение") : t(STATUS_LABELS[item.status])}
        </span>
      </summary>

      {item.error && <div className="questionnaire-notice" data-kind="error">{t(item.error)}</div>}
      <div className="questionnaire-answers">
        {item.questionnaire.questions.map(question => {
          const answer = answerFor(item, question.id);
          const selected = answer?.selectedValues ?? [];
          return (
            <div className="questionnaire-answer" key={question.id}>
              <div className="questionnaire-question">
                <strong>{question.prompt}</strong>
                {question.required && <span>{t("обязательно")}</span>}
              </div>
              {question.options?.length ? (
                <div className="questionnaire-choice-list">
                  {question.options.map(option => (
                    <label key={option.value}>
                      <input
                        type={question.type === 'multiple' ? 'checkbox' : 'radio'}
                        name={`${id}:${question.id}`}
                        checked={selected.includes(option.value)}
                        disabled={item.status !== 'needs_review'}
                        onChange={event => {
                          const selectedValues = question.type === 'multiple'
                            ? event.target.checked
                              ? [...selected, option.value]
                              : selected.filter(value => value !== option.value)
                            : [option.value];
                          void onRevise(item, question.id, { selectedValues });
                        }}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              ) : (
                <textarea
                  key={answer?.text}
                  defaultValue={answer?.text ?? ''}
                  disabled={item.status !== 'needs_review'}
                  onBlur={event => {
                    if (event.target.value !== (answer?.text ?? '')) {
                      void onRevise(item, question.id, { text: event.target.value });
                    }
                  }}
                  placeholder={t("Нет предложенного ответа")}
                />
              )}
              {answer && !isManualDraft && (
                <div className="questionnaire-answer-meta">
                  <span>{Math.round(answer.confidence * 100)}{t("% уверенность")}</span>
                  <span>{answer.evidence.length}{" " + t("источников")}</span>
                  {answer.warning && <span className="is-warning">{answer.warning}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="questionnaire-card-actions">
        {primaryAction && (
          primaryAction.isSubmit ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busyAction === primaryAction.key}
              onClick={() => onRun(
                primaryAction.key,
                () => onSubmit(id, primaryAction.message),
                primaryAction.successText
              )}
            >
              {busyAction === primaryAction.key ? t("Отправляем…") : primaryAction.label}
            </button>
          ) : (
                <QueueActionButton
                  actionKey={primaryAction.key}
                  className="btn btn-primary btn-sm"
                  disabled={busyAction !== null}
                  label={primaryAction.label}
                  message={primaryAction.message}
                  onRun={onRun}
                  successText={primaryAction.successText}
                />
              )
        )}
        {item.status === 'needs_review' && (
          <QueueActionButton
            actionKey={`regenerate:${id}`}
            className="btn btn-secondary btn-sm"
            disabled={busyAction === `regenerate:${id}`}
            label={isManualDraft ? t("Заполнить с AI") : t("Сгенерировать заново")}
            message={{ type: 'QUESTIONNAIRE_PROCESS_ONE', id }}
            onRun={onRun}
            successText={t("Черновик обновлён")}
          />
        )}
        {['detected', 'ready_for_ai', 'needs_review', 'approved', 'failed'].includes(item.status) && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => onRun(
              `skip:${id}`,
              () => send({ type: 'QUESTIONNAIRE_SKIP', id }),
              t("Опросник пропущен")
            )}
          >{t("Пропустить") + " "}</button>
        )}
      </div>
    </details>
  );
};
