import { t } from '../src/i18n';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  if (text.includes('acquisition')) return t("Поиск");
  if (text.includes('preflight')) return t("Предпроверка");
  if (text.includes('validat')) return t("Проверка");
  if (text.includes('modal')) return t("Модальное окно");
  if (text.includes('cover letter') || text.includes('cover_letter')) return t("Сопроводительное письмо");
  if (text.includes('redirect')) return t("Редирект");
  if (contextText(log, 'outcome') === 'success') return t("Успех");
  if (classifyLogProblem(log) === 'manual_case') return t("Ручное действие");
  if (classifyLogProblem(log) === 'execution_error') return t("Ошибка");
  return t("Событие");
}

const EventMeta: React.FC<{ log: LogEntry }> = ({ log }) => {
  const fields = [
    ['vacancyId', getLogVacancyId(log)], ['profileId', contextText(log, 'profileId', 'profile_id')],
    ['outcome', contextText(log, 'outcome')], ['reasonCode', contextText(log, 'reasonCode', 'reason_code')],
  ].filter((field): field is [string, string] => Boolean(field[1]));
  return fields.length ? <div className="logs-event-meta">{fields.map(([key, value]) => <span key={key}>{key}: {value}</span>)}</div> : null;
};

export const LogsViewer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [activeTab, setActiveTab] = useState<LogsTab>('problems');
  const [reasonFilter, setReasonFilter] = useState<ErrorReason>('all');
  const [rawViewMode, setRawViewMode] = useState<RawViewMode>('parsed');
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setLogs(await FileLogger.readLogs());
    } catch {
      setLoadError(t("Не удалось загрузить логи. Попробуйте обновить."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadLogs(); }, [loadLogs]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [onClose]);

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
        <span className={`logs-error-priority logs-error-priority-${kind}`}>{t(KIND_LABELS[kind])}</span>
        <span className="logs-error-hint">{t(REASON_LABELS[reason])}</span>
      </div>}
      <div className="logs-event-topline">
        <span className={`logs-level-badge logs-level-${detailed ? badge : log.level}`}>{detailed ? badge : log.level}</span>
        <span className="logs-event-source">{log.source}</span>
        <span className="logs-event-time">{safeFormatDate(log.timestamp)}</span>
      </div>
      <div className="logs-event-message">{log.message}</div>
      {detailed && <><div className={`logs-error-explanation logs-error-explanation-${kind}`}>{t(EXPLANATIONS[reason])}</div><EventMeta log={log} /></>}
    </article>;
  };

  const renderOverview = () => {
    const cards = [
      [t('Execution errors'), stats.executionErrors], [t('Manual cases'), stats.manualCases],
      [t('Warnings'), stats.warnings], [t("Вакансии"), stats.vacancies],
    ];
    return <div className="logs-tab-panel">
      <div className="logs-summary-grid">{cards.map(([label, value]) => <div className="logs-summary-card" key={label}>
        <div className="logs-summary-label">{label}</div><div className="logs-summary-value">{value}</div>
      </div>)}</div>
      <div className="logs-info-grid">
        <section className="logs-info-card"><h3>{t("Топ причин")}</h3>{stats.topReasons.length
          ? <div className="logs-reason-list">{stats.topReasons.map(([reason, count]) => <div className="logs-reason-item" key={reason}><span>{t(REASON_LABELS[reason])}</span><strong>{count}</strong></div>)}</div>
          : <div className="logs-empty-inline">{t("Проблемных событий нет")}</div>}</section>
        <section className="logs-info-card"><h3>{t("Последние события")}</h3>{stats.recent.length
          ? <div className="logs-event-list">{stats.recent.map((log, index) => renderEvent(log, index))}</div>
          : <div className="logs-empty-inline">{t("По текущим фильтрам событий нет")}</div>}</section>
      </div>
    </div>;
  };

  const renderProblems = () => <div className="logs-tab-panel">
    <div className="logs-errors-toolbar"><div><div className="logs-errors-title">{t("Проблемные события")}</div>
      <div className="logs-errors-subtitle">{t("Технические сбои, предупреждения и управляемые ручные кейсы показаны раздельно.")}</div></div>
      <div className="logs-reason-filters"><button type="button" className="logs-filter-chip" aria-pressed={reasonFilter === 'all'} onClick={() => setReasonFilter('all')}>{t("Все") + " "}<span>{problems.length}</span></button>
        {reasonCounts.map(([reason, count]) => <button type="button" key={reason} className="logs-filter-chip" aria-pressed={reasonFilter === reason} onClick={() => setReasonFilter(reason)}>{t(REASON_LABELS[reason])} <span>{count}</span></button>)}</div>
    </div>
    {displayedProblems.length > PARSED_LOG_LIMIT && <div className="logs-limit-note">{t("Показано") + " "}{PARSED_LOG_LIMIT}{" " + t("из") + " "}{displayedProblems.length}</div>}
    {displayedProblems.length ? <div className="logs-event-list">{displayedProblems.slice(-PARSED_LOG_LIMIT).reverse().map((log, index) => renderEvent(log, index, true))}</div> : <div className="logs-empty">{t("Проблемные события не найдены")}</div>}
  </div>;

  const renderVacancies = () => <div className="logs-tab-panel">
    {vacancyGroups.length > VACANCY_LIMIT && <div className="logs-limit-note">{t("Показано") + " "}{VACANCY_LIMIT}{" " + t("из") + " "}{vacancyGroups.length}{" " + t("вакансий.")}</div>}
    {vacancyGroups.length ? <div className="logs-vacancy-list">{vacancyGroups.slice(0, VACANCY_LIMIT).map(({ vacancyId, entries }) => {
      const latest = entries[entries.length - 1];
      const profileId = [...entries].reverse().map((log) => contextText(log, 'profileId', 'profile_id')).find(Boolean);
      return <article className="logs-vacancy-card" key={vacancyId}>
        <header className="logs-vacancy-header"><div className="logs-vacancy-title-block"><strong>{t('Вакансия {0}', vacancyId)}</strong><span>{entries.length}{" " + t("событий")}</span>{profileId && <span>profileId: {profileId}</span>}</div>
          <div className="logs-vacancy-status-block"><span className={`logs-vacancy-status logs-vacancy-status-${detectVacancyStatus(latest)}`}>{detectVacancyStage(latest)}</span><span>{safeFormatDate(latest.timestamp)}</span></div></header>
        <div className="logs-vacancy-summary"><div className="logs-vacancy-summary-title">{t("Последний итог")}</div><div>{latest.message}</div></div>
        <div className="logs-vacancy-timeline">{entries.slice(-6).reverse().map((log, index) => <div className="logs-vacancy-timeline-item" key={`${log.timestamp}-${index}`}><div className={`logs-vacancy-timeline-dot logs-vacancy-timeline-dot-${detectVacancyStatus(log)}`} /><div className="logs-vacancy-timeline-content"><div className="logs-vacancy-timeline-top"><span className={`logs-vacancy-status logs-vacancy-status-${detectVacancyStatus(log)}`}>{detectVacancyStage(log)}</span><span>{safeFormatDate(log.timestamp)}</span></div><div className="logs-vacancy-message">{log.message}</div></div></div>)}</div>
      </article>;
    })}</div> : <div className="logs-empty">{t("Нет событий с достоверным vacancyId")}</div>}
  </div>;

  const renderRaw = () => {
    const shown = filteredLogs.slice().reverse().slice(0, PARSED_LOG_LIMIT);
    return <div className="logs-tab-panel"><div className="logs-errors-toolbar"><div><div className="logs-errors-title">{t("Raw / отладка")}</div><div className="logs-errors-subtitle">{t("Сырой поток и экспорт содержат ровно отфильтрованные записи.")}</div></div>
      <div className="logs-reason-filters"><button type="button" className="logs-filter-chip" aria-pressed={rawViewMode === 'parsed'} onClick={() => setRawViewMode('parsed')}>{t('Parsed')}</button><button type="button" className="logs-filter-chip" aria-pressed={rawViewMode === 'stream'} onClick={() => setRawViewMode('stream')}>{t('Raw stream')}</button></div></div>
      {!filteredLogs.length ? <div className="logs-empty">{t("Логи не найдены")}</div> : rawViewMode === 'stream' ? <pre className="logs-stream">{formatLogsAsText(filteredLogs)}</pre> : <>
        {filteredLogs.length > PARSED_LOG_LIMIT && <div className="logs-limit-note">{t("Удобный вид: последние") + " "}{PARSED_LOG_LIMIT}{" " + t("из") + " "}{filteredLogs.length}{t(". Raw stream и копирование включают все") + " "}{filteredLogs.length}.</div>}
        <div className="logs-raw-list">{shown.map((log, index) => <details className="logs-raw-item" key={`${log.timestamp}-${index}`}><summary className="logs-raw-summary"><div className="logs-raw-summary-main"><span className={`logs-level-badge logs-level-${log.level}`}>{log.level}</span><span>{log.source}</span><span className="logs-event-message">{log.message}</span></div><span>{safeFormatDate(log.timestamp)}</span></summary><div className="logs-raw-body"><pre className="logs-raw-json">{safeStringify(log.context ?? {}, 2)}</pre></div></details>)}</div>
      </>}</div>;
  };

  const tabs: Array<{ id: LogsTab; label: string; count?: number }> = [
    { id: 'overview', label: t("Сводка") }, { id: 'problems', label: t("Проблемы"), count: stats.problems },
    { id: 'vacancies', label: t("Вакансии"), count: stats.vacancies }, { id: 'raw', label: t('Исходные записи'), count: stats.total },
  ];

  return <div className="logs-viewer-overlay"><dialog open className="logs-viewer-container" ref={dialogRef} aria-modal="true" aria-labelledby="logs-title">
    <header className="logs-viewer-header"><h2 id="logs-title">{t("Диагностика логов")}</h2><button className="btn btn-secondary btn-sm" onClick={onClose}>{t("Закрыть")}</button></header>
    <div className="logs-viewer-controls"><input type="search" className="logs-search-input" aria-label={t("Поиск по логам")} placeholder={t("Поиск по событиям")} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /><select className="logs-level-filter" aria-label={t("Уровень логов")} value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}><option value="all">{t("Все уровни")}</option><option value="debug">Debug</option><option value="info">Info</option><option value="warn">Warn</option><option value="error">Error</option></select><button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadLogs()} disabled={loading}>{t("Обновить")}</button><button type="button" className="btn btn-primary btn-sm" onClick={() => void copyFiltered()} disabled={!filteredLogs.length}>{t("Копировать журнал")}</button>
      <div className="logs-count"><span>{t("Показано") + " "}{stats.total} / {logs.length}</span><span>{t("Проблемы") + " "}{stats.problems}</span><span>{t("Вакансии") + " "}{stats.vacancies}</span>{copyState === 'done' && <span className="logs-copy-success">{t("Скопировано")}</span>}{copyState === 'error' && <span className="logs-copy-error">{t("Не удалось скопировать")}</span>}</div></div>
    <nav className="logs-tabs" aria-label={t("Разделы журнала")}>{tabs.map((tab) => <button type="button" key={tab.id} className="logs-tab" aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => setActiveTab(tab.id)}>{tab.label}{tab.count !== undefined && <span className="logs-tab-count">{tab.count}</span>}</button>)}</nav>
    <main className="logs-viewer-content">{loading ? <div className="logs-loading">{t("Загрузка логов…")}</div> : loadError ? <div className="logs-empty"><p>{loadError}</p><button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadLogs()}>{t("Повторить")}</button></div> : activeTab === 'overview' ? renderOverview() : activeTab === 'problems' ? renderProblems() : activeTab === 'vacancies' ? renderVacancies() : renderRaw()}</main>
  </dialog></div>;
};
