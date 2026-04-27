import React from 'react';

export type SessionStatus = 'unknown' | 'ok' | 'login_required' | 'captcha_required' | 'degraded';
export type RuntimeBlocker = 'login_required' | 'captcha_required' | 'controlled_tab_lost' | 'session_unknown' | null;

interface RuntimeBlockerBannerProps {
  blocker: RuntimeBlocker;
  reason?: string | null;
  onRetryCheck: () => void;
  onClearBlocker: () => void;
}

export const RuntimeBlockerBanner: React.FC<RuntimeBlockerBannerProps> = ({
  blocker,
  reason,
  onRetryCheck,
  onClearBlocker,
}) => {
  if (!blocker) return null;

  const messages: Record<string, string> = {
    login_required: 'Требуется вход в систему',
    captcha_required: 'Требуется прохождение капчи',
    controlled_tab_lost: 'Контролируемая вкладка была закрыта',
    session_unknown: 'Статус сессии неизвестен',
  };

  const message = messages[blocker] || 'Обнаружена блокировка';

  return (
    <div className="runtime-blocker-banner">
      <div className="blocker-icon">⚠️</div>
      <div className="blocker-content">
        <div className="blocker-title">{message}</div>
        {reason && <div className="blocker-reason">{reason}</div>}
      </div>
      <div className="blocker-actions">
        <button className="btn btn-secondary btn-sm" onClick={onRetryCheck}>
          Повторить проверку
        </button>
        <button className="btn btn-primary btn-sm" onClick={onClearBlocker}>
          Снять блокировку
        </button>
      </div>
    </div>
  );
};

interface SessionStatusBadgeProps {
  status: SessionStatus;
}

export const SessionStatusBadge: React.FC<SessionStatusBadgeProps> = ({ status }) => {
  const labels: Record<SessionStatus, string> = {
    unknown: 'Неизвестно',
    ok: 'OK',
    login_required: 'Требуется вход',
    captcha_required: 'Требуется капча',
    degraded: 'Деградирована',
  };

  const className = `session-status-badge session-status-${status}`;

  return <span className={className}>{labels[status]}</span>;
};
