import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileLogger } from '../src/utils/fileLogger';
import type { LogEntry } from '../src/utils/fileLogger';
import {
  classifyLogProblem,
  detectReason,
  detectVacancyStatus,
  getProblemBadgeLevel,
  type ErrorReason,
} from './logClassification';

type LogsTab = 'overview' | 'errors' | 'vacancies' | 'raw';

const REASON_LABELS: Record<Exclude<ErrorReason, 'all'>, string> = {
  cover_letter: 'Сопроводительное письмо',
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
  const outcome = typeof log.context?.outcome === 'string' ? log.context.outcome.toLowerCase() : null;
  const coverLetterFlow = log.context?.coverLetterFlow === true;

  if (haystack.includes('acquisition')) return 'Поиск';
  if (haystack.includes('preflight')) return 'Предпроверка';
  if (haystack.includes('validating vacancy') || haystack.includes('validate vacancy')) return 'Проверка';
  if (haystack.includes('click') || haystack.includes('respond button')) return 'Клик';
  if (haystack.includes('modal')) return 'Модальное окно';
  if (coverLetterFlow && outcome === 'success') return 'Письмо отправлено';
  if (coverLetterFlow) return 'Сопроводительное письмо';
  if (haystack.includes('cover letter')) return 'Сопроводительное письмо';
  if (haystack.includes('redirect')) return 'Редирект';
  if (haystack.includes('success')) return 'Успех';
  if (haystack.includes('manual action')) return 'Ручное действие';
  if (haystack.includes('skip') || haystack.includes('skipped')) return 'Скип';
  if (haystack.includes('fail') || haystack.includes('error')) return 'Ошибка';

  return 'Событие';
};

export const LogsViewer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<LogsTab>('overview');
  const [errorReasonFilter, setErrorReasonFilter] = useState<ErrorReason>('all');
  const [rawViewMode, setRawViewMode] = useState<'parsed' | 'stream'>('parsed');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const allLogs = await FileLogger.readLogs();
      setLogs(allLogs);
    } catch {
      setLoadError('Не удалось загрузить логи');
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

  const isErrorLike = useCallback((log: LogEntry): boolean => {
    return classifyLogProblem(log) !== 'none';
  }, []);

  const errorLogs = useMemo(() => filteredLogs.filter(isErrorLike), [filteredLogs, isErrorLike]);

  const errorReasonCounts = useMemo(() => {
    const counts = new Map<Exclude<ErrorReason, 'all'>, number>();
    errorLogs.forEach((log) => {
      const reason = detectReason(log);
      counts.set(reason, (counts.get(reason) || 0) + 1);
    });
    return counts;
  }, [detectReason, errorLogs]);

  const filteredErrorLogs = useMemo(() => {
    if (errorReasonFilter === 'all') return errorLogs;
    return errorLogs.filter((log) => detectReason(log) === errorReasonFilter);
  }, [detectReason, errorLogs, errorReasonFilter]);

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
  }, [detectReason, errorLogs, filteredLogs, vacancyLogs]);

  const tabs: Array<{ id: LogsTab; label: string; count?: number }> = [
    { id: 'overview', label: 'Сводка' },
    { id: 'errors', label: 'Ошибки', count: errorLogs.length },
    { id: 'vacancies', label: 'Вакансии', count: vacancyLogs.length },
    { id: 'raw', label: 'Сырой вид', count: filteredLogs.length },
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
            Технические ошибки, блокеры и ручные действия показаны раздельно, чтобы не путать сбой выполнения с управляемым сценарием.
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
            const problemKind = classifyLogProblem(log);
            const badgeLevel = getProblemBadgeLevel(log);
            const vacancyId = log.context?.vacancyId;
            const profileId = log.context?.profileId;
            const reasonCode = log.context?.reasonCode;

            const priorityLabel =
              problemKind === 'execution_error'
                ? 'Ошибка выполнения'
                : problemKind === 'warning'
                ? reason === 'cover_letter'
                  ? 'Блокер сопроводительного письма'
                  : 'Предупреждение / блокер'
                : 'Ручное действие';

            return (
              <div
                key={`${log.timestamp}-${index}`}
                className={`logs-event-item ${
                  problemKind === 'execution_error'
                    ? 'logs-event-item-danger'
                    : problemKind === 'manual_case'
                    ? 'logs-event-item-manual'
                    : 'logs-event-item-warning'
                }`}
              >
                <div className="logs-error-priority-line">
                  <span
                    className={`logs-error-priority ${
                      problemKind === 'execution_error'
                        ? 'logs-error-priority-danger'
                        : problemKind === 'manual_case'
                        ? 'logs-error-priority-manual'
                        : 'logs-error-priority-warning'
                    }`}
                  >
                    {priorityLabel}
                  </span>
                  <span className="logs-error-hint">{reasonLabel}</span>
                </div>
                <div className="logs-event-topline">
                  <span className={`logs-level-badge logs-level-${badgeLevel}`}>{badgeLevel}</span>
                  <span className="logs-reason-badge">{reasonLabel}</span>
                  <span className="logs-event-source">{log.source}</span>
                  <span className="logs-event-time">{new Date(log.timestamp).toLocaleString()}</span>
                </div>
                <div className="logs-event-message">{log.message}</div>
                <div
                  className={`logs-error-explanation ${
                    problemKind === 'execution_error'
                      ? 'logs-error-explanation-danger'
                      : problemKind === 'manual_case'
                      ? 'logs-error-explanation-manual'
                      : 'logs-error-explanation-warning'
                  }`}
                >
                  {reason === 'cover_letter' && 'Вакансия просит сопроводительное письмо или сценарий остановился на шаге работы с письмом.'}
                  {reason === 'questionnaire' && 'Отклик остановился на анкете работодателя. Нужен ручной проход.'}
                  {reason === 'test' && 'Отклик требует тест. Автоматически не закрывается.'}
                  {reason === 'captcha' && 'Появилась капча или проверка безопасности. Нужен ручной разбор.'}
                  {reason === 'login' && 'Сессия протухла или произошёл редирект на авторизацию.'}
                  {reason === 'external_apply' && 'Отклик ведёт на внешнюю форму, не на стандартный HH flow.'}
                  {reason === 'timeout' && 'Ожидание ответа/страницы превысило лимит. Проверить сеть, HH или селекторы.'}
                  {reason === 'manual_action' && 'Сценарий уже явно оформлен как manual action и передан пользователю.'}
                  {reason === 'error' && 'Техническая ошибка в шаге отклика. Нужен разбор контекста ниже.'}
                  {reason === 'other' &&
                    (problemKind === 'warning'
                      ? 'Предупреждение или blocker без явной технической поломки. Смотри контекст.'
                      : problemKind === 'manual_case'
                      ? 'Нетривиальный ручной кейс. Смотри сообщение и raw logs.'
                      : 'Нестандартная техническая ошибка. Смотри сообщение и raw logs.')}
                </div>
                {log.context && (
                  <div className="logs-event-meta">
                    {vacancyId && <span>vacancyId: {String(vacancyId)}</span>}
                    {profileId && <span>profileId: {String(profileId)}</span>}
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
                    <span>{entries.length} событий</span>
                    {latestProfileId && <span>profileId: {String(latestProfileId)}</span>}
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
      <div className="logs-errors-toolbar">
        <div className="logs-errors-summary">
          <div className="logs-errors-title">Сырой вид / отладка</div>
          <div className="logs-errors-subtitle">
            Есть два режима: удобный просмотр по событиям и сырой поток логов без потерь.
          </div>
        </div>
        <div className="logs-reason-filters">
          <button
            className={`logs-filter-chip ${rawViewMode === 'parsed' ? 'logs-filter-chip-active' : ''}`}
            onClick={() => setRawViewMode('parsed')}
          >
            Удобный вид
          </button>
          <button
            className={`logs-filter-chip ${rawViewMode === 'stream' ? 'logs-filter-chip-active' : ''}`}
            onClick={() => setRawViewMode('stream')}
          >
            Сырой поток
          </button>
        </div>
      </div>
      {filteredLogs.length === 0 ? (
        <div className="logs-empty">Логи не найдены</div>
      ) : rawViewMode === 'stream' ? (
        <pre className="logs-stream">{formatLogsAsText()}</pre>
      ) : (
        <div className="logs-raw-list">
          {filteredLogs.slice().reverse().slice(0, 80).map((log, index) => (
            <details key={`${log.timestamp}-${index}`} className="logs-raw-item">
              <summary className="logs-raw-summary">
                <div className="logs-raw-summary-main">
                  <span className={`logs-level-badge logs-level-${log.level}`}>{log.level}</span>
                  <span className="logs-event-source">{log.source}</span>
                  <span className="logs-event-message">{log.message}</span>
                </div>
                <span className="logs-event-time">{new Date(log.timestamp).toLocaleString()}</span>
              </summary>
              <div className="logs-raw-body">
                <div className="logs-raw-section">
                  <div className="logs-raw-section-title">Message</div>
                  <pre className="logs-raw-json">{log.message}</pre>
                </div>
                <div className="logs-raw-section">
                  <div className="logs-raw-section-title">Context JSON</div>
                  <pre className="logs-raw-json">{JSON.stringify(log.context || {}, null, 2)}</pre>
                </div>
              </div>
            </details>
          ))}
        </div>
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
    } catch {
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
          <h2>Логи системы</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Закрыть</button>
        </div>

        <div className="logs-viewer-controls">
          <input
            type="text"
            className="logs-search-input"
            placeholder="Поиск по логам..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <select
            className="logs-level-filter"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
          >
            <option value="all">Все уровни</option>
            <option value="debug">Отладка</option>
            <option value="info">Инфо</option>
            <option value="warn">Предупреждения</option>
            <option value="error">Ошибки</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={loadLogs}>Обновить</button>
          <button className="btn btn-primary btn-sm" onClick={handleCopyAll} disabled={filteredLogs.length === 0}>
            Скопировать всё
          </button>
          <div className="logs-count">{filteredLogs.length} / {logs.length} записей</div>
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
            <div className="logs-loading">Загрузка логов...</div>
          ) : loadError ? (
            <div className="logs-empty">{loadError}</div>
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
