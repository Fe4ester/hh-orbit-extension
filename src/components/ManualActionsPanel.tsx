import { t } from '../i18n';
import React, { useState } from 'react';

interface ManualActionItem {
  id: string;
  type: string;
  title: string;
  company: string;
  vacancyId: string | null;
  url: string;
  reasonCode: string;
}

interface ManualActionsPanelProps {
  actions: ManualActionItem[];
  onOpen: (url: string) => void;
  onDone: (id: string) => void;
  onDismiss: (id: string) => void;
  preparedActionIds?: string[];
  onFillManual?: (id: string) => Promise<{ success?: boolean; error?: string }>;
  onPrepareAI?: (id: string) => Promise<{ success?: boolean; error?: string }>;
}

const ITEMS_PER_PAGE = 10;

const REASON_LABELS: Record<string, string> = {
  questionnaire_required: 'Нужно заполнить анкету',
  test_required: 'Нужно выполнить тест',
  cover_letter_required: 'Нужно сопроводительное письмо',
  external_apply: 'Отклик на внешнем сайте',
  login_required: 'Нужно войти в HH',
  captcha_required: 'Нужно пройти проверку',
};

const ManualTypeIcon: React.FC<{ type: string }> = ({ type }) => (
  <svg className="manual-type-icon" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {type === 'test' || type === 'questionnaire'
      ? <><path d="M5 2.5h6l2 2v11H5z" /><path d="M8 7h2M8 10h2M8 13h2" /></>
      : type === 'captcha' || type === 'login_required'
        ? <><rect x="3.5" y="7.5" width="11" height="8" rx="2" /><path d="M6 7.5V6a3 3 0 0 1 6 0v1.5" /></>
        : <><circle cx="9" cy="9" r="6" /><path d="M9 5.5v4M9 12.5h.01" /></>}
  </svg>
);

export const ManualActionsPanel: React.FC<ManualActionsPanelProps> = ({
  actions,
  onOpen,
  onDone,
  onDismiss,
  preparedActionIds = [],
  onFillManual,
  onPrepareAI,
}) => {
  const [currentPage, setCurrentPage] = useState(0);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [preparingMode, setPreparingMode] = useState<'manual' | 'ai' | null>(null);
  const [preparationErrors, setPreparationErrors] = useState<Record<string, string>>({});
  const preparedActions = new Set(preparedActionIds);

  const totalPages = Math.ceil(actions.length / ITEMS_PER_PAGE);

  const validCurrentPage = totalPages > 0 ? Math.min(currentPage, totalPages - 1) : 0;

  const startIndex = validCurrentPage * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentActions = actions.slice(startIndex, endIndex);

  const handlePrevPage = () => {
    setCurrentPage(Math.max(0, validCurrentPage - 1));
  };

  const handleNextPage = () => {
    setCurrentPage(Math.min(totalPages - 1, validCurrentPage + 1));
  };

  const handlePrepare = async (
    id: string,
    mode: 'manual' | 'ai',
    action: ((id: string) => Promise<{ success?: boolean; error?: string }>) | undefined
  ) => {
    if (!action) return;
    setPreparingId(id);
    setPreparingMode(mode);
    setPreparationErrors(current => ({ ...current, [id]: '' }));
    try {
      const response = await action(id);
      if (response?.error) throw new Error(response.error);
    } catch (error) {
      setPreparationErrors(current => ({
        ...current,
        [id]: error instanceof Error ? error.message : t("Не удалось подготовить черновик"),
      }));
    } finally {
      setPreparingId(null);
      setPreparingMode(null);
    }
  };

  return (
    <div className="manual-actions-list">
      <div className="manual-actions-header">
        <strong>{t("Ожидают:") + " "}{actions.length}</strong>
      </div>
      {currentActions.map((action) => (
        <article key={action.id} className="manual-action-item">
          <div className="manual-action-leading"><span className="manual-type-mark"><ManualTypeIcon type={action.type} /></span>
            <div className="manual-action-copy">
              <div className="manual-action-title" title={action.title}>{action.title}</div>
              <small title={action.company}>{action.company}{action.vacancyId ? ` · #${action.vacancyId}` : ''}</small>
              <div className="manual-action-reason">{t(REASON_LABELS[action.reasonCode] || action.type)}</div>
            </div>
          </div>
          <div className="manual-actions-buttons">
            {onFillManual && (action.type === 'test' || action.type === 'questionnaire') && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handlePrepare(action.id, 'manual', onFillManual)}
                disabled={preparingId === action.id}
              >
                {preparingId === action.id && preparingMode === 'manual'
                  ? t("Открываем…")
                  : preparedActions.has(action.id) ? t("Продолжить") : t("Заполнить")}
              </button>
            )}
            {onPrepareAI && (action.type === 'test' || action.type === 'questionnaire') && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void handlePrepare(action.id, 'ai', onPrepareAI)}
                disabled={preparingId === action.id}
              >
                {preparingId === action.id && preparingMode === 'ai'
                  ? t("AI готовит…")
                  : preparedActions.has(action.id) ? t("Обновить с AI") : t("Заполнить с AI")}
              </button>
            )}
            <button type="button" className="text-action manual-open-link"
              onClick={() => onOpen(action.url)}
              disabled={!action.url}
            >{t("Открыть") + " "}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onDone(action.id)}>{t("Готово") + " "}</button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => onDismiss(action.id)}>{t("Скрыть") + " "}</button>
          </div>
          {preparationErrors[action.id] && (
            <div className="manual-action-error">{preparationErrors[action.id]}</div>
          )}
        </article>
      ))}
      {actions.length === 0 && <div className="empty-state-mini"><span className="empty-state-check">✓</span><span><strong>{t("Всё спокойно")}</strong>{t("Нет действий, требующих вашего внимания.")}</span></div>}
      {totalPages > 1 && (
        <div className="pagination-controls">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handlePrevPage}
            disabled={validCurrentPage === 0}
          >{t("Назад") + " "}</button>
          <span className="pagination-info">{t("Страница") + " "}{validCurrentPage + 1}{" " + t("из") + " "}{totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleNextPage}
            disabled={validCurrentPage >= totalPages - 1}
          >{t("Вперёд") + " "}</button>
        </div>
      )}
    </div>
  );
};
