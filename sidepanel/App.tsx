import React, { useEffect, useRef, useState } from 'react';
import type { AppState } from '../src/state/types';
import {
  getPrimaryControlsState,
  getPrimaryProfileViewModel,
  getPrimaryResumeViewModel,
  getPrimaryRuntimeStatusViewModel,
  getTodayLocalApplyStats,
  getUserFacingManualActions,
  isSelectedResumeAvailable,
} from '../src/state/selectors';
import { RuntimeSettingsPanel } from '../src/components/RuntimeSettingsPanel';
import { QuestionnairePanel } from '../src/components/QuestionnairePanel';
import { selectPendingManualQuestionnaires } from '../src/questionnaires';
import { ProfileEditor } from '../src/components/ProfileEditor';
import { SelectMenu } from '../src/components/SelectMenu';
import { formatResumeLabel } from '../src/components/resumeLabel';
import { LogsViewer } from './LogsViewer';
import { LaunchScreen } from './LaunchScreen';
import type { LaunchScreenName } from './LaunchScreen';
import { AppMark, Icon } from './icons';
import './styles.css';
import type { AutoApplyStartResult } from '../src/background/autoApplyStart';
import { subscribeToAppState } from './stateSync';

const RESUME_HINT_DISMISSED_KEY = 'dismissed_resume_search_filter_hint';
const THEME_STORAGE_KEY = 'ui_theme';
const HINT_DISMISS_ANIMATION_MS = 200;
const EDITOR_CLOSE_ANIMATION_MS = 180;
const EXTENSION_VERSION = chrome.runtime.getManifest?.().version ?? 'dev';

type Theme = 'light' | 'dark';
type Tab = 'launch' | 'profile' | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: 'play' | 'user' | 'sliders' }> = [
  { id: 'launch', label: 'Запуск', icon: 'play' },
  { id: 'profile', label: 'Профиль', icon: 'user' },
  { id: 'settings', label: 'Настройки', icon: 'sliders' },
];

const getPreferredTheme = (): Theme => (
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
);

export const deriveLaunchScreen = (
  runtimeState: string,
  hasManualActions: boolean,
): LaunchScreenName => {
  if (runtimeState === 'STARTING' || runtimeState === 'RUNNING') return 'running';
  if (runtimeState === 'PAUSED_MANUAL_ACTION' || hasManualActions) return 'review';
  if (runtimeState === 'ERROR') return 'error';
  if (runtimeState === 'IDLE') return 'start';
  return 'stopped';
};

export const formatLimitsLabel = (settings: AppState['settings']): string => {
  const runPart = settings.maxAutoAppliesPerRun > 0 ? `${settings.maxAutoAppliesPerRun} за запуск` : 'без лимита за запуск';
  const dayPart = settings.maxAutoAppliesPerDay > 0 ? `${settings.maxAutoAppliesPerDay} в день` : 'без лимита в день';
  return `${runPart} · пауза ${settings.delayMinSeconds}–${settings.delayMaxSeconds} с · ${dayPart}`;
};

const SESSION_BLOCKERS: Record<string, { title: string; text: string }> = {
  login_required: {
    title: 'Требуется вход в HH',
    text: 'Сессия закончилась. Откройте hh.ru, войдите в аккаунт и повторите запуск.',
  },
  captcha_required: {
    title: 'HH просит подтверждение',
    text: 'Пройдите проверку на сайте HH, затем вернитесь в панель.',
  },
};

export const App: React.FC = () => {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>('launch');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [isEditorClosing, setIsEditorClosing] = useState(false);
  const editorCloseTimerRef = useRef<number>();
  const [logsViewerOpen, setLogsViewerOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(getPreferredTheme);
  const [isResumeHintHighlighted, setIsResumeHintHighlighted] = useState(true);
  const [isResumeHintDismissing, setIsResumeHintDismissing] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToAppState(chrome.runtime, setState);
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
    setTab('profile');
    window.clearTimeout(editorCloseTimerRef.current);
    setIsEditorClosing(false);
    setEditingProfileId(profileId);
  };

  const closeProfileEditor = () => {
    setIsEditorClosing(true);
    editorCloseTimerRef.current = window.setTimeout(() => {
      setEditingProfileId(null);
      setIsEditorClosing(false);
    }, EDITOR_CLOSE_ANIMATION_MS);
  };

  useEffect(() => () => window.clearTimeout(editorCloseTimerRef.current), []);

  if (!state) {
    return (
      <div className="app loading" data-theme={theme}>
        <div className="spinner"><span aria-hidden="true" />Загрузка…</div>
      </div>
    );
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
  const busy = runtimeVm.runtimeState === 'RUNNING' || runtimeVm.runtimeState === 'STARTING';
  const selectedResumeAvailable = isSelectedResumeAvailable(state);
  const launchScreen = deriveLaunchScreen(runtimeVm.runtimeState, manualActions.length > 0);
  const sessionBlocker = SESSION_BLOCKERS[state.sessionStatus] ?? null;
  const profileOptions = [
    { value: '', label: 'Профиль не выбран' },
    ...profileVm.profiles.map((profile) => ({ value: profile.id, label: profile.name })),
  ];
  const resumeOptions = [
    { value: '', label: 'Резюме не выбрано' },
    ...resumeVm.candidates.map((resume) => ({ value: resume.hash, label: formatResumeLabel(resume) })),
  ];

  const handleStart = () => {
    setStartError(null);
    chrome.runtime.sendMessage({ type: 'AUTO_APPLY_START' }, (response?: AutoApplyStartResult) => {
      const error = chrome.runtime.lastError?.message || (response && !response.success ? response.error : null);
      if (error) setStartError(`Не удалось запустить автоотклики: ${error}`);
    });
  };
  const handleStop = () => chrome.runtime.sendMessage({ type: 'AUTO_APPLY_STOP' });
  const handleModeChange = (mode: 'backend' | 'live') => chrome.runtime.sendMessage({ type: 'SET_MODE', mode });
  const dismissResumeHint = () => {
    setIsResumeHintDismissing(true);
    void chrome.storage.local.set({ [RESUME_HINT_DISMISSED_KEY]: true });
    window.setTimeout(() => {
      setIsResumeHintHighlighted(false);
      setIsResumeHintDismissing(false);
    }, HINT_DISMISS_ANIMATION_MS);
  };

  const goProfile = () => setTab('profile');

  return (
    <div className="app" data-theme={theme}>
      <header className="header">
        <div className="brand">
          <span className="brand-mark"><AppMark /></span>
          <span className="brand-copy">
            <span className="brand-title-row"><h1>HH Orbit</h1><span className="version">v{EXTENSION_VERSION}</span></span>
            <small>Навигация по вакансиям</small>
          </span>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="icon-button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
            aria-pressed={theme === 'dark'}
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button type="button" className="icon-button" onClick={() => setLogsViewerOpen(true)} aria-label="Открыть журнал событий" title="Журнал">
            <Icon name="terminal" />
          </button>
        </div>
      </header>

      <main className="main" id="main">
        {tab === 'launch' && (
          <>
            {sessionBlocker && (
              <div className="attention session-blocker" role="alert">
                <span className="attention-badge"><Icon name="alert" /></span>
                <div>
                  <b>{sessionBlocker.title}</b>
                  <span>{sessionBlocker.text}</span>
                </div>
              </div>
            )}
            <LaunchScreen
              screen={launchScreen}
              runtime={{
                runtimeState: runtimeVm.runtimeState,
                phaseLabel: runtimeVm.phaseLabel,
                processed: runtimeVm.processed,
                success: runtimeVm.success,
                manualActions: runtimeVm.manualActions,
                pausedReason: runtimeVm.pausedReason,
                canStart: runtimeVm.canStart,
                canStop: runtimeVm.canStop,
              }}
              todaySuccess={todaySuccess}
              manualActions={manualActions}
              readiness={{
                profileDone: Boolean(profileVm.activeProfileId),
                resumeDone: selectedResumeAvailable,
                profileName: profileVm.activeProfile?.name ?? null,
                resumeLabel: resumeVm.selectedResume ? formatResumeLabel(resumeVm.selectedResume) : null,
              }}
              limitsLabel={formatLimitsLabel(controlsVm.settings)}
              mode={state.mode}
              startError={startError}
              lastError={state.lastRuntimeError}
              busy={busy}
              onStart={handleStart}
              onStop={handleStop}
              onGoToProfile={goProfile}
              onGoToSettings={() => setTab('settings')}
              onOpenLogs={() => setLogsViewerOpen(true)}
              onOpenAction={(url) => url && chrome.tabs.create({ url, active: true })}
              onDoneAction={(id) => chrome.runtime.sendMessage({ type: 'MANUAL_ACTION_DONE', id })}
              onDismissAction={(id) => chrome.runtime.sendMessage({ type: 'MANUAL_ACTION_DISMISS', id })}
              onPrepareAI={state.mode === 'backend'
                ? (id) => chrome.runtime.sendMessage({ type: 'QUESTIONNAIRE_PREPARE_MANUAL', actionId: id })
                : undefined}
            />
          </>
        )}

        {tab === 'profile' && (
          <>
            <section className="screen" aria-labelledby="screen-title">
              <p className="eyebrow">Основа запуска</p>
              <h2 id="screen-title">Профиль и резюме</h2>
              <p className="intro">Профиль фильтрует вакансии, резюме прикладывается к откликам.</p>

              <div className="field-card">
                <div className="field-row">
                  <label className="field-label" htmlFor="active-profile">Профиль</label>
                  <SelectMenu
                    id="active-profile"
                    value={profileVm.activeProfileId || ''}
                    options={profileOptions}
                    placeholder="Профиль не выбран"
                    onChange={(value) => chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PROFILE', id: value || null })}
                  />
                </div>
                <div className="profile-utilities">
                  <button type="button" className="text-action" onClick={() => openProfileEditor('__new__')}>Создать</button>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => profileVm.activeProfileId && chrome.runtime.sendMessage({ type: 'DUPLICATE_PROFILE', id: profileVm.activeProfileId })}
                    disabled={!profileVm.activeProfileId}
                  >
                    Дублировать
                  </button>
                  <button
                    type="button"
                    className="text-action danger-text"
                    onClick={() => {
                      if (profileVm.activeProfileId && window.confirm('Удалить профиль? Это действие нельзя отменить.')) {
                        chrome.runtime.sendMessage({ type: 'DELETE_PROFILE', id: profileVm.activeProfileId });
                      }
                    }}
                    disabled={!profileVm.activeProfileId}
                  >
                    Удалить
                  </button>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => profileVm.activeProfileId && openProfileEditor(profileVm.activeProfileId)}
                    disabled={!profileVm.activeProfileId}
                  >
                    Редактировать
                  </button>
                </div>
              </div>

              {editingProfileId && (
                <section className={`field-card editor-card${isEditorClosing ? ' is-closing' : ''}`} aria-label="Редактор профиля">
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

              <div className="field-card">
                <div className="field-row">
                  <label className="field-label" htmlFor="selected-resume">Резюме</label>
                  <div className="field-row-controls">
                    <SelectMenu
                      id="selected-resume"
                      value={resumeVm.selectedResumeHash || ''}
                      options={resumeOptions}
                      placeholder="Резюме не выбрано"
                      onChange={(value) => chrome.runtime.sendMessage({ type: 'SELECT_RESUME', hash: value || null })}
                    />
                    <button
                      type="button"
                      className="icon-button compact"
                      onClick={() => chrome.runtime.sendMessage({ type: 'REFRESH_RESUMES_API' })}
                      aria-label="Обновить резюме из HH"
                      title="Обновить резюме"
                    >
                      <Icon name="refresh" />
                    </button>
                  </div>
                </div>
                <div className={isResumeHintHighlighted ? `form-hint highlight-hint dismissible-hint${isResumeHintDismissing ? ' is-dismissing' : ''}` : 'form-hint'}>
                  Если выбрать резюме, HH будет учитывать его как фильтр при поиске вакансий.
                  {isResumeHintHighlighted && (
                    <button type="button" className="hint-dismiss-button" aria-label="Снять выделение подсказки" onClick={dismissResumeHint} disabled={isResumeHintDismissing}>×</button>
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        {tab === 'settings' && (
          <section className="screen" aria-labelledby="screen-title">
            <p className="eyebrow">Параметры</p>
            <h2 id="screen-title">Настройки</h2>
            <p className="intro">Режим работы и ограничения запуска.</p>

            <div className="field-card">
              <h3 className="field-card-title">Режим работы</h3>
              <div className="segmented-control" role="radiogroup" aria-label="Режим работы">
                <label className={state.mode === 'backend' ? 'active' : ''}>
                  <input type="radio" name="mode" value="backend" checked={state.mode === 'backend'} onChange={() => handleModeChange('backend')} disabled={busy} />
                  В фоне
                </label>
                <label className={state.mode === 'live' ? 'active' : ''}>
                  <input type="radio" name="mode" value="live" checked={state.mode === 'live'} onChange={() => handleModeChange('live')} disabled={busy} />
                  В браузере
                </label>
              </div>
              <p className="field-note">{state.mode === 'backend'
                ? 'Поиск и отклики идут через HH API, без управления вкладкой.'
                : 'Действия выполняются в реальной вкладке HH и видны вам.'}</p>
            </div>

            <div className="field-card">
              <h3 className="field-card-title">Ограничения запуска</h3>
              <RuntimeSettingsPanel settings={controlsVm.settings} onPatch={(patch) => chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', patch })} />
            </div>

            {state.mode === 'backend' && (
              <div className="field-card">
                <h3 className="field-card-title">Анкеты и AI</h3>
                <QuestionnairePanel
                  state={state.questionnaires}
                  selectedResume={resumeVm.selectedResume}
                  manualQuestionnaireCount={backendQuestionnaireActions.length}
                  onPatch={(patch) => chrome.runtime.sendMessage({ type: 'UPDATE_QUESTIONNAIRE_SETTINGS', patch })}
                />
              </div>
            )}
          </section>
        )}

      </main>

      <nav className="footer-nav" aria-label="Разделы панели">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="footer-nav-item"
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} />
            {item.label}
            {item.id === 'launch' && manualActions.length > 0 && (
              <span className="nav-badge" aria-label={`${manualActions.length} ручных действий`}>{manualActions.length}</span>
            )}
          </button>
        ))}
      </nav>

      {logsViewerOpen && <LogsViewer onClose={() => setLogsViewerOpen(false)} />}
    </div>
  );
};
