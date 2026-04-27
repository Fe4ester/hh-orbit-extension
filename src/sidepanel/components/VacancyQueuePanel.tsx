import { AppState } from '../../state/types';

interface VacancyQueuePanelProps {
  state: AppState;
  onParseSearchResults: () => void;
  onClearQueue: () => void;
}

export function VacancyQueuePanel({
  state,
  onParseSearchResults,
  onClearQueue,
}: VacancyQueuePanelProps) {
  const { vacancyQueue, liveMode } = state;

  const isSearchPage = liveMode.pageType === 'search';
  const hasControlledTab = liveMode.controlledTabId !== null;

  // Show last 10 vacancies
  const recentVacancies = vacancyQueue.slice(-10).reverse();

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'discovered':
        return 'Найдена';
      case 'queued':
        return 'В очереди';
      case 'processed':
        return 'Обработана';
      case 'skipped':
        return 'Пропущена';
      default:
        return status;
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'discovered':
        return 'vacancy-queue-item-status-discovered';
      case 'queued':
        return 'vacancy-queue-item-status-queued';
      case 'processed':
        return 'vacancy-queue-item-status-processed';
      case 'skipped':
        return 'vacancy-queue-item-status-skipped';
      default:
        return '';
    }
  };

  return (
    <div className="vacancy-queue-panel">
      <div className="vacancy-queue-header">
        <h3>Очередь вакансий</h3>
        <span className="vacancy-queue-count">Всего: {vacancyQueue.length}</span>
      </div>

      {!hasControlledTab && (
        <div className="warning-box">
          Нет контролируемой вкладки. Запустите Live mode.
        </div>
      )}

      {hasControlledTab && !isSearchPage && (
        <div className="warning-box">
          Контролируемая вкладка не является страницей поиска.
        </div>
      )}

      <div className="vacancy-queue-actions">
        <button
          onClick={onParseSearchResults}
          disabled={!hasControlledTab || !isSearchPage}
          className="btn btn-primary"
        >
          Считать вакансии из вкладки
        </button>
        <button
          onClick={onClearQueue}
          disabled={vacancyQueue.length === 0}
          className="btn btn-secondary"
        >
          Очистить очередь
        </button>
      </div>

      {recentVacancies.length > 0 && (
        <div className="vacancy-queue-list">
          <h4>Последние вакансии:</h4>
          {recentVacancies.map((item) => (
            <div key={item.url} className="vacancy-queue-item">
              <div className="vacancy-queue-item-header">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="vacancy-queue-item-title"
                >
                  {item.title}
                </a>
                <span className={`vacancy-queue-item-status ${getStatusClass(item.status)}`}>
                  {getStatusLabel(item.status)}
                </span>
              </div>
              {item.company && (
                <div className="vacancy-queue-item-company">{item.company}</div>
              )}
              <div className="vacancy-queue-item-meta">
                ID: {item.vacancyId || 'N/A'}
              </div>
            </div>
          ))}
        </div>
      )}

      {vacancyQueue.length === 0 && (
        <div className="vacancy-queue-empty">
          Очередь пуста. Нажмите "Считать вакансии из вкладки" для сканирования.
        </div>
      )}
    </div>
  );
}
