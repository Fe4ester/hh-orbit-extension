import { t } from '../src/i18n';
import React from 'react';
import type { AutoApplyMode, LocalApplyAttempt, VacancyQueueItem } from '../src/state/types';
import { Icon } from './icons';
import { ManualActionsPanel } from '../src/components/ManualActionsPanel';

export type LaunchScreenName = 'start' | 'running' | 'review' | 'stopped' | 'error';

export type ManualActionItem = {
  id: string;
  type: string;
  title: string;
  company: string;
  vacancyId: string | null;
  url: string;
  reasonCode: string;
  createdAt: number;
};

export interface LaunchScreenProps {
  screen: LaunchScreenName;
  runtime: {
    runtimeState: string;
    phaseLabel: string;
    processed: number;
    success: number;
    manualActions: number;
    pausedReason: string | null;
    canStart: boolean;
    canStop: boolean;
  };
  todaySuccess: number;
  recentAttempts?: LocalApplyAttempt[];
  vacancies?: VacancyQueueItem[];
  currentVacancyId?: string | null;
  manualActions: ManualActionItem[];
  preparedActionIds?: string[];
  readiness: {
    profileDone: boolean;
    resumeDone: boolean;
    profileName: string | null;
    resumeLabel: string | null;
  };
  limitsLabel: string;
  mode: AutoApplyMode;
  startError: string | null;
  lastError: string | null;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onGoToProfile: () => void;
  onGoToSettings: () => void;
  onOpenLogs: () => void;
  onOpenAction: (url: string) => void;
  onDoneAction: (id: string) => void;
  onDismissAction: (id: string) => void;
  onFillManual?: (id: string) => Promise<{ success?: boolean; error?: string }>;
  onPrepareAI?: (id: string) => Promise<{ success?: boolean; error?: string }>;
}

const SAFETY_START = 'Расширение откликается только на подходящие вакансии и останавливается перед шагами, которые требуют вас.';
const SAFETY_REVIEW = 'Сначала вы решаете. Отправка и продолжение — только после вашего подтверждения.';

const ChecklistItem: React.FC<{
  index: number;
  done: boolean;
  title: string;
  detail: string;
  actionLabel: string;
  onAction: () => void;
}> = ({ index, done, title, detail, actionLabel, onAction }) => (
  <div className={`check${done ? ' done' : ''}`}>
    <span className="check-num" aria-hidden="true">{done ? <Icon name="check" /> : index}</span>
    <div className="check-copy">
      <b>{title}</b>
      <small>{detail}</small>
    </div>
    {!done && (
      <button type="button" className="check-action" onClick={onAction}>
        {actionLabel}
        <Icon name="chevron-right" />
      </button>
    )}
  </div>
);

export const LaunchScreen: React.FC<LaunchScreenProps> = ({
  screen,
  runtime,
  todaySuccess,
  recentAttempts = [],
  vacancies = [],
  currentVacancyId,
  manualActions,
  preparedActionIds,
  readiness,
  limitsLabel,
  mode,
  startError,
  lastError,
  busy,
  onStart,
  onStop,
  onGoToProfile,
  onGoToSettings,
  onOpenLogs,
  onOpenAction,
  onDoneAction,
  onDismissAction,
  onFillManual,
  onPrepareAI,
}) => {
  const ready = readiness.profileDone && readiness.resumeDone;
  const hasManual = manualActions.length > 0;

  const numbers = (
    <div className="numbers" aria-label={t("Статистика запуска")}>
      <div><b>{runtime.processed}</b><span>{t("обработано")}</span></div>
      <div><b>{runtime.success}</b><span>{t("успех")}</span></div>
      <div><b>{todaySuccess}</b><span>{t("сегодня")}</span></div>
      <div><b>{runtime.manualActions}</b><span>{t("вручную")}</span></div>
    </div>
  );

  if (screen === 'start') {
    return (
      <section className="screen screen-start" aria-labelledby="screen-title">
        <h2 id="screen-title">{t("Подготовьте запуск")}</h2>
        <p className="intro">{t("Настройте основу один раз. Параметры можно изменить позже.")}</p>
        <div className="checklist">
          <ChecklistItem
            index={1}
            done={readiness.profileDone}
            title={readiness.profileDone ? t("Профиль выбран") : t("Выберите профиль")}
            detail={readiness.profileName ?? t("Профиль задаёт ключевые слова и сопроводительное письмо.")}
            actionLabel={t("Профиль")}
            onAction={onGoToProfile}
          />
          <ChecklistItem
            index={2}
            done={readiness.resumeDone}
            title={readiness.resumeDone ? t("Резюме выбрано") : t("Выберите резюме")}
            detail={readiness.resumeLabel ?? t("HH будет учитывать выбранное резюме как фильтр при поиске.")}
            actionLabel={t("Профиль")}
            onAction={onGoToProfile}
          />
          <ChecklistItem
            index={3}
            done
            title={t("Проверьте лимиты")}
            detail={limitsLabel}
            actionLabel={t("Настройки")}
            onAction={onGoToSettings}
          />
        </div>
        <div className="detail-strip">
          <div>
            <small>{t("Режим")}</small>
            <b>{mode === 'backend' ? t("В фоне") : t("В браузере")}</b>
          </div>
          <div>
            <small>{t("Ручные шаги")}</small>
            <b>{t("Остановка и запрос действия")}</b>
          </div>
        </div>
        {startError && <div className="error-block" role="alert"><b>{t("Не удалось запустить")}</b><p>{t(startError)}</p></div>}
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={onStart} disabled={!runtime.canStart || !ready}>
          <Icon name="play" />{t("Начать поиск") + " "}</button>
        {!ready && <p className="field-note">{t("Чтобы запустить поиск, выберите профиль и резюме.")}</p>}
        <div className="safety">
          <Icon name="shield" />
          <span>{t(SAFETY_START)}</span>
        </div>
      </section>
    );
  }

  if (screen === 'review') {
    return (
      <section className="screen screen-review" aria-labelledby="screen-title">
        <h2 id="screen-title">{t("Нужно ваше решение")}</h2>
        <p className="intro">{t("Отклик нельзя завершить автоматически, пока не разобраны ручные шаги.")}</p>
        <output className="attention">
          <span className="attention-badge">{manualActions.length}</span>
          <span className="attention-copy">
            <b>{t("Ждут внимания")}</b>
            <span>{t("Нажмите \"Заполнить\" для анкеты или откройте HH для других действий.")}</span>
          </span>
        </output>
        <div className="review-restart">
          <button type="button" className="btn btn-primary btn-block" onClick={onStart} disabled={!runtime.canStart || !ready}>
            <Icon name="play" />{t("Запустить новый поиск")}
          </button>
          <p className="field-note">
            {runtime.canStart
              ? ready
                ? t("Ручные действия останутся в списке.")
                : t("Чтобы запустить поиск, выберите профиль и резюме.")
              : t("Новый поиск доступен после остановки текущего запуска.")}
          </p>
          {startError && <div className="error-block" role="alert"><b>{t("Не удалось запустить")}</b><p>{t(startError)}</p></div>}
        </div>
        <ManualActionsPanel
          actions={manualActions}
          onOpen={onOpenAction}
          onDone={onDoneAction}
          onDismiss={onDismissAction}
          preparedActionIds={preparedActionIds}
          onFillManual={onFillManual}
          onPrepareAI={onPrepareAI}
        />
        <div className="safety">
          <Icon name="info" />
          <span>{t(SAFETY_REVIEW)}</span>
        </div>
      </section>
    );
  }

  if (screen === 'running') {
    return (
      <section className="screen screen-running" aria-labelledby="screen-title">
        <h2 id="screen-title">{t("Маршрут на сегодня")}</h2>
        <p className="intro">{t("Ищем вакансии и готовим только подходящие отклики.")}</p>
        <output className="status-banner">
          <span className="status-dot" aria-hidden="true" />
          {runtime.phaseLabel}
        </output>
        <div className="result-callout">
          <div className="result-number"><span key={runtime.success}>{runtime.success}</span></div>
          <div className="result-copy">
            <b>{t("Отклики отправлены")}</b>
            <small>{hasManual ? t("{0} ручных действий ждут проверки", manualActions.length) : t("Результаты текущего запуска")}</small>
          </div>
        </div>
        {numbers}
        <div className="current-vacancy">
          <span>{t("Сейчас проверяем")}</span>
          <b>{vacancies.find(item => item.vacancyId === currentVacancyId)?.title
            || (currentVacancyId ? t("Вакансия #{0}", currentVacancyId) : runtime.phaseLabel)}</b>
        </div>
        <div className="activity">
          <div className="activity-head"><b>{t("Последние результаты")}</b></div>
          {recentAttempts.slice(0, 3).map(attempt => {
            const vacancy = vacancies.find(item => item.vacancyId === attempt.vacancyId);
            const kind = attempt.outcome === 'SUCCEEDED' ? 'ready'
              : attempt.outcome === 'MANUAL_ACTION_REQUIRED' || attempt.outcome === 'ESCALATED' ? 'review' : 'skip';
            return <div key={attempt.id} className="activity-row" data-kind={kind}>
              <span className="activity-icon"><Icon name={kind === 'ready' ? 'check' : kind === 'review' ? 'file-question' : 'minus'} /></span>
              <div><b>{vacancy?.title || (attempt.vacancyId ? t("Вакансия #{0}", attempt.vacancyId) : t("Обработка вакансии"))}</b><small>{t(attempt.message)}</small></div>
            </div>;
          })}
          {recentAttempts.length === 0 && <p className="activity-empty">{t("Результаты появятся после обработки первой вакансии.")}</p>}
        </div>
        {lastError && (
          <div className="error-block" role="alert">
            <b>{t("Последняя ошибка")}</b>
            <p>{t(lastError)}</p>
          </div>
        )}
        <button type="button" className="btn btn-secondary btn-block" onClick={onStop} disabled={!runtime.canStop}>
          <Icon name="stop" />{t("Остановить поиск") + " "}</button>
      </section>
    );
  }

  if (screen === 'error') {
    return (
      <section className="screen screen-error" aria-labelledby="screen-title">
        <h2 id="screen-title">{t("Поиск прервался")}</h2>
        <p className="intro">{t("Проверьте соединение с HH и запустите повторно.")}</p>
        <div className="error-block" role="alert">
          <b>{t("Ошибка запуска")}</b>
          <p>{lastError ?? t("Неизвестная ошибка. Подробности в журнале.")}</p>
          <button type="button" className="error-retry" onClick={onOpenLogs}>{t("Открыть журнал")}</button>
        </div>
        {numbers}
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={onStart} disabled={!runtime.canStart}>
          <Icon name="refresh" />{t("Запустить повторно") + " "}</button>
        {!runtime.canStart && (
          <p className="field-note">{t("Повторный запуск сейчас недоступен. Откройте журнал для диагностики или перезагрузите расширение.")}</p>
        )}
      </section>
    );
  }

  const stoppedCopy: Record<string, { title: string; text: string }> = {
    PAUSED_NO_VACANCIES: {
      title: t("Подходящие вакансии закончились"),
      text: t("Новые вакансии появятся позже. Запустите повторно или ослабьте фильтры профиля."),
    },
    no_vacancies: {
      title: t("Подходящие вакансии закончились"),
      text: t("Новые вакансии появятся позже. Запустите повторно или ослабьте фильтры профиля."),
    },
    PAUSED_BY_USER: {
      title: t("Поиск остановлен"),
      text: t("Запуск можно продолжить в любой момент."),
    },
  };
  const stoppedInfo = stoppedCopy[runtime.pausedReason ?? runtime.runtimeState] ?? {
    title: t("Поиск остановлен"),
    text: t("Запустите повторно, когда будете готовы."),
  };
  const vacanciesExhausted = runtime.pausedReason === 'no_vacancies'
    || runtime.runtimeState === 'PAUSED_NO_VACANCIES';

  return (
    <section className="screen screen-stopped" aria-labelledby="screen-title">
      <h2 id="screen-title">{stoppedInfo.title}</h2>
      <p className="intro">{stoppedInfo.text}</p>
      <div className="stopped-dashboard">
        <div className={`route-status${vacanciesExhausted ? ' route-status-complete' : ''}`}>
          <div>
            <b>{vacanciesExhausted ? t("Маршрут завершён") : t("Поиск на паузе")}</b>
            <span>{vacanciesExhausted ? t("Новые вакансии появятся позже") : t("Текущий прогресс сохранён")}</span>
          </div>
        </div>
        {runtime.processed > 0 && (
          <div className="detail-strip">
            <div>
              <small>{t("Проверено")}</small>
              <b>{runtime.processed}{" " + t("вакансий")}</b>
            </div>
            <div>
              <small>{t("Успешных откликов")}</small>
              <b>{runtime.success}</b>
            </div>
          </div>
        )}
      </div>
      <h2 className="next-step-title">{t("Что можно сделать")}</h2>
      <p className="intro">{vacanciesExhausted ? t("Расширьте условия поиска или уберите один из фильтров.") : t("Продолжите поиск или измените условия перед новым запуском.")}</p>
      {lastError && (
        <div className="error-block" role="alert">
          <b>{t("Была ошибка")}</b>
          <p>{t(lastError)}</p>
        </div>
      )}
      <div className="stopped-actions">
        {vacanciesExhausted ? (
          <>
            <button type="button" className="btn btn-primary btn-block btn-lg" onClick={onGoToProfile} disabled={busy}>{t("Изменить условия поиска") + " "}</button>
            <button type="button" className="btn btn-secondary btn-block" onClick={onStart} disabled={!runtime.canStart}>
              <Icon name="play" />{t("Запустить повторно") + " "}</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-block btn-lg" onClick={onStart} disabled={!runtime.canStart}>
              <Icon name="play" />{t("Запустить повторно") + " "}</button>
            <button type="button" className="btn btn-secondary btn-block" onClick={onGoToProfile} disabled={busy}>{t("Изменить условия поиска") + " "}</button>
          </>
        )}
      </div>
    </section>
  );
};
