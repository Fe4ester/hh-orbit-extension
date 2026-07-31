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

export const QuestionnairePanel: React.FC<QuestionnairePanelProps> = ({
  state,
  onPatch,
  selectedResume,
  manualQuestionnaireCount,
}) => {
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmingSubmitId, setConfirmingSubmitId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settings = state.settings;
  const actionableCount = state.queue.filter(item =>
    ['detected', 'ready_for_ai', 'failed', 'needs_review', 'approved'].includes(item.status)
  ).length;

  const run = async (key: string, action: () => Promise<unknown>, successText: string) => {
    setBusyAction(key);
    setNotice(null);
    try {
      const response = await action() as { success?: boolean; error?: string };
      if (response?.error) throw new Error(response.error);
      setNotice({ kind: 'success', text: successText });
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Операция не выполнена',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const importContext = async (file: File) => {
    if (file.size > 2_000_000) {
      setNotice({ kind: 'error', text: 'Файл контекста должен быть меньше 2 МБ' });
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error('Файл пуст');
      setBusyAction('prepare-legend');
      setNotice({ kind: 'info', text: 'AI собирает компактный профиль легенды…' });
      const response = await send<{ success?: boolean; error?: string }>({
        type: 'QUESTIONNAIRE_PREPARE_LEGEND',
        name: file.name,
        content: text,
      });
      if (response.error) throw new Error(response.error);
      setNotice({ kind: 'success', text: `AI-профиль легенды готов: ${file.name}` });
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Не удалось обработать файл контекста',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const revise = (
    item: QuestionnaireQueueItem,
    questionId: string,
    value: { text?: string; selectedValues?: string[] }
  ) => run(
    `revise:${item.questionnaire.id}:${questionId}`,
    () => send({
      type: 'QUESTIONNAIRE_REVISE_ANSWER',
      id: item.questionnaire.id,
      questionId,
      value,
    }),
    'Ответ сохранён'
  );

  return (
    <details className="questionnaire-panel">
      <summary className="questionnaire-panel-summary">
        <span>
          <span className="questionnaire-spark" aria-hidden="true">✦</span>
          <span>
            <strong>Заполнение анкет с AI</strong>
            <small>{manualQuestionnaireCount > 0
              ? `Backend-приёмка · ожидает: ${manualQuestionnaireCount}`
              : 'Backend-приёмка черновиков перед заполнением'}</small>
          </span>
        </span>
        <span className="questionnaire-summary-meta">
          <span className="beta-badge">Beta</span>
          {actionableCount > 0 && <span className="section-count">{actionableCount}</span>}
        </span>
      </summary>
      <div className="questionnaire-panel-body">
      <AIProviderWorkspace provider={settings.provider} onPatch={onPatch} />

      <div className="questionnaire-context">
        <div className="questionnaire-context-heading">
          <strong>Контекст AI</strong>
          <small>Один файл-легенда + выбранное резюме HH</small>
        </div>
        <div className="questionnaire-context-sources">
          <div data-ready={Boolean(settings.context.legendFile)}>
            <span>{settings.context.legendFile ? '✓' : '1'}</span>
            <div>
              <strong>{settings.context.legendFile?.name || 'Загрузите легенду'}</strong>
              <small>{settings.context.legendFile
                ? settings.context.legendFile.artifact
                  ? `${settings.context.legendFile.artifact.preparationMode === 'source_fallback'
                    ? 'Профиль собран из файла — AI-ответ был повреждён'
                    : 'AI-профиль готов'} · ${settings.context.legendFile.artifact.confirmedFacts.length} фактов · ${settings.context.legendFile.artifact.inferredDefaults.length} предположений`
                  : `${settings.context.legendFile.content.length.toLocaleString('ru-RU')} символов · требуется AI-анализ`
                : 'Поддерживаются .md, .txt и .json до 2 МБ'}</small>
            </div>
          </div>
          <div data-ready={Boolean(selectedResume)}>
            <span>{selectedResume ? '✓' : '2'}</span>
            <div>
              <strong>{selectedResume?.title || 'Выберите резюме выше'}</strong>
              <small>{selectedResume
                ? 'Текст резюме будет добавлен автоматически'
                : 'Без резюме обработка не начнётся'}</small>
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
              ? 'Анализируем…'
              : settings.context.legendFile
                ? 'Заменить легенду'
                : 'Загрузить легенду'}
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
                  'AI-профиль легенды пересобран'
                );
              }}
            >
              Пересобрать AI-профиль
            </button>
          )}
          {settings.context.legendFile && (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => onPatch({ context: { legendFile: null } })}
            >
              Удалить
            </button>
          )}
          <small>Файл хранится только на этом компьютере.</small>
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
                <strong>Предположения для обязательной проверки</strong>
                {settings.context.legendFile.artifact.inferredDefaults.map(item => (
                  <span key={item.key}>{item.key}: {item.value}</span>
                ))}
              </div>
            )}
          </details>
        )}
      </div>

      <div className="questionnaire-review-flow" aria-label="Этапы обработки анкеты">
        <span><b>1</b>Нажмите AI у анкеты</span>
        <span><b>2</b>Вы проверяете и правите</span>
        <span><b>3</b>Одобряете отправку</span>
      </div>

      {notice && <div className="questionnaire-notice" data-kind={notice.kind}>{notice.text}</div>}
      {state.lastError && <div className="questionnaire-notice" data-kind="error">{state.lastError}</div>}

      <div className="questionnaire-queue">
        {state.queue.length === 0 && (
          <div className="empty-state-mini">
            <span className="empty-state-check">✓</span>
            <span><strong>Приёмка пока пуста</strong><small>Нажмите «Заполнить с AI» у нужной анкеты выше.</small></span>
          </div>
        )}
        {state.queue.map(item => (
          <QuestionnaireQueueCard
            key={item.questionnaire.id}
            item={item}
            busyAction={busyAction}
            onRun={run}
            onRevise={revise}
            confirmingSubmit={confirmingSubmitId === item.questionnaire.id}
            onConfirmingSubmit={value => setConfirmingSubmitId(value ? item.questionnaire.id : null)}
          />
        ))}
      </div>
      </div>
    </details>
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
  confirmingSubmit: boolean;
  onConfirmingSubmit: (value: boolean) => void;
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
  confirmingSubmit,
  onConfirmingSubmit,
}) => {
  const id = item.questionnaire.id;
  const vacancyTitle = item.vacancyTitle
    ? extractBackendPageText(item.vacancyTitle)
    : `Вакансия ${item.questionnaire.vacancyId}`;
  const company = item.company ? extractBackendPageText(item.company) : '';
  const primaryAction = ['detected', 'ready_for_ai', 'failed'].includes(item.status)
    ? {
        key: `process:${id}`,
        label: 'Сгенерировать',
        message: { type: 'QUESTIONNAIRE_PROCESS_ONE', id },
        successText: 'Черновик подготовлен',
        confirmText: undefined,
      }
    : item.status === 'needs_review'
      ? {
          key: `submit:${id}`,
          label: 'Одобрить и отправить',
          message: { type: 'QUESTIONNAIRE_APPROVE_AND_SUBMIT', id },
          successText: 'Анкета отправлена в HH',
          confirmText: 'Отправить этот отклик с проверенными ответами?',
        }
      : item.status === 'approved'
        ? {
            key: `submit:${id}`,
            label: 'Отправить в HH',
            message: { type: 'QUESTIONNAIRE_APPROVE_AND_SUBMIT', id },
            successText: 'Анкета отправлена в HH',
            confirmText: 'Отправить этот отклик с проверенными ответами?',
          }
        : null;
  return (
    <details className="questionnaire-card" open={item.status === 'needs_review'}>
      <summary>
        <span>
          <strong>{vacancyTitle}</strong>
          <small>
            {company ? `${company} · ` : ''}
            {item.questionnaire.questions.length} вопросов · Backend
          </small>
        </span>
        <span className="questionnaire-status" data-status={item.status}>{STATUS_LABELS[item.status]}</span>
      </summary>

      {item.error && <div className="questionnaire-notice" data-kind="error">{item.error}</div>}
      <div className="questionnaire-answers">
        {item.questionnaire.questions.map(question => {
          const answer = answerFor(item, question.id);
          const selected = answer?.selectedValues ?? [];
          return (
            <div className="questionnaire-answer" key={question.id}>
              <div className="questionnaire-question">
                <strong>{question.prompt}</strong>
                {question.required && <span>обязательно</span>}
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
                  placeholder="Нет предложенного ответа"
                />
              )}
              {answer && (
                <div className="questionnaire-answer-meta">
                  <span>{Math.round(answer.confidence * 100)}% уверенность</span>
                  <span>{answer.evidence.length} источников</span>
                  {answer.warning && <span className="is-warning">{answer.warning}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="questionnaire-card-actions">
        {primaryAction && (
          primaryAction.confirmText
            ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busyAction === primaryAction.key}
                  onClick={() => onConfirmingSubmit(true)}
                >
                  {primaryAction.label}
                </button>
              )
            : (
                <QueueActionButton
                  actionKey={primaryAction.key}
                  className="btn btn-primary btn-sm"
                  disabled={busyAction === primaryAction.key}
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
            label="Сгенерировать заново"
            message={{ type: 'QUESTIONNAIRE_PROCESS_ONE', id }}
            onRun={onRun}
            successText="Черновик обновлён"
          />
        )}
        {['detected', 'ready_for_ai', 'needs_review', 'approved', 'failed'].includes(item.status) && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => onRun(
              `skip:${id}`,
              () => send({ type: 'QUESTIONNAIRE_SKIP', id }),
              'Опросник пропущен'
            )}
          >
            Пропустить
          </button>
        )}
      </div>
      {confirmingSubmit && primaryAction?.confirmText && (
        <div className="questionnaire-submit-confirmation" role="alert">
          <strong>Отправить отклик в HH?</strong>
          <span>Будут отправлены ответы из этого проверенного черновика. Отменить отправку после подтверждения нельзя.</span>
          <div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onConfirmingSubmit(false)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busyAction === primaryAction.key}
              onClick={() => {
                void onRun(
                  primaryAction.key,
                  () => send(primaryAction.message),
                  primaryAction.successText
                ).finally(() => onConfirmingSubmit(false));
              }}
            >
              Подтвердить отправку
            </button>
          </div>
        </div>
      )}
    </details>
  );
};
