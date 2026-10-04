import React from 'react';
import type { AutoApplyMode } from '../src/state/types';
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
  manualActions: ManualActionItem[];
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
  manualActions,
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
  onPrepareAI,
}) => {
  const ready = readiness.profileDone && readiness.resumeDone;
  const hasManual = manualActions.length > 0;

  const numbers = (
    <div className="numbers" aria-label="Статистика запуска">
      <div><b>{runtime.processed}</b><span>обработано</span></div>
      <div><b>{runtime.success}</b><span>успех</span></div>
      <div><b>{todaySuccess}</b><span>сегодня</span></div>
      <div><b>{runtime.manualActions}</b><span>вручную</span></div>
    </div>
  );

  if (screen === 'start') {
    return (
      <section className="screen" aria-labelledby="screen-title">
        <p className="eyebrow">Первый шаг</p>
        <h2 id="screen-title">Подготовьте запуск</h2>
        <p className="intro">Настройте основу один раз. Параметры можно изменить позже.</p>
        <div className="checklist">
          <ChecklistItem
            index={1}
            done={readiness.profileDone}
            title={readiness.profileDone ? 'Профиль выбран' : 'Выберите профиль'}
            detail={readiness.profileName ?? 'Профиль задаёт ключевые слова и сопроводительное письмо.'}
            actionLabel="Профиль"
            onAction={onGoToProfile}
          />
          <ChecklistItem
            index={2}
            done={readiness.resumeDone}
            title={readiness.resumeDone ? 'Резюме выбрано' : 'Выберите резюме'}
            detail={readiness.resumeLabel ?? 'HH будет учитывать выбранное резюме как фильтр при поиске.'}
            actionLabel="Профиль"
            onAction={onGoToProfile}
          />
          <ChecklistItem
            index={3}
            done
            title="Проверьте лимиты"
            detail={limitsLabel}
            actionLabel="Настройки"
            onAction={onGoToSettings}
          />
        </div>
        <div className="detail-strip">
          <div>
            <small>Режим</small>
            <b>{mode === 'backend' ? 'В фоне' : 'В браузере'}</b>
          </div>
          <div>
            <small>Ручные шаги</small>
            <b>Остановка и запрос действия</b>
          </div>
        </div>
        {startError && <div className="error-block" role="alert"><b>Не удалось запустить</b><p>{startError}</p></div>}
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={onStart} disabled={!runtime.canStart || !ready}>
          <Icon name="play" />Начать поиск
        </button>
        {!ready && <p className="field-note">Чтобы запустить поиск, выберите профиль и резюме.</p>}
        <div className="safety">
          <Icon name="shield" />
          <span>{SAFETY_START}</span>
        </div>
      </section>
    );
  }

  if (screen === 'review') {
    return (
      <section className="screen" aria-labelledby="screen-title">
        <p className="eyebrow">Требуется действие</p>
        <h2 id="screen-title">Нужно ваше решение</h2>
        <p className="intro">Отклик нельзя завершить автоматически, пока не разобраны ручные шаги.</p>
        <div className="attention" role="status">
          <span className="attention-badge">{manualActions.length}</span>
          <div>
            <b>Ждут внимания</b>
            <span>Откройте вакансию, разберите шаг и отметьте готово.</span>
          </div>
        </div>
        <ManualActionsPanel
          actions={manualActions}
          onOpen={onOpenAction}
          onDone={onDoneAction}
          onDismiss={onDismissAction}
          onPrepareAI={onPrepareAI}
        />
        <div className="safety">
          <Icon name="info" />
          <span>{SAFETY_REVIEW}</span>
        </div>
      </section>
    );
  }

  if (screen === 'running') {
    return (
      <section className="screen" aria-labelledby="screen-title">
        <p className="eyebrow">Поиск работает</p>
        <h2 id="screen-title">Маршрут на сегодня</h2>
        <p className="intro">Ищем вакансии и готовим только подходящие отклики.</p>
        <div className="status-banner" role="status">
          <span className="status-dot" aria-hidden="true" />
          {runtime.phaseLabel}
        </div>
        {hasManual && (
          <div className="attention">
            <span className="attention-badge">{manualActions.length}</span>
            <div>
              <b>Появились ручные шаги</b>
              <span>Разберите их после текущей вакансии или на паузе.</span>
            </div>
          </div>
        )}
        {numbers}
        {lastError && (
          <div className="error-block" role="alert">
            <b>Последняя ошибка</b>
            <p>{lastError}</p>
          </div>
        )}
        <button type="button" className="btn btn-secondary btn-block" onClick={onStop} disabled={!runtime.canStop}>
          <Icon name="stop" />Остановить поиск
        </button>
      </section>
    );
  }

  if (screen === 'error') {
    return (
      <section className="screen" aria-labelledby="screen-title">
        <p className="eyebrow">Сбой</p>
        <h2 id="screen-title">Поиск прервался</h2>
        <p className="intro">Проверьте соединение с HH и запустите повторно.</p>
        <div className="error-block" role="alert">
          <b>Ошибка запуска</b>
          <p>{lastError ?? 'Неизвестная ошибка. Подробности в журнале.'}</p>
          <button type="button" className="error-retry" onClick={onOpenLogs}>Открыть журнал</button>
        </div>
        {numbers}
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={onStart} disabled={!runtime.canStart}>
          <Icon name="refresh" />Запустить повторно
        </button>
        {!runtime.canStart && (
          <p className="field-note">Повторный запуск сейчас недоступен. Откройте журнал для диагностики или перезагрузите расширение.</p>
        )}
      </section>
    );
  }

  const stoppedCopy: Record<string, { title: string; text: string }> = {
    PAUSED_NO_VACANCIES: {
      title: 'Подходящие вакансии закончились',
      text: 'Новые вакансии появятся позже. Запустите повторно или ослабьте фильтры профиля.',
    },
    no_vacancies: {
      title: 'Подходящие вакансии закончились',
      text: 'Новые вакансии появятся позже. Запустите повторно или ослабьте фильтры профиля.',
    },
    PAUSED_BY_USER: {
      title: 'Поиск остановлен',
      text: 'Запуск можно продолжить в любой момент.',
    },
  };
  const stoppedInfo = stoppedCopy[runtime.pausedReason ?? runtime.runtimeState] ?? {
    title: 'Поиск остановлен',
    text: 'Запустите повторно, когда будете готовы.',
  };

  return (
    <section className="screen" aria-labelledby="screen-title">
      <p className="eyebrow">Пауза</p>
      <h2 id="screen-title">{stoppedInfo.title}</h2>
      <p className="intro">{stoppedInfo.text}</p>
      {runtime.processed > 0 && (
        <div className="detail-strip">
          <div>
            <small>Проверено</small>
            <b>{runtime.processed} вакансий</b>
          </div>
          <div>
            <small>Успешных откликов</small>
            <b>{runtime.success}</b>
          </div>
        </div>
      )}
      {lastError && (
        <div className="error-block" role="alert">
          <b>Была ошибка</b>
          <p>{lastError}</p>
        </div>
      )}
      <button type="button" className="btn btn-primary btn-block btn-lg" onClick={onStart} disabled={!runtime.canStart}>
        <Icon name="play" />Запустить повторно
      </button>
      <button type="button" className="btn btn-secondary btn-block" onClick={onGoToProfile} disabled={busy}>
        Изменить условия поиска
      </button>
    </section>
  );
};
