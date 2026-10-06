import { t } from '../i18n';
import React from 'react';
import type { Notification } from '../state/types';

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
    return <div className="empty-state">{t("Нет уведомлений")}</div>;
  }

  return (
    <div className="notification-container">
      {sticky.length > 0 && (
        <div className="notification-section">
          <h4 className="notification-section-title">{t("Важные уведомления")}</h4>
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
          <h4 className="notification-section-title">{t("Недавние")}</h4>
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
        aria-label={t("Закрыть")}
      >
        ×
      </button>
    </div>
  );
};

function getKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    runtime_started: t("Запуск"),
    runtime_stopped: t("Остановка"),
    profile_changed: t("Профиль"),
    resume_not_selected: t("Резюме"),
    manual_action_required: t("Требуется действие"),
    no_more_vacancies: t("Вакансии"),
    session_warning: t("Предупреждение"),
    backend_helper_unavailable: t("Бэкенд"),
  };
  return labels[kind] || '';
}
