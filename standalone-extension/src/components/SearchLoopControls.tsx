import React from 'react';
import { LiveModeState, VacancyScanState } from '../state/types';

interface SearchLoopControlsProps {
  liveMode: LiveModeState;
  vacancyScan: VacancyScanState;
  onScanCurrentPage: () => void;
  onNextPage: () => void;
  onRunSearchLoop: () => void;
}

export const SearchLoopControls: React.FC<SearchLoopControlsProps> = ({
  liveMode,
  vacancyScan,
  onScanCurrentPage,
  onNextPage,
  onRunSearchLoop,
}) => {
  const isSearchPage = liveMode.pageType === 'search';
  const isExhausted = vacancyScan.exhausted;
  const isLoopActive = liveMode.searchLoopActive;

  const hasNextPage =
    liveMode.totalPagesDetected !== null &&
    liveMode.currentSearchPage !== null &&
    liveMode.currentSearchPage < liveMode.totalPagesDetected;

  return (
    <div className="search-loop-controls">
      <div className="search-loop-header">
        <h3>Search Loop</h3>
        {isLoopActive && <span className="status-badge status-active">Активен</span>}
      </div>

      <div className="search-loop-actions">
        <button
          className="btn btn-secondary"
          onClick={onScanCurrentPage}
          disabled={!isSearchPage || isLoopActive}
        >
          Сканировать текущую страницу
        </button>
        <button
          className="btn btn-secondary"
          onClick={onNextPage}
          disabled={!isSearchPage || isLoopActive || !hasNextPage}
        >
          Следующая страница
        </button>
        <button
          className="btn btn-primary"
          onClick={onRunSearchLoop}
          disabled={!isSearchPage || isExhausted || isLoopActive}
        >
          Запустить 1 цикл поиска
        </button>
      </div>

      {isSearchPage && (
        <div className="search-loop-info">
          <div className="info-row">
            <span className="info-label">Текущая страница:</span>
            <span className="info-value">
              {liveMode.currentSearchPage !== null ? liveMode.currentSearchPage : 'N/A'}
            </span>
          </div>

          <div className="info-row">
            <span className="info-label">Всего страниц:</span>
            <span className="info-value">
              {liveMode.totalPagesDetected !== null ? liveMode.totalPagesDetected : 'N/A'}
            </span>
          </div>

          <div className="info-row">
            <span className="info-label">Найдено на странице:</span>
            <span className="info-value">{liveMode.lastScanVacancyCount}</span>
          </div>

          <div className="info-row">
            <span className="info-label">Итераций цикла:</span>
            <span className="info-value">{liveMode.searchLoopIterations}</span>
          </div>

          <div className="info-row">
            <span className="info-label">Есть следующая страница:</span>
            <span className="info-value">{hasNextPage ? 'Да' : 'Нет'}</span>
          </div>
        </div>
      )}
    </div>
  );
};
