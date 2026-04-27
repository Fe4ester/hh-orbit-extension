import React from 'react';

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

export const ManualActionsPanel: React.FC<ManualActionsPanelProps> = ({
  actions,
  onOpen,
  onDone,
  onDismiss,
  onClearCompleted,
}) => {
  return (
    <div>
      <div className="manual-actions-header">
        <strong>Pending: {actions.length}</strong>
        <button className="btn btn-secondary btn-sm" onClick={onClearCompleted}>
          Clear completed
        </button>
      </div>
      {actions.map((action) => (
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
    </div>
  );
};
