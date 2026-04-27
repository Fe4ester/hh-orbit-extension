import { AppState } from '../../state/types';

interface ApplyExecutorPanelProps {
  state: AppState;
  onExecuteApplySkeleton: () => void;
  onExecuteRealClick: () => void;
  onClearAttempts: () => void;
}

export function ApplyExecutorPanel({
  state,
  onExecuteApplySkeleton,
  onExecuteRealClick,
  onClearAttempts,
}: ApplyExecutorPanelProps) {
  const { liveMode, applyAttempts } = state;

  const isVacancyPage = liveMode.pageType === 'vacancy';
  const hasControlledTab = liveMode.controlledTabId !== null;

  // Show last 10 attempts
  const recentAttempts = applyAttempts.slice(-10).reverse();

  const getOutcomeClass = (outcome: string) => {
    switch (outcome) {
      case 'success':
        return 'apply-outcome-success';
      case 'already_applied':
        return 'apply-outcome-info';
      case 'login_required':
      case 'apply_unavailable':
        return 'apply-outcome-error';
      case 'resume_required':
      case 'cover_letter_required':
      case 'external_apply':
      case 'questionnaire_required':
        return 'apply-outcome-warn';
      default:
        return 'apply-outcome-unknown';
    }
  };

  const getOutcomeLabel = (outcome: string) => {
    switch (outcome) {
      case 'success':
        return 'Успех (dry-run)';
      case 'already_applied':
        return 'Уже откликались';
      case 'login_required':
        return 'Требуется вход';
      case 'resume_required':
        return 'Требуется резюме';
      case 'cover_letter_required':
        return 'Требуется письмо';
      case 'external_apply':
        return 'Внешний отклик';
      case 'questionnaire_required':
        return 'Требуется анкета';
      case 'apply_unavailable':
        return 'Недоступно';
      case 'unknown':
        return 'Неизвестно';
      default:
        return outcome;
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="apply-executor-panel">
      <div className="apply-executor-header">
        <h3>Apply Executor (Skeleton)</h3>
        <span className="apply-executor-count">Попыток: {applyAttempts.length}</span>
      </div>

      {!hasControlledTab && (
        <div className="warning-box">
          Нет контролируемой вкладки. Запустите Live mode.
        </div>
      )}

      {hasControlledTab && !isVacancyPage && (
        <div className="warning-box">
          Контролируемая вкладка не является страницей вакансии.
        </div>
      )}

      <div className="apply-executor-actions">
        <button
          onClick={onExecuteApplySkeleton}
          disabled={!hasControlledTab || !isVacancyPage}
          className="btn btn-secondary"
        >
          Dry-run skeleton
        </button>
        <button
          onClick={onExecuteRealClick}
          disabled={!hasControlledTab || !isVacancyPage}
          className="btn btn-primary"
        >
          Real click apply
        </button>
        <button
          onClick={onClearAttempts}
          disabled={applyAttempts.length === 0}
          className="btn btn-secondary"
        >
          Очистить историю
        </button>
      </div>

      {recentAttempts.length > 0 && (
        <div className="apply-executor-list">
          <h4>Последние попытки:</h4>
          {recentAttempts.map((attempt) => (
            <div key={attempt.id} className="apply-executor-item">
              <div className="apply-executor-item-header">
                <span className={`apply-outcome-badge ${getOutcomeClass(attempt.outcome)}`}>
                  {getOutcomeLabel(attempt.outcome)}
                </span>
                <span className="apply-executor-item-time">
                  {formatTimestamp(attempt.createdAt)}
                </span>
              </div>
              <div className="apply-executor-item-message">{attempt.message}</div>
              {attempt.vacancyId && (
                <div className="apply-executor-item-meta">
                  Vacancy ID: {attempt.vacancyId}
                </div>
              )}
              {attempt.metadata?.dryRun && (
                <div className="apply-executor-item-meta">
                  <span className="apply-dry-run-badge">DRY RUN</span>
                </div>
              )}
              {attempt.metadata?.realClick && (
                <div className="apply-executor-item-meta">
                  <span className="apply-real-click-badge">REAL CLICK</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {applyAttempts.length === 0 && (
        <div className="apply-executor-empty">
          История пуста. Нажмите "Выполнить apply skeleton" для тестирования.
        </div>
      )}
    </div>
  );
}
