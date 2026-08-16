import React, { useEffect, useRef, useState } from 'react';
import type { AppState, AutoApplyMode } from '../src/state/types';
import {
  getPrimaryControlsState,
  getPrimaryProfileViewModel,
  getPrimaryResumeViewModel,
  getPrimaryRuntimeStatusViewModel,
  getTodayLocalApplyStats,
  getUserFacingManualActions,
} from '../src/state/selectors';
import { RuntimeSettingsPanel } from '../src/components/RuntimeSettingsPanel';
import { ManualActionsPanel } from '../src/components/ManualActionsPanel';
import { QuestionnairePanel } from '../src/components/QuestionnairePanel';
import { selectPendingManualQuestionnaires } from '../src/questionnaires';
import { ProfileEditor } from '../src/components/ProfileEditor';
import { SelectMenu } from '../src/components/SelectMenu';
import { formatResumeLabel } from '../src/components/resumeLabel';
import { LogsViewer } from './LogsViewer';
import './styles.css';

const RESUME_HINT_DISMISSED_KEY = 'dismissed_resume_search_filter_hint';
const THEME_STORAGE_KEY = 'ui_theme';
const HINT_DISMISS_ANIMATION_MS = 200;
const EXTENSION_VERSION = chrome.runtime.getManifest?.().version ?? 'dev';

type Theme = 'light' | 'dark';
type IconName = 'play' | 'stop' | 'terminal' | 'sun' | 'moon' | 'user' | 'document' | 'refresh' | 'sliders' | 'alert';

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  play: <path d="m6 4 8 5-8 5V4Z" />,
  stop: <rect x="5" y="5" width="8" height="8" rx="1" />,
  terminal: <><path d="m4 5 3 3-3 3" /><path d="M9 12h4" /></>,
  sun: <><circle cx="9" cy="9" r="3" /><path d="M9 1.5v1.3M9 15.2v1.3M1.5 9h1.3M15.2 9h1.3M3.7 3.7l.9.9M13.4 13.4l.9.9M14.3 3.7l-.9.9M4.6 13.4l-.9.9" /></>,
  moon: <path d="M15 11.3A6.5 6.5 0 0 1 6.7 3a5.8 5.8 0 1 0 8.3 8.3Z" />,
  user: <><circle cx="9" cy="6" r="3" /><path d="M3.5 16c.5-3.2 2.3-4.8 5.5-4.8s5 1.6 5.5 4.8" /></>,
  document: <><path d="M5 2.5h5l3 3v10H5z" /><path d="M10 2.5v3h3M7.5 9h3M7.5 12h3" /></>,
  refresh: <><path d="M14.5 6A6 6 0 0 0 4 4.3L2.5 6" /><path d="M2.5 2.8V6H6M3.5 12A6 6 0 0 0 14 13.7l1.5-1.7" /><path d="M15.5 15.2V12H12" /></>,
  sliders: <><path d="M3 5h5M12 5h3M3 13h3M10 13h5" /><circle cx="10" cy="5" r="2" /><circle cx="8" cy="13" r="2" /></>,
  alert: <><path d="M9 2.5 16 15H2L9 2.5Z" /><path d="M9 7v3.5M9 13h.01" /></>,
};

const Icon: React.FC<{ name: IconName }> = ({ name }) => (
  <svg className="icon" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {ICON_PATHS[name]}
  </svg>
);

const AppMark: React.FC = () => (
  <svg className="app-mark" viewBox="0 0 128 128" aria-hidden="true">
    <rect width="128" height="128" rx="30" fill="currentColor" />
    <ellipse className="app-mark-orbit app-mark-orbit-primary" cx="64" cy="64" rx="47" ry="27" transform="rotate(-24 64 64)" />
    <ellipse className="app-mark-orbit app-mark-orbit-secondary" cx="64" cy="64" rx="27" ry="48" transform="rotate(31 64 64)" />
    <path className="app-mark-arc" d="M23 74c13 24 48 34 75 16" />
    <path className="app-mark-monogram" d="M36 42h12v17h12V42h12v44H60V70H48v16H36V42Zm43 0h12v17h9V42h12v44h-12V70h-9v16H79V42Z" />
    <circle className="app-mark-satellite" cx="104" cy="38" r="7" />
    <circle className="app-mark-node" cx="25" cy="73" r="3.5" />
    <circle className="app-mark-star" cx="91" cy="23" r="2.5" />
  </svg>
);

const getPreferredTheme = (): Theme => (
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
);

const RUNTIME_LABELS: Record<string, string> = {
  IDLE: 'Готов',
  STARTING: 'Запуск',
  RUNNING: 'Активен',
  STOPPING: 'Остановка',
  STOPPED: 'Остановлен',
  PAUSED_MANUAL_ACTION: 'На паузе',
  PAUSED_NO_VACANCIES: 'На паузе',
  PAUSED_BY_USER: 'На паузе',
  ERROR: 'Ошибка',
};

export const App: React.FC = () => {
  const [state, setState] = useState<AppState | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [isEditorClosing, setIsEditorClosing] = useState(false);
  const editorCloseTimerRef = useRef<number>();
  const [logsViewerOpen, setLogsViewerOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(getPreferredTheme);
  const [isResumeHintHighlighted, setIsResumeHintHighlighted] = useState(true);
  const [isResumeHintDismissing, setIsResumeHintDismissing] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (response?.state) setState(response.state);
    });

    const pollInterval = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
        if (response?.state) setState(response.state);
      });
    }, 500);

    const listener = (message: any) => {
      if (message.type === 'STATE_UPDATE') setState(message.state);
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      clearInterval(pollInterval);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  useEffect(() => {
    const restorePreferences = async () => {
      const stored = await chrome.storage.local.get([RESUME_HINT_DISMISSED_KEY, THEME_STORAGE_KEY]);
      if (stored[RESUME_HINT_DISMISSED_KEY] === true) setIsResumeHintHighlighted(false);
      if (stored[THEME_STORAGE_KEY] === 'light' || stored[THEME_STORAGE_KEY] === 'dark') {
        setTheme(stored[THEME_STORAGE_KEY]);
      }
    };

    void restorePreferences();
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    void chrome.storage.local.set({ [THEME_STORAGE_KEY]: nextTheme });
  };

  const openProfileEditor = (profileId: string) => {
    window.clearTimeout(editorCloseTimerRef.current);
    setIsEditorClosing(false);
    setEditingProfileId(profileId);
  };

  const closeProfileEditor = () => {
    setIsEditorClosing(true);
    editorCloseTimerRef.current = window.setTimeout(() => {
      setEditingProfileId(null);
      setIsEditorClosing(false);
    }, 180);
  };

  useEffect(() => () => window.clearTimeout(editorCloseTimerRef.current), []);

  if (!state) {
    return <div className="app loading" data-theme={theme}><div className="spinner"><span />Загрузка control center…</div></div>;
  }

  const runtimeVm = getPrimaryRuntimeStatusViewModel(state);
  const resumeVm = getPrimaryResumeViewModel(state);
  const profileVm = getPrimaryProfileViewModel(state);
  const controlsVm = getPrimaryControlsState(state);
  const manualActions = getUserFacingManualActions(state);
  const backendQuestionnaireActions = selectPendingManualQuestionnaires(
    state.manualActions,
    state.questionnaires.queue
  );
  const todaySuccess = getTodayLocalApplyStats(state).succeeded;
  const editingProfile = editingProfileId ? state.profiles[editingProfileId] : undefined;
  const isRunning = runtimeVm.runtimeState === 'RUNNING';
  const profileOptions = [
    { value: '', label: 'Профиль не выбран' },
    ...profileVm.profiles.map((profile) => ({ value: profile.id, label: profile.name })),
  ];
  const resumeOptions = [
    { value: '', label: 'Резюме не выбрано' },
    ...resumeVm.candidates.map((resume) => ({ value: resume.hash, label: formatResumeLabel(resume) })),
  ];

  const handleStart = () => chrome.runtime.sendMessage({ type: 'AUTO_APPLY_START' });
  const handleStop = () => chrome.runtime.sendMessage({ type: 'AUTO_APPLY_STOP' });
  const handleModeChange = (mode: AutoApplyMode) => chrome.runtime.sendMessage({ type: 'SET_MODE', mode });
  const dismissResumeHint = () => {
    setIsResumeHintDismissing(true);
    void chrome.storage.local.set({ [RESUME_HINT_DISMISSED_KEY]: true });
    window.setTimeout(() => {
      setIsResumeHintHighlighted(false);
      setIsResumeHintDismissing(false);
    }, HINT_DISMISS_ANIMATION_MS);
  };

  return (
    <div className="app" data-theme={theme}>
      <header className="header">
        <div className="brand"><span className="brand-mark"><AppMark /></span><div className="brand-copy"><div className="brand-title-row"><h1>HH Orbit</h1><span className="version">v{EXTENSION_VERSION}</span></div><span className="brand-caption">Control center</span></div></div>
        <div className="header-actions">
          <button type="button" className="icon-button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button type="button" className="icon-button" onClick={() => setLogsViewerOpen(true)} aria-label="Открыть логи" title="Логи">
            <Icon name="terminal" />
          </button>
        </div>
      </header>

      <main className="main">
        <section className="command-panel" aria-labelledby="runtime-heading">
          <div className="command-status">
            <div className="status-line">
              <span className="status-pill" data-state={runtimeVm.runtimeState} key={runtimeVm.runtimeState}>
                <span className="status-dot" />{RUNTIME_LABELS[runtimeVm.runtimeState] ?? runtimeVm.runtimeState}
              </span>
              <span className="phase" id="runtime-heading">{runtimeVm.phaseLabel}</span>
            </div>
            <div className="runtime-stats" aria-label="Статистика запуска">
              <span><b className="metric-value" key={`processed-${runtimeVm.processed}`}>{runtimeVm.processed}</b> обработано</span>
              <span><b className="metric-value" key={`success-${runtimeVm.success}`}>{runtimeVm.success}</b> успех</span>
              <span className="stat-today"><b className="metric-value" key={`today-${todaySuccess}`}>{todaySuccess}</b> сегодня</span>
              <span className={runtimeVm.manualActions > 0 ? 'stat-manual' : ''}><b className="metric-value" key={`manual-${runtimeVm.manualActions}`}>{runtimeVm.manualActions}</b> вручную</span>
            </div>
          </div>
          <div className="command-actions">
            <button className="btn btn-primary" onClick={handleStart} disabled={!controlsVm.canStart}><Icon name="play" />Старт</button>
            <button className={`btn ${isRunning ? 'btn-danger' : 'btn-secondary'}`} onClick={handleStop} disabled={!controlsVm.canStop}><Icon name="stop" />Стоп</button>
          </div>
        </section>

        <section className="panel context-panel" aria-label="Контекст запуска">
          <div className="context-row">
            <div className="row-label"><span className="row-icon"><Icon name="user" /></span><span>Профиль</span></div>
            <div className="row-control">
              <SelectMenu
                id="active-profile"
                value={profileVm.activeProfileId || ''}
                options={profileOptions}
                placeholder="Профиль не выбран"
                onChange={(value) => chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PROFILE', id: value || null })}
              />
              <button type="button" className="text-action" onClick={() => profileVm.activeProfileId && openProfileEditor(profileVm.activeProfileId)} disabled={!profileVm.activeProfileId}>Изменить</button>
            </div>
          </div>
          <div className="profile-utilities">
            <button type="button" onClick={() => openProfileEditor('__new__')}>+ Новый</button>
            <button type="button" onClick={() => profileVm.activeProfileId && chrome.runtime.sendMessage({ type: 'DUPLICATE_PROFILE', id: profileVm.activeProfileId })} disabled={!profileVm.activeProfileId}>Дублировать</button>
            <button type="button" className="danger-text" onClick={() => {
              if (profileVm.activeProfileId && confirm('Удалить профиль? Это действие нельзя отменить.')) chrome.runtime.sendMessage({ type: 'DELETE_PROFILE', id: profileVm.activeProfileId });
            }} disabled={!profileVm.activeProfileId}>Удалить</button>
          </div>

          <div className="context-divider" />

          <div className="context-row">
            <div className="row-label"><span className="row-icon"><Icon name="document" /></span><span>Резюме</span></div>
            <div className="row-control">
              <SelectMenu
                id="selected-resume"
                value={resumeVm.selectedResumeHash || ''}
                options={resumeOptions}
                placeholder="Резюме не выбрано"
                onChange={(value) => chrome.runtime.sendMessage({ type: 'SELECT_RESUME', hash: value || null })}
              />
              <button type="button" className="icon-button compact" onClick={() => chrome.runtime.sendMessage({ type: 'REFRESH_RESUMES_API' })} aria-label="Обновить резюме из HH" title="Обновить резюме"><Icon name="refresh" /></button>
            </div>
          </div>
          <div className={isResumeHintHighlighted ? `form-hint highlight-hint dismissible-hint${isResumeHintDismissing ? ' is-dismissing' : ''}` : 'form-hint'}>
            Если выбрать резюме, HH будет учитывать его как фильтр при поиске вакансий.
            {isResumeHintHighlighted && <button type="button" className="hint-dismiss-button" aria-label="Снять выделение подсказки" onClick={dismissResumeHint} disabled={isResumeHintDismissing}>×</button>}
          </div>
        </section>

        {editingProfileId && (
          <section className={`panel editor-panel${isEditorClosing ? ' is-closing' : ''}`}>
            <ProfileEditor
              profile={editingProfileId === '__new__' ? undefined : editingProfile}
              resumeCandidates={state.resumeCandidates}
              onSave={(payload) => chrome.runtime.sendMessage({ type: 'CREATE_PROFILE', payload }, closeProfileEditor)}
              onUpdate={(payload) => {
                if (editingProfile) chrome.runtime.sendMessage({ type: 'UPDATE_PROFILE', id: editingProfile.id, payload }, closeProfileEditor);
              }}
              onCancel={closeProfileEditor}
            />
          </section>
        )}

        <section className="panel mode-panel" aria-labelledby="mode-heading">
          <div className="section-heading"><span className="section-icon"><Icon name="sliders" /></span><h2 id="mode-heading">Режим</h2></div>
          <div className="segmented-control" data-mode={state.mode}>
            <label className={state.mode === 'backend' ? 'active' : ''}><input type="radio" name="mode" value="backend" checked={state.mode === 'backend'} onChange={() => handleModeChange('backend')} disabled={isRunning} />Backend</label>
            <label className={state.mode === 'live' ? 'active' : ''}><input type="radio" name="mode" value="live" checked={state.mode === 'live'} onChange={() => handleModeChange('live')} disabled={isRunning} />Live</label>
          </div>
          <p className="mode-description">{state.mode === 'backend'
            ? 'HTTP-first режим: поиск и отклики без постоянного управления вкладкой.'
            : 'Browser-owned режим: действия выполняются в реальной вкладке HH.'}</p>
        </section>

        <section className="panel settings-panel" aria-labelledby="settings-heading">
          <div className="section-heading"><span className="section-icon"><Icon name="sliders" /></span><h2 id="settings-heading">Настройки запуска</h2></div>
          <RuntimeSettingsPanel settings={controlsVm.settings} onPatch={(patch) => chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', patch })} />
        </section>

        <section className={`panel manual-panel${manualActions.length > 0 ? ' has-actions' : ''}`} aria-labelledby="manual-heading">
          <div className="section-heading"><span className="section-icon"><Icon name="alert" /></span><h2 id="manual-heading">Ручные действия</h2>{manualActions.length > 0 && <span className="section-count">{manualActions.length}</span>}</div>
          <ManualActionsPanel
            actions={manualActions}
            onOpen={(url) => url && chrome.tabs.create({ url, active: true })}
            onDone={(id) => chrome.runtime.sendMessage({ type: 'MANUAL_ACTION_DONE', id })}
            onDismiss={(id) => chrome.runtime.sendMessage({ type: 'MANUAL_ACTION_DISMISS', id })}
            onPrepareAI={state.mode === 'backend'
              ? (id) => chrome.runtime.sendMessage({
                  type: 'QUESTIONNAIRE_PREPARE_MANUAL',
                  actionId: id,
                })
              : undefined}
          />
          {state.mode === 'backend' && (
            <QuestionnairePanel
              state={state.questionnaires}
              selectedResume={resumeVm.selectedResume}
              manualQuestionnaireCount={backendQuestionnaireActions.length}
              onPatch={(patch) => chrome.runtime.sendMessage({ type: 'UPDATE_QUESTIONNAIRE_SETTINGS', patch })}
            />
          )}
        </section>
      </main>

      {logsViewerOpen && <LogsViewer onClose={() => setLogsViewerOpen(false)} />}
    </div>
  );
};
