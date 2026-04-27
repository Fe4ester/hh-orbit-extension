import React from 'react';
import { LiveModeState } from '../state/types';

export interface LiveModeControlsProps {
  liveMode: LiveModeState;
  pageTypeLabel: string;
  searchSyncStatusLabel: string;
  activeProfileName: string | null;
  onStart: () => void;
  onStop: () => void;
  onFocusTab: () => void;
  onBindCurrentTab: () => void;
  onApplyProfileSearch: () => void;
  syncDiff?: {
    synced: boolean;
    mismatches: { field: string; expected: any; actual: any }[];
  } | null;
}

export const LiveModeControls: React.FC<LiveModeControlsProps> = ({
  liveMode,
  pageTypeLabel,
  searchSyncStatusLabel,
  activeProfileName,
  onStart,
  onStop,
  onFocusTab,
  onBindCurrentTab,
  onApplyProfileSearch,
  syncDiff,
}) => {
  return (
    <div className="live-mode-controls">
      <div className="live-mode-header">
        <h3>Live Mode</h3>
        <div className={`live-mode-status ${liveMode.active ? 'active' : 'inactive'}`}>
          {liveMode.active ? 'Активен' : 'Неактивен'}
        </div>
      </div>

      <div className="live-mode-actions">
        {!liveMode.active ? (
          <button className="btn btn-primary" onClick={onStart}>
            Запустить Live Mode
          </button>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={onStop}>
              Остановить
            </button>
            <button className="btn btn-secondary" onClick={onBindCurrentTab}>
              Привязать текущую HH вкладку
            </button>
            {liveMode.controlledTabId && (
              <button className="btn btn-secondary" onClick={onFocusTab}>
                Открыть вкладку
              </button>
            )}
            {activeProfileName && liveMode.controlledTabPurpose !== 'search' && (
              <button className="btn btn-primary" onClick={onApplyProfileSearch}>
                Применить профиль к поиску
              </button>
            )}
          </>
        )}
      </div>

      {liveMode.active && (
        <div className="live-mode-info">
          {!liveMode.controlledTabId && (
            <div className="info-row warning">
              <span className="info-label">⚠️ Внимание:</span>
              <span className="info-value">HH вкладка не привязана. Откройте HH страницу.</span>
            </div>
          )}

          {liveMode.controlledTabPurpose && (
            <div className="info-row">
              <span className="info-label">Назначение:</span>
              <span className="info-value">{getPurposeLabel(liveMode.controlledTabPurpose)}</span>
            </div>
          )}

          {activeProfileName && (
            <div className="info-row">
              <span className="info-label">Активный профиль:</span>
              <span className="info-value">{activeProfileName}</span>
            </div>
          )}

          <div className="info-row">
            <span className="info-label">Статус синхронизации:</span>
            <span className={`info-value sync-status-${liveMode.searchSyncStatus}`}>
              {searchSyncStatusLabel}
            </span>
          </div>

          {syncDiff && !syncDiff.synced && syncDiff.mismatches.length > 0 && (
            <div className="info-row sync-mismatches">
              <span className="info-label">Несоответствия:</span>
              <ul className="mismatch-list">
                {syncDiff.mismatches.map((m, i) => (
                  <li key={i} className="mismatch-item">
                    <strong>{m.field}</strong>: ожидается {JSON.stringify(m.expected)}, применено {JSON.stringify(m.actual)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="info-row">
            <span className="info-label">Вкладка:</span>
            <span className="info-value">
              {liveMode.controlledTabId ? `#${liveMode.controlledTabId}` : 'Не привязана'}
            </span>
          </div>

          <div className="info-row">
            <span className="info-label">Страница:</span>
            <span className="info-value">{pageTypeLabel}</span>
          </div>

          {liveMode.currentUrl && (
            <div className="info-row">
              <span className="info-label">URL:</span>
              <span className="info-value info-url">{truncateUrl(liveMode.currentUrl)}</span>
            </div>
          )}

          {liveMode.targetSearchUrl && (
            <div className="info-row">
              <span className="info-label">Целевой поиск:</span>
              <span className="info-value info-url">
                {truncateUrl(liveMode.targetSearchUrl)}
              </span>
            </div>
          )}

          {liveMode.detectedVacancyId && (
            <div className="info-row">
              <span className="info-label">Вакансия:</span>
              <span className="info-value">#{liveMode.detectedVacancyId}</span>
            </div>
          )}

          {liveMode.detectedResumeHash && (
            <div className="info-row">
              <span className="info-label">Резюме:</span>
              <span className="info-value">{liveMode.detectedResumeHash}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function truncateUrl(url: string, maxLength: number = 50): string {
  if (url.length <= maxLength) {
    return url;
  }
  return url.substring(0, maxLength) + '...';
}

function getPurposeLabel(purpose: string): string {
  const labels: Record<string, string> = {
    resume_detection: 'Обнаружение резюме',
    search: 'Поиск вакансий',
    vacancy: 'Просмотр вакансии',
    generic_hh: 'Общая HH страница',
  };
  return labels[purpose] || purpose;
}
