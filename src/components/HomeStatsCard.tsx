import React from 'react';
import { AnalyticsStats } from '../state/selectors';

interface HomeStatsCardProps {
  currentRun: AnalyticsStats;
  allTime: AnalyticsStats;
  isRunActive: boolean;
}

export const HomeStatsCard: React.FC<HomeStatsCardProps> = ({
  currentRun,
  allTime,
  isRunActive,
}) => {
  return (
    <div className="home-stats-card">
      <div className="stats-section">
        <h3>Текущий запуск</h3>
        {isRunActive ? (
          <div className="stats-compact">
            <div className="stat-row">
              <span>Попыток:</span>
              <strong>{currentRun.attemptsTotal}</strong>
            </div>
            <div className="stat-row">
              <span>Успешно:</span>
              <strong className="text-success">{currentRun.succeeded}</strong>
            </div>
            <div className="stat-row">
              <span>Успешность:</span>
              <strong>{currentRun.successRate}%</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state-mini">Не запущено</div>
        )}
      </div>

      <div className="stats-section">
        <h3>За всё время</h3>
        {allTime.attemptsTotal > 0 ? (
          <div className="stats-compact">
            <div className="stat-row">
              <span>Попыток:</span>
              <strong>{allTime.attemptsTotal}</strong>
            </div>
            <div className="stat-row">
              <span>Успешно:</span>
              <strong className="text-success">{allTime.succeeded}</strong>
            </div>
            <div className="stat-row">
              <span>Успешность:</span>
              <strong>{allTime.successRate}%</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state-mini">Нет данных</div>
        )}
      </div>
    </div>
  );
};
