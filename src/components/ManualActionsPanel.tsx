import React, { useState, useEffect } from 'react';

interface ManualActionItem {
  id: string;
  type: string;
  title: string;
  company: string;
  url: string;
}

interface ManualActionsPanelProps {
  actions: ManualActionItem[];
  onOpen: (url: string) => void;
  onDone: (id: string) => void;
  onDismiss: (id: string) => void;
}

const ITEMS_PER_PAGE = 10;

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
    <div>
      <div className="manual-actions-header">
        <strong>Ожидают: {actions.length}</strong>
      </div>
      {currentActions.map((action) => (
        <div key={action.id} className="manual-action-item">
          <div>
            <div>{action.title}</div>
            <small>{action.company} · {action.type}</small>
          </div>
          <div className="manual-actions-buttons">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onOpen(action.url)}
              disabled={!action.url}
            >
              Открыть
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onDone(action.id)}
            >
              Готово
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => onDismiss(action.id)}
            >
              Скрыть
            </button>
          </div>
        </div>
      ))}
      {actions.length === 0 && <div className="empty-state-mini">Нет ручных действий</div>}
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
