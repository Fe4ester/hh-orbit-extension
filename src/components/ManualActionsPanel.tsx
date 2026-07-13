import React, { useState, useEffect } from 'react';

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
}) => {
  const [currentPage, setCurrentPage] = useState(0);

  const totalPages = Math.ceil(actions.length / ITEMS_PER_PAGE);

  const validCurrentPage = totalPages > 0 ? Math.min(currentPage, totalPages - 1) : 0;

  const startIndex = validCurrentPage * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentActions = actions.slice(startIndex, endIndex);

  useEffect(() => {
    if (actions.length > 0 && validCurrentPage !== currentPage) {
      setCurrentPage(validCurrentPage);
    }
  }, [actions.length, validCurrentPage, currentPage]);

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  };

  return (
    <div className="manual-actions-list">
      <div className="manual-actions-header">
        <strong>Ожидают: {actions.length}</strong>
      </div>
      {currentActions.map((action) => (
        <article key={action.id} className="manual-action-item">
          <div className="manual-action-leading"><span className="manual-type-mark"><ManualTypeIcon type={action.type} /></span>
            <div className="manual-action-copy">
              <div className="manual-action-reason">{REASON_LABELS[action.reasonCode] || action.type}</div>
              <div className="manual-action-title" title={action.title}>{action.title}</div>
              <small title={action.company}>{action.company}{action.vacancyId ? ` · #${action.vacancyId}` : ''}</small>
            </div>
          </div>
          <div className="manual-actions-buttons">
            <button type="button" className="btn btn-primary btn-sm"
              onClick={() => onOpen(action.url)}
              disabled={!action.url}
            >
              Открыть
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onDone(action.id)}>
              Готово
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => onDismiss(action.id)}>
              Скрыть
            </button>
          </div>
        </article>
      ))}
      {actions.length === 0 && <div className="empty-state-mini"><span className="empty-state-check">✓</span><span><strong>Всё спокойно</strong>Нет действий, требующих вашего внимания.</span></div>}
      {totalPages > 1 && (
        <div className="pagination-controls">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handlePrevPage}
            disabled={currentPage === 0}
          >
            Назад
          </button>
          <span className="pagination-info">
            Страница {currentPage + 1} из {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleNextPage}
            disabled={currentPage >= totalPages - 1}
          >
            Вперёд
          </button>
        </div>
      )}
    </div>
  );
};
