import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileLogger, type LogEntry } from '../src/utils/fileLogger';
import {
  classifyLogProblem,
  detectReason,
  detectVacancyStatus,
  getProblemBadgeLevel,
  type ErrorReason,
  type LogProblemKind,
} from './logClassification';
import {
  buildLogStats,
  formatLogsAsText,
  getLogVacancyId,
  getSearchHaystack,
  groupLogsByVacancy,
  safeFormatDate,
  safeStringify,
} from './logViewModel';

type LogsTab = 'overview' | 'problems' | 'vacancies' | 'raw';
type RawViewMode = 'parsed' | 'stream';

const PARSED_LOG_LIMIT = 80;
const VACANCY_LIMIT = 30;

const REASON_LABELS: Record<Exclude<ErrorReason, 'all'>, string> = {
  cover_letter: 'Сопроводительное письмо', questionnaire: 'Анкета', test: 'Тест',
  captcha: 'Капча', login: 'Авторизация', external_apply: 'Внешний отклик',
  timeout: 'Таймаут / блокировка', manual_action: 'Ручное действие',
  error: 'Ошибка выполнения', other: 'Другое',
};

const KIND_LABELS: Record<Exclude<LogProblemKind, 'none'>, string> = {
  execution_error: 'Execution error', warning: 'Warning', manual_case: 'Manual case',
};

const EXPLANATIONS: Record<Exclude<ErrorReason, 'all'>, string> = {
  cover_letter: 'Требуется сопроводительное письмо.', questionnaire: 'Требуется анкета работодателя.',
  test: 'Требуется тестовое задание.', captcha: 'Требуется пройти проверку безопасности.',
  login: 'Требуется восстановить авторизацию.', external_apply: 'Отклик продолжится на внешнем сайте.',
  timeout: 'Операция завершилась таймаутом или блокировкой.', manual_action: 'Сценарий передан пользователю.',
  error: 'Технический сбой выполнения.', other: 'Причина не распознана; проверьте контекст.',
};

function contextText(log: LogEntry, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = log.context?.[key];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return null;
}

function detectVacancyStage(log: LogEntry): string {
  const text = `${log.message} ${safeStringify(log.context)}`.toLowerCase();
  if (text.includes('acquisition')) return 'Поиск';
  if (text.includes('preflight')) return 'Предпроверка';
  if (text.includes('validat')) return 'Проверка';
  if (text.includes('modal')) return 'Модальное окно';
  if (text.includes('cover letter') || text.includes('cover_letter')) return 'Сопроводительное письмо';
  if (text.includes('redirect')) return 'Редирект';
  if (contextText(log, 'outcome') === 'success') return 'Успех';
  if (classifyLogProblem(log) === 'manual_case') return 'Ручное действие';
  if (classifyLogProblem(log) === 'execution_error') return 'Ошибка';
  return 'Событие';
}

const EventMeta: React.FC<{ log: LogEntry }> = ({ log }) => {
  const fields = [
    ['vacancyId', getLogVacancyId(log)], ['profileId', contextText(log, 'profileId', 'profile_id')],
    ['outcome', contextText(log, 'outcome')], ['reasonCode', contextText(log, 'reasonCode', 'reason_code')],
  ].filter((field): field is [string, string] => Boolean(field[1]));
  return fields.length ? <div className="logs-event-meta">{fields.map(([key, value]) => <span key={key}>{key}: {value}</span>)}</div> : null;
};

export const LogsViewer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [activeTab, setActiveTab] = useState<LogsTab>('overview');
  const [reasonFilter, setReasonFilter] = useState<ErrorReason>('all');
  const [rawViewMode, setRawViewMode] = useState<RawViewMode>('parsed');
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setLogs(await FileLogger.readLogs());
    } catch {
      setLoadError('Не удалось загрузить логи. Попробуйте обновить.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadLogs(); }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return logs.filter((log) =>
      (levelFilter === 'all' || log.level === levelFilter) && (!query || getSearchHaystack(log).includes(query))
    );
  }, [levelFilter, logs, searchQuery]);

  const problems = useMemo(() => filteredLogs.filter((log) => classifyLogProblem(log) !== 'none'), [filteredLogs]);
  const displayedProblems = useMemo(() => reasonFilter === 'all'
    ? problems
    : problems.filter((log) => detectReason(log) === reasonFilter), [problems, reasonFilter]);
  const vacancyGroups = useMemo(() => groupLogsByVacancy(filteredLogs), [filteredLogs]);
  const stats = useMemo(() => buildLogStats(filteredLogs), [filteredLogs]);
  const reasonCounts = useMemo(() => {
    const counts = new Map<Exclude<ErrorReason, 'all'>, number>();
    problems.forEach((log) => {
      const reason = detectReason(log);
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [problems]);

  const copyFiltered = async () => {
    const text = formatLogsAsText(filteredLogs);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('done');
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.className = 'logs-copy-fallback';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        setCopyState(copied ? 'done' : 'error');
      } catch {
        setCopyState('error');
      }
    }
  };

  const renderEvent = (log: LogEntry, index: number, detailed = false) => {
    const kind = classifyLogProblem(log);
    const reason = detectReason(log);
    const badge = getProblemBadgeLevel(log);
    return <article key={`${log.timestamp}-${index}`} className={`logs-event-item logs-event-item-${kind}`}>
      {detailed && kind !== 'none' && <div className="logs-error-priority-line">
        <span className={`logs-error-priority logs-error-priority-${kind}`}>{KIND_LABELS[kind]}</span>
        <span className="logs-error-hint">{REASON_LABELS[reason]}</span>
      </div>}
      <div className="logs-event-topline">
        <span className={`logs-level-badge logs-level-${detailed ? badge : log.level}`}>{detailed ? badge : log.level}</span>
        <span className="logs-event-source">{log.source}</span>
        <span className="logs-event-time">{safeFormatDate(log.timestamp)}</span>
      </div>
      <div className="logs-event-message">{log.message}</div>
      {detailed && <><div className={`logs-error-explanation logs-error-explanation-${kind}`}>{EXPLANATIONS[reason]}</div><EventMeta log={log} /></>}
    </article>;
  };

  const renderOverview = () => {
    const cards = [
      ['Показано', stats.total], ['Проблемы', stats.problems], ['Execution errors', stats.executionErrors],
      ['Manual cases', stats.manualCases], ['Warnings', stats.warnings], ['Вакансии', stats.vacancies], ['Источники', stats.sources],
    ];
    return <div className="logs-tab-panel">
      <div className="logs-summary-grid">{cards.map(([label, value]) => <div className="logs-summary-card" key={label}>
        <div className="logs-summary-label">{label}</div><div className="logs-summary-value">{value}</div>
      </div>)}</div>
      <div className="logs-info-grid">
        <section className="logs-info-card"><h3>Топ причин</h3>{stats.topReasons.length
          ? <div className="logs-reason-list">{stats.topReasons.map(([reason, count]) => <div className="logs-reason-item" key={reason}><span>{REASON_LABELS[reason]}</span><strong>{count}</strong></div>)}</div>
          : <div className="logs-empty-inline">Проблемных событий нет</div>}</section>
        <section className="logs-info-card"><h3>Последние события</h3>{stats.recent.length
          ? <div className="logs-event-list">{stats.recent.map((log, index) => renderEvent(log, index))}</div>
          : <div className="logs-empty-inline">По текущим фильтрам событий нет</div>}</section>
      </div>
    </div>;
  };

  const renderProblems = () => <div className="logs-tab-panel">
    <div className="logs-errors-toolbar"><div><div className="logs-errors-title">Проблемные события</div>
      <div className="logs-errors-subtitle">Технические сбои, предупреждения и управляемые ручные кейсы показаны раздельно.</div></div>
      <div className="logs-reason-filters"><button className={`logs-filter-chip ${reasonFilter === 'all' ? 'logs-filter-chip-active' : ''}`} onClick={() => setReasonFilter('all')}>Все <span>{problems.length}</span></button>
        {reasonCounts.map(([reason, count]) => <button key={reason} className={`logs-filter-chip ${reasonFilter === reason ? 'logs-filter-chip-active' : ''}`} onClick={() => setReasonFilter(reason)}>{REASON_LABELS[reason]} <span>{count}</span></button>)}</div>
    </div>
    {displayedProblems.length ? <div className="logs-event-list">{[...displayedProblems].reverse().map((log, index) => renderEvent(log, index, true))}</div> : <div className="logs-empty">Проблемные события не найдены</div>}
  </div>;

  const renderVacancies = () => <div className="logs-tab-panel">
    {vacancyGroups.length > VACANCY_LIMIT && <div className="logs-limit-note">Показано {VACANCY_LIMIT} из {vacancyGroups.length} вакансий.</div>}
    {vacancyGroups.length ? <div className="logs-vacancy-list">{vacancyGroups.slice(0, VACANCY_LIMIT).map(({ vacancyId, entries }) => {
      const latest = entries[entries.length - 1];
      const profileId = [...entries].reverse().map((log) => contextText(log, 'profileId', 'profile_id')).find(Boolean);
      return <article className="logs-vacancy-card" key={vacancyId}>
        <header className="logs-vacancy-header"><div className="logs-vacancy-title-block"><strong>Vacancy {vacancyId}</strong><span>{entries.length} событий</span>{profileId && <span>profileId: {profileId}</span>}</div>
          <div className="logs-vacancy-status-block"><span className={`logs-vacancy-status logs-vacancy-status-${detectVacancyStatus(latest)}`}>{detectVacancyStage(latest)}</span><span>{safeFormatDate(latest.timestamp)}</span></div></header>
        <div className="logs-vacancy-summary"><div className="logs-vacancy-summary-title">Последний итог</div><div>{latest.message}</div></div>
        <div className="logs-vacancy-timeline">{entries.slice(-6).reverse().map((log, index) => <div className="logs-vacancy-timeline-item" key={`${log.timestamp}-${index}`}><div className={`logs-vacancy-timeline-dot logs-vacancy-timeline-dot-${detectVacancyStatus(log)}`} /><div className="logs-vacancy-timeline-content"><div className="logs-vacancy-timeline-top"><span className={`logs-vacancy-status logs-vacancy-status-${detectVacancyStatus(log)}`}>{detectVacancyStage(log)}</span><span>{safeFormatDate(log.timestamp)}</span></div><div className="logs-vacancy-message">{log.message}</div></div></div>)}</div>
      </article>;
    })}</div> : <div className="logs-empty">Нет событий с достоверным vacancyId</div>}
  </div>;

  const renderRaw = () => {
    const shown = filteredLogs.slice().reverse().slice(0, PARSED_LOG_LIMIT);
    return <div className="logs-tab-panel"><div className="logs-errors-toolbar"><div><div className="logs-errors-title">Raw / отладка</div><div className="logs-errors-subtitle">Сырой поток и экспорт содержат ровно отфильтрованные записи.</div></div>
      <div className="logs-reason-filters"><button className={`logs-filter-chip ${rawViewMode === 'parsed' ? 'logs-filter-chip-active' : ''}`} onClick={() => setRawViewMode('parsed')}>Parsed</button><button className={`logs-filter-chip ${rawViewMode === 'stream' ? 'logs-filter-chip-active' : ''}`} onClick={() => setRawViewMode('stream')}>Raw stream</button></div></div>
      {!filteredLogs.length ? <div className="logs-empty">Логи не найдены</div> : rawViewMode === 'stream' ? <pre className="logs-stream">{formatLogsAsText(filteredLogs)}</pre> : <>
        {filteredLogs.length > PARSED_LOG_LIMIT && <div className="logs-limit-note">Удобный вид: последние {PARSED_LOG_LIMIT} из {filteredLogs.length}. Raw stream и копирование включают все {filteredLogs.length}.</div>}
        <div className="logs-raw-list">{shown.map((log, index) => <details className="logs-raw-item" key={`${log.timestamp}-${index}`}><summary className="logs-raw-summary"><div className="logs-raw-summary-main"><span className={`logs-level-badge logs-level-${log.level}`}>{log.level}</span><span>{log.source}</span><span className="logs-event-message">{log.message}</span></div><span>{safeFormatDate(log.timestamp)}</span></summary><div className="logs-raw-body"><pre className="logs-raw-json">{safeStringify(log.context ?? {}, 2)}</pre></div></details>)}</div>
      </>}</div>;
  };

  const tabs: Array<{ id: LogsTab; label: string; count?: number }> = [
    { id: 'overview', label: 'Сводка' }, { id: 'problems', label: 'Проблемы', count: stats.problems },
    { id: 'vacancies', label: 'Вакансии', count: stats.vacancies }, { id: 'raw', label: 'Raw', count: stats.total },
  ];

  return <div className="logs-viewer-overlay"><div className="logs-viewer-container">
    <header className="logs-viewer-header"><h2>Диагностика логов</h2><button className="btn btn-secondary btn-sm" onClick={onClose}>Закрыть</button></header>
    <div className="logs-viewer-controls"><input className="logs-search-input" aria-label="Поиск по логам" placeholder="message, source, context, vacancy, profile, outcome…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /><select className="logs-level-filter" aria-label="Уровень логов" value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}><option value="all">Все уровни</option><option value="debug">Debug</option><option value="info">Info</option><option value="warn">Warn</option><option value="error">Error</option></select><button className="btn btn-secondary btn-sm" onClick={() => void loadLogs()} disabled={loading}>Обновить</button><button className="btn btn-primary btn-sm" onClick={() => void copyFiltered()} disabled={!filteredLogs.length}>Копировать отфильтрованные</button>
      <div className="logs-count"><span>Показано {stats.total} / {logs.length}</span><span>Проблемы {stats.problems}</span><span>Вакансии {stats.vacancies}</span>{copyState === 'done' && <span className="logs-copy-success">Скопировано</span>}{copyState === 'error' && <span className="logs-copy-error">Не удалось скопировать</span>}</div></div>
    <nav className="logs-tabs">{tabs.map((tab) => <button key={tab.id} className={`logs-tab ${activeTab === tab.id ? 'logs-tab-active' : ''}`} onClick={() => setActiveTab(tab.id)}>{tab.label}{tab.count !== undefined && <span className="logs-tab-count">{tab.count}</span>}</button>)}</nav>
    <main className="logs-viewer-content">{loading ? <div className="logs-loading">Загрузка логов…</div> : loadError ? <div className="logs-empty"><p>{loadError}</p><button className="btn btn-secondary btn-sm" onClick={() => void loadLogs()}>Повторить</button></div> : activeTab === 'overview' ? renderOverview() : activeTab === 'problems' ? renderProblems() : activeTab === 'vacancies' ? renderVacancies() : renderRaw()}</main>
  </div></div>;
};
