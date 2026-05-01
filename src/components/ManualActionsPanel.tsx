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
  onClearCompleted: () => void;
}

const ITEMS_PER_PAGE = 10;

export const ManualActionsPanel: React.FC<ManualActionsPanelProps> = ({
  actions,
  onOpen,
  onDone,
  onDismiss,
  onClearCompleted,
}) => {
  const [currentPage, setCurrentPage] = useState(0);

  const totalPages = Math.ceil(actions.length / ITEMS_PER_PAGE);
  const startIndex = currentPage * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentActions = actions.slice(startIndex, endIndex);

  // Reset to valid page if current page becomes invalid
  useEffect(() => {
    if (actions.length > 0 && currentPage >= totalPages) {
      setCurrentPage(Math.max(0, totalPages - 1));
    }
  }, [actions.length, currentPage, totalPages]);

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  };

  return (
    <div>
      <div className="manual-actions-header">
        <strong>Pending: {actions.length}</strong>
        <button className="btn btn-secondary btn-sm" onClick={onClearCompleted}>
          Clear completed
        </button>
      </div>
      {currentActions.map((action) => (
        <div key={action.id} className="manual-action-item">
          <div>
            <div>{action.title}</div>
            <small>{action.company} · {action.type}</small>
          </div>
          <div className="manual-actions-buttons">
            <button className="btn btn-secondary btn-sm" onClick={() => onOpen(action.url)} disabled={!action.url}>Open</button>
            <button className="btn btn-primary btn-sm" onClick={() => onDone(action.id)}>Done</button>
            <button className="btn btn-danger btn-sm" onClick={() => onDismiss(action.id)}>Dismiss</button>
          </div>
        </div>
      ))}
      {actions.length === 0 && <div className="empty-state-mini">Нет ручных действий</div>}
      {totalPages > 1 && (
        <div className="pagination-controls">
          <button
            className="btn btn-secondary btn-sm"
            onClick={handlePrevPage}
            disabled={currentPage === 0}
          >
            Prev
          </button>
          <span className="pagination-info">
            Page {currentPage + 1} of {totalPages}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleNextPage}
            disabled={currentPage >= totalPages - 1}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};
