import React from 'react';
import { AnalyticsSummary, AnalyticsStats } from '../state/selectors';
import { AttemptRecord } from '../state/types';

interface AnalyticsViewProps {
  summary: AnalyticsSummary;
  recentAttempts: AttemptRecord[];
  onSeedDemo: () => void;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  summary,
  recentAttempts,
  onSeedDemo,
}) => {
  return (
    <div className="analytics-view">
      <div className="analytics-header">
        <h2>Аналитика</h2>
        <button onClick={onSeedDemo} className="btn-secondary">
          Добавить демо-данные
        </button>
      </div>

      <section className="analytics-section">
        <h3>Текущий запуск</h3>
        {summary.isRunActive ? (
          <StatsCard stats={summary.currentRun} />
        ) : (
          <div className="empty-state">Запуск не активен</div>
        )}
      </section>

      <section className="analytics-section">
        <h3>Сегодня</h3>
        <StatsCard stats={summary.today} />
      </section>

      <section className="analytics-section">
        <h3>За всё время</h3>
        <StatsCard stats={summary.allTime} />
      </section>

      <section className="analytics-section">
        <h3>Последние попытки</h3>
        <AttemptsList attempts={recentAttempts} />
      </section>
    </div>
  );
};

const StatsCard: React.FC<{ stats: AnalyticsStats }> = ({ stats }) => {
  if (stats.attemptsTotal === 0) {
    return <div className="empty-state">Нет данных</div>;
  }

  return (
    <div className="stats-card">
      <div className="stats-grid">
        <StatItem label="Всего попыток" value={stats.attemptsTotal} />
        <StatItem label="Успешно" value={stats.succeeded} variant="success" />
        <StatItem label="Эскалировано" value={stats.escalated} variant="info" />
        <StatItem label="Повторяемые ошибки" value={stats.failedRetryable} variant="warn" />
        <StatItem label="Финальные ошибки" value={stats.failedFinal} variant="error" />
        <StatItem label="Требуется действие" value={stats.manualActionRequired} variant="warn" />
        <StatItem label="Пропущено (дубли)" value={stats.skippedDuplicate} variant="neutral" />
        <StatItem label="Успешность" value={`${stats.successRate}%`} variant="success" />
      </div>
    </div>
  );
};

const StatItem: React.FC<{
  label: string;
  value: string | number;
  variant?: 'success' | 'info' | 'warn' | 'error' | 'neutral';
}> = ({ label, value, variant = 'neutral' }) => {
  return (
    <div className={`stat-item stat-${variant}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
};

const AttemptsList: React.FC<{ attempts: AttemptRecord[] }> = ({ attempts }) => {
  if (attempts.length === 0) {
    return <div className="empty-state">Нет попыток</div>;
  }

  return (
    <div className="attempts-list">
      {attempts.map((attempt) => (
        <div key={attempt.id} className="attempt-item">
          <div className="attempt-outcome" data-outcome={attempt.outcome}>
            {getOutcomeLabel(attempt.outcome)}
          </div>
          <div className="attempt-meta">
            {attempt.vacancyId && <span className="attempt-vacancy">{attempt.vacancyId}</span>}
            <span className="attempt-time">{formatTime(attempt.finishedAt || attempt.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

function getOutcomeLabel(outcome: string): string {
  const labels: Record<string, string> = {
    SUCCEEDED: 'Успешно',
    ESCALATED: 'Эскалировано',
    FAILED_RETRYABLE: 'Ошибка (повтор)',
    FAILED_FINAL: 'Ошибка (финал)',
    SKIPPED_DUPLICATE: 'Пропущено (дубль)',
    MANUAL_ACTION_REQUIRED: 'Требуется действие',
  };
  return labels[outcome] || outcome;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) {
    return 'только что';
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)} мин назад`;
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)} ч назад`;
  }

  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
