import React from 'react';
import { Notification } from '../state/types';

interface NotificationListProps {
  notifications: Notification[];
}

export const NotificationList: React.FC<NotificationListProps> = ({ notifications }) => {
  const handleDismiss = (id: string) => {
    chrome.runtime.sendMessage({ type: 'DISMISS_NOTIFICATION', id });
  };

  const sticky = notifications.filter((n) => n.sticky);
  const toasts = notifications.filter((n) => !n.sticky);

  if (notifications.length === 0) {
    return <div className="empty-state">Нет уведомлений</div>;
  }

  return (
    <div className="notification-container">
      {sticky.length > 0 && (
        <div className="notification-section">
          <h4 className="notification-section-title">Важные уведомления</h4>
          <div className="notification-list">
            {sticky.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="notification-section">
          <h4 className="notification-section-title">Недавние</h4>
          <div className="notification-list">
            {toasts.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const NotificationItem: React.FC<{
  notification: Notification;
  onDismiss: (id: string) => void;
}> = ({ notification, onDismiss }) => {
  return (
    <div className={`notification notification-${notification.level}`}>
      <div className="notification-content">
        {notification.kind && (
          <div className="notification-kind">{getKindLabel(notification.kind)}</div>
        )}
        <div className="notification-message">{notification.message}</div>
      </div>
      <button
        className="notification-close"
        onClick={() => onDismiss(notification.id)}
        aria-label="Закрыть"
      >
        ×
      </button>
    </div>
  );
};

function getKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    runtime_started: 'Запуск',
    runtime_stopped: 'Остановка',
    profile_changed: 'Профиль',
    resume_not_selected: 'Резюме',
    manual_action_required: 'Требуется действие',
    no_more_vacancies: 'Вакансии',
    session_warning: 'Предупреждение',
    backend_helper_unavailable: 'Бэкенд',
  };
  return labels[kind] || '';
}
