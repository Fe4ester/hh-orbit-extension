import { AppState } from '../../state/types';

interface PreflightPanelProps {
  state: AppState;
  onObserveVacancyDetail: () => void;
  onClearPreflight: () => void;
}

export function PreflightPanel({
  state,
  onObserveVacancyDetail,
  onClearPreflight,
}: PreflightPanelProps) {
  const { liveMode } = state;
  const { vacancyDetailObservation, preflightClassification } = liveMode;

  const isVacancyPage = liveMode.pageType === 'vacancy';
  const hasControlledTab = liveMode.controlledTabId !== null;

  const getSeverityClass = (severity: string) => {
    switch (severity) {
      case 'success':
        return 'preflight-severity-success';
      case 'info':
        return 'preflight-severity-info';
      case 'warn':
        return 'preflight-severity-warn';
      case 'error':
        return 'preflight-severity-error';
      default:
        return '';
    }
  };

  const getCodeLabel = (code: string) => {
    switch (code) {
      case 'can_apply':
        return 'Можно откликнуться';
      case 'login_required':
        return 'Требуется вход';
      case 'resume_required':
        return 'Требуется резюме';
      case 'cover_letter_required':
        return 'Рекомендуется письмо';
      case 'external_apply':
        return 'Внешний отклик';
      case 'already_applied':
        return 'Уже откликались';
      case 'archived_or_unavailable':
        return 'Архивирована';
      case 'questionnaire_possible':
        return 'Возможна анкета';
      case 'unknown':
        return 'Неизвестно';
      default:
        return code;
    }
  };

  return (
    <div className="preflight-panel">
      <div className="preflight-header">
        <h3>Preflight проверка</h3>
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

      <div className="preflight-actions">
        <button
          onClick={onObserveVacancyDetail}
          disabled={!hasControlledTab || !isVacancyPage}
          className="btn btn-primary"
        >
          Проверить вакансию
        </button>
        {preflightClassification && (
          <button onClick={onClearPreflight} className="btn btn-secondary">
            Очистить
          </button>
        )}
      </div>

      {preflightClassification && (
        <div className="preflight-result">
          <div className="preflight-classification">
            <span
              className={`preflight-code ${getSeverityClass(preflightClassification.severity)}`}
            >
              {getCodeLabel(preflightClassification.code)}
            </span>
            <p className="preflight-message">{preflightClassification.message}</p>
          </div>

          {vacancyDetailObservation && (
            <div className="preflight-details">
              {vacancyDetailObservation.title && (
                <div className="preflight-detail-item">
                  <strong>Вакансия:</strong> {vacancyDetailObservation.title}
                </div>
              )}
              {vacancyDetailObservation.company && (
                <div className="preflight-detail-item">
                  <strong>Компания:</strong> {vacancyDetailObservation.company}
                </div>
              )}
              {vacancyDetailObservation.vacancyId && (
                <div className="preflight-detail-item">
                  <strong>ID:</strong> {vacancyDetailObservation.vacancyId}
                </div>
              )}

              <div className="preflight-flags">
                {vacancyDetailObservation.hasRespondButton && (
                  <span className="preflight-flag preflight-flag-success">
                    Кнопка отклика
                  </span>
                )}
                {vacancyDetailObservation.coverLetterHint && (
                  <span className="preflight-flag preflight-flag-info">
                    Сопроводительное письмо
                  </span>
                )}
                {vacancyDetailObservation.alreadyApplied && (
                  <span className="preflight-flag preflight-flag-warn">
                    Уже откликались
                  </span>
                )}
                {vacancyDetailObservation.externalApply && (
                  <span className="preflight-flag preflight-flag-warn">
                    Внешний отклик
                  </span>
                )}
                {vacancyDetailObservation.archivedOrUnavailable && (
                  <span className="preflight-flag preflight-flag-error">
                    Архивирована
                  </span>
                )}
                {vacancyDetailObservation.questionnaireHint && (
                  <span className="preflight-flag preflight-flag-info">
                    Анкета
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!preflightClassification && hasControlledTab && isVacancyPage && (
        <div className="preflight-empty">
          Нажмите "Проверить вакансию" для анализа страницы.
        </div>
      )}
    </div>
  );
}
