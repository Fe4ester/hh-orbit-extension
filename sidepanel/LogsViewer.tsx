import React, { useEffect, useMemo, useState } from 'react';
import { FileLogger, LogEntry } from '../src/utils/fileLogger';

type LogsTab = 'overview' | 'errors' | 'vacancies' | 'raw';
type ErrorReason =
  | 'all'
  | 'cover_letter'
  | 'questionnaire'
  | 'test'
  | 'captcha'
  | 'login'
  | 'external_apply'
  | 'timeout'
  | 'manual_action'
  | 'error'
  | 'other';

const REASON_LABELS: Record<Exclude<ErrorReason, 'all'>, string> = {
  cover_letter: 'Нужно сопроводительное',
  questionnaire: 'Нужна анкета',
  test: 'Нужен тест',
  captcha: 'Капча / верификация',
  login: 'Нужна авторизация',
  external_apply: 'Внешний отклик',
  timeout: 'Таймаут / зависание',
  manual_action: 'Нужно ручное действие',
  error: 'Ошибка выполнения',
  other: 'Другое',
};

const detectVacancyStage = (log: LogEntry): string => {
  const haystack = `${log.message} ${JSON.stringify(log.context || {})}`.toLowerCase();

  if (haystack.includes('acquisition')) return 'Поиск';
  if (haystack.includes('preflight')) return 'Preflight';
  if (haystack.includes('validating vacancy') || haystack.includes('validate vacancy')) return 'Проверка';
  if (haystack.includes('click') || haystack.includes('respond button')) return 'Клик';
  if (haystack.includes('modal')) return 'Modal';
  if (haystack.includes('cover letter')) return 'Cover letter';
  if (haystack.includes('redirect')) return 'Redirect';
  if (haystack.includes('success')) return 'Успех';
  if (haystack.includes('manual action')) return 'Manual action';
  if (haystack.includes('skip') || haystack.includes('skipped')) return 'Скип';
  if (haystack.includes('fail') || haystack.includes('error')) return 'Ошибка';

  return 'Событие';
};

const detectVacancyStatus = (log: LogEntry): 'success' | 'warn' | 'error' | 'info' => {
  const haystack = `${log.message} ${JSON.stringify(log.context || {})}`.toLowerCase();

  if (log.level === 'error' || haystack.includes('failed') || haystack.includes('error')) return 'error';
  if (log.level === 'warn' || haystack.includes('manual action') || haystack.includes('test') || haystack.includes('questionnaire')) return 'warn';
  if (haystack.includes('success') || haystack.includes('processed: success') || haystack.includes('application sent')) return 'success';

  return 'info';
};

export const LogsViewer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<LogsTab>('overview');
  const [errorReasonFilter, setErrorReasonFilter] = useState<ErrorReason>('all');

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const allLogs = await FileLogger.readLogs();
      setLogs(allLogs);
    } catch (error) {
      console.error('Failed to load logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter((log) => {
    // Level filter
    if (levelFilter !== 'all' && log.level !== levelFilter) {
      return false;
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesMessage = log.message.toLowerCase().includes(query);
      const matchesSource = log.source.toLowerCase().includes(query);
      const matchesContext = log.context ? JSON.stringify(log.context).toLowerCase().includes(query) : false;
      return matchesMessage || matchesSource || matchesContext;
    }

    return true;
  });

  const errorKeywords = [
    'error',
    'failed',
    'timeout',
    'login',
    'captcha',
    'auth',
    'questionnaire',
    'test required',
    'test_required',
    'manual action',
    'cover letter',
    'external apply',
  ];

  const isErrorLike = (log: LogEntry): boolean => {
    if (log.level === 'error' || log.level === 'warn') {
      return true;
    }

    const haystack = `${log.message} ${JSON.stringify(log.context || {})}`.toLowerCase();
    return errorKeywords.some((keyword) => haystack.includes(keyword));
  };

  const detectReason = (log: LogEntry): Exclude<ErrorReason, 'all'> => {
    const haystack = `${log.message} ${JSON.stringify(log.context || {})}`.toLowerCase();

    if (haystack.includes('cover letter') || haystack.includes('сопровод')) return 'cover_letter';
    if (haystack.includes('questionnaire') || haystack.includes('анкет')) return 'questionnaire';
    if (haystack.includes('test required') || haystack.includes('test_required') || haystack.includes('тест')) return 'test';
    if (haystack.includes('captcha') || haystack.includes('капч')) return 'captcha';
    if (haystack.includes('login') || haystack.includes('auth') || haystack.includes('авториза')) return 'login';
    if (haystack.includes('external apply')) return 'external_apply';
    if (haystack.includes('timeout')) return 'timeout';
    if (haystack.includes('manual action')) return 'manual_action';

    return log.level === 'error' ? 'error' : 'other';
  };

  const errorLogs = useMemo(() => filteredLogs.filter(isErrorLike), [filteredLogs]);

  const errorReasonCounts = useMemo(() => {
    const counts = new Map<Exclude<ErrorReason, 'all'>, number>();
    errorLogs.forEach((log) => {
      const reason = detectReason(log);
      counts.set(reason, (counts.get(reason) || 0) + 1);
    });
    return counts;
  }, [errorLogs]);

  const filteredErrorLogs = useMemo(() => {
    if (errorReasonFilter === 'all') return errorLogs;
    return errorLogs.filter((log) => detectReason(log) === errorReasonFilter);
  }, [errorLogs, errorReasonFilter]);

  const vacancyLogs = useMemo(() => {
    const groups = new Map<string, LogEntry[]>();

    filteredLogs.forEach((log) => {
      const vacancyId = log.context?.vacancyId || log.context?.vacancy_id || log.context?.id;
      if (!vacancyId) return;

      const key = String(vacancyId);
      const current = groups.get(key) || [];
      current.push(log);
      groups.set(key, current);
    });

    return Array.from(groups.entries())
      .map(([vacancyId, entries]) => ({ vacancyId, entries }))
      .sort((a, b) => b.entries.length - a.entries.length);
  }, [filteredLogs]);

  const stats = useMemo(() => {
    const sourceSet = new Set(filteredLogs.map((log) => log.source));
    const reasonCounts = new Map<Exclude<ErrorReason, 'all'>, number>();

    errorLogs.forEach((log) => {
      const reason = detectReason(log);
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    });

    const topReasons = Array.from(reasonCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    return {
      total: filteredLogs.length,
      errors: errorLogs.length,
      uniqueSources: sourceSet.size,
      vacancies: vacancyLogs.length,
      topReasons,
      recent: [...filteredLogs].slice(-8).reverse(),
    };
  }, [errorLogs, filteredLogs, vacancyLogs]);

  const tabs: Array<{ id: LogsTab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'errors', label: 'Errors', count: errorLogs.length },
    { id: 'vacancies', label: 'Vacancies', count: vacancyLogs.length },
    { id: 'raw', label: 'Raw', count: filteredLogs.length },
  ];

  const renderOverview = () => (
    <div className="logs-tab-panel">
      <div className="logs-summary-grid">
        <div className="logs-summary-card">
          <div className="logs-summary-label">Всего событий</div>
          <div className="logs-summary-value">{stats.total}</div>
        </div>
        <div className="logs-summary-card logs-summary-card-danger">
          <div className="logs-summary-label">Проблемные</div>
          <div className="logs-summary-value">{stats.errors}</div>
        </div>
        <div className="logs-summary-card">
          <div className="logs-summary-label">Вакансий в логах</div>
          <div className="logs-summary-value">{stats.vacancies}</div>
        </div>
        <div className="logs-summary-card">
          <div className="logs-summary-label">Источники</div>
          <div className="logs-summary-value">{stats.uniqueSources}</div>
        </div>
      </div>

      <div className="logs-info-grid">
        <div className="logs-info-card">
          <h3>Топ причин</h3>
          {stats.topReasons.length === 0 ? (
            <div className="logs-empty-inline">Пока нет проблемных событий</div>
          ) : (
            <div className="logs-reason-list">
              {stats.topReasons.map(([reason, count]) => (
                <div key={reason} className="logs-reason-item">
                  <span className="logs-reason-badge">{REASON_LABELS[reason]}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="logs-info-card">
          <h3>Последние события</h3>
          {stats.recent.length === 0 ? (
            <div className="logs-empty-inline">Логи пустые</div>
          ) : (
            <div className="logs-event-list">
              {stats.recent.map((log, index) => (
                <div key={`${log.timestamp}-${index}`} className="logs-event-item">
                  <div className="logs-event-topline">
                    <span className={`logs-level-badge logs-level-${log.level}`}>{log.level}</span>
                    <span className="logs-event-source">{log.source}</span>
                    <span className="logs-event-time">{new Date(log.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="logs-event-message">{log.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderErrors = () => (
    <div className="logs-tab-panel">
      <div className="logs-errors-toolbar">
        <div className="logs-errors-summary">
          <div className="logs-errors-title">Проблемы откликов и остановок</div>
          <div className="logs-errors-subtitle">
            Показывает, почему отклик не дошёл до успеха или потребовал ручного разбора.
          </div>
        </div>
        <div className="logs-reason-filters">
          <button
            className={`logs-filter-chip ${errorReasonFilter === 'all' ? 'logs-filter-chip-active' : ''}`}
            onClick={() => setErrorReasonFilter('all')}
          >
            Все
            <span className="logs-filter-chip-count">{errorLogs.length}</span>
          </button>
          {Array.from(errorReasonCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => (
              <button
                key={reason}
                className={`logs-filter-chip ${errorReasonFilter === reason ? 'logs-filter-chip-active' : ''}`}
                onClick={() => setErrorReasonFilter(reason)}
              >
                {REASON_LABELS[reason]}
                <span className="logs-filter-chip-count">{count}</span>
              </button>
            ))}
        </div>
      </div>
      {filteredErrorLogs.length === 0 ? (
        <div className="logs-empty">Проблемные события не найдены</div>
      ) : (
        <div className="logs-event-list">
          {filteredErrorLogs.slice().reverse().map((log, index) => {
            const reason = detectReason(log);
            const reasonLabel = REASON_LABELS[reason];
            const vacancyId = log.context?.vacancyId;
            const profileId = log.context?.profileId;
            const reasonCode = log.context?.reasonCode;

            return (
              <div key={`${log.timestamp}-${index}`} className="logs-event-item logs-event-item-danger">
                <div className="logs-error-priority-line">
                  <span className="logs-error-priority">Разобрать</span>
                  <span className="logs-error-hint">{reasonLabel}</span>
                </div>
                <div className="logs-event-topline">
                  <span className={`logs-level-badge logs-level-${log.level}`}>{log.level}</span>
                  <span className="logs-reason-badge">{reasonLabel}</span>
                  <span className="logs-event-source">{log.source}</span>
                  <span className="logs-event-time">{new Date(log.timestamp).toLocaleString()}</span>
                </div>
                <div className="logs-event-message">{log.message}</div>
                <div className="logs-error-explanation">
                  {reason === 'cover_letter' && 'Вакансия просит сопроводительное письмо или логика упёрлась в cover letter flow.'}
                  {reason === 'questionnaire' && 'Отклик остановился на анкете работодателя. Нужен ручной проход.'}
                  {reason === 'test' && 'Отклик требует тест. Автоматически не закрывается.'}
                  {reason === 'captcha' && 'Появилась капча или проверка безопасности. Нужен ручной разбор.'}
                  {reason === 'login' && 'Сессия протухла или произошёл редирект на авторизацию.'}
                  {reason === 'external_apply' && 'Отклик ведёт на внешнюю форму, не на стандартный HH flow.'}
                  {reason === 'timeout' && 'Ожидание ответа/страницы превысило лимит. Проверить сеть, HH или селекторы.'}
                  {reason === 'manual_action' && 'Сценарий передан пользователю как manual action.'}
                  {reason === 'error' && 'Техническая ошибка в шаге отклика. Нужен разбор контекста ниже.'}
                  {reason === 'other' && 'Нестандартный проблемный кейс. Смотри сообщение и raw logs.'}
                </div>
                {log.context && (
                  <div className="logs-event-meta">
                    {vacancyId && <span>vacancy: {String(vacancyId)}</span>}
                    {profileId && <span>profile: {String(profileId)}</span>}
                    {reasonCode && <span>reasonCode: {String(reasonCode)}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderVacancies = () => (
    <div className="logs-tab-panel">
      {vacancyLogs.length === 0 ? (
        <div className="logs-empty">Нет событий, привязанных к vacancyId</div>
      ) : (
        <div className="logs-vacancy-list">
          {vacancyLogs.slice(0, 30).map(({ vacancyId, entries }) => {
            const sortedEntries = [...entries].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            const latestEntry = sortedEntries[sortedEntries.length - 1];
            const latestStatus = detectVacancyStatus(latestEntry);
            const latestStage = detectVacancyStage(latestEntry);
            const latestProfileId = latestEntry.context?.profileId;

            return (
              <div key={vacancyId} className="logs-vacancy-card">
                <div className="logs-vacancy-header">
                  <div className="logs-vacancy-title-block">
                    <strong>Vacancy {vacancyId}</strong>
                    <span>{entries.length} events</span>
                    {latestProfileId && <span>profile: {String(latestProfileId)}</span>}
                  </div>
                  <div className="logs-vacancy-status-block">
                    <span className={`logs-vacancy-status logs-vacancy-status-${latestStatus}`}>{latestStage}</span>
                    <span className="logs-vacancy-last-time">
                      {new Date(latestEntry.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="logs-vacancy-summary">
                  <div className="logs-vacancy-summary-title">Последний итог</div>
                  <div className="logs-vacancy-summary-message">{latestEntry.message}</div>
                </div>

                <div className="logs-vacancy-timeline">
                  {sortedEntries.slice(-6).map((log, index) => {
                    const stage = detectVacancyStage(log);
                    const status = detectVacancyStatus(log);

                    return (
                      <div key={`${log.timestamp}-${index}`} className="logs-vacancy-timeline-item">
                        <div className={`logs-vacancy-timeline-dot logs-vacancy-timeline-dot-${status}`} />
                        <div className="logs-vacancy-timeline-content">
                          <div className="logs-vacancy-timeline-top">
                            <span className={`logs-vacancy-status logs-vacancy-status-${status}`}>{stage}</span>
                            <span className="logs-vacancy-last-time">{new Date(log.timestamp).toLocaleString()}</span>
                          </div>
                          <div className="logs-vacancy-message">{log.message}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderRaw = () => (
    <div className="logs-tab-panel">
      {filteredLogs.length === 0 ? (
        <div className="logs-empty">No logs found</div>
      ) : (
        <pre className="logs-stream">{formatLogsAsText()}</pre>
      )}
    </div>
  );

  const formatLogsAsText = (): string => {
    return filteredLogs.map((log) => {
      const timestamp = new Date(log.timestamp).toLocaleString();
      const level = log.level.toUpperCase().padEnd(5);
      const source = log.source.padEnd(16);
      let line = `[${timestamp}] [${level}] [${source}] ${log.message}`;

      if (log.context) {
        line += '\n' + JSON.stringify(log.context, null, 2);
      }

      return line;
    }).join('\n\n');
  };

  const handleCopyAll = async () => {
    const text = formatLogsAsText();
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  return (
    <div className="logs-viewer-overlay">
      <div className="logs-viewer-container">
        <div className="logs-viewer-header">
          <h2>System Logs</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>

        <div className="logs-viewer-controls">
          <input
            type="text"
            className="logs-search-input"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <select
            className="logs-level-filter"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
          >
            <option value="all">All Levels</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={loadLogs}>Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={handleCopyAll} disabled={filteredLogs.length === 0}>
            Copy all
          </button>
          <div className="logs-count">{filteredLogs.length} / {logs.length} entries</div>
        </div>

        <div className="logs-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`logs-tab ${activeTab === tab.id ? 'logs-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && <span className="logs-tab-count">{tab.count}</span>}
            </button>
          ))}
        </div>

        <div className="logs-viewer-content">
          {loading ? (
            <div className="logs-loading">Loading logs...</div>
          ) : (
            <>
              {activeTab === 'overview' && renderOverview()}
              {activeTab === 'errors' && renderErrors()}
              {activeTab === 'vacancies' && renderVacancies()}
              {activeTab === 'raw' && renderRaw()}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
