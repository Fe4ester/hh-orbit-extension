import { t, useLanguage, setLanguage, LANGUAGE_STORAGE_KEY } from '../src/i18n';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { ManualActionsPanel } from '../src/components/ManualActionsPanel';
import { QuestionnairePanel } from '../src/components/QuestionnairePanel';
import { selectPendingManualQuestionnaires } from '../src/questionnaires';
import { ProfileEditor } from '../src/components/ProfileEditor';
import { SelectMenu } from '../src/components/SelectMenu';
import { formatResumeLabel } from '../src/components/resumeLabel';
import { LogsViewer } from './LogsViewer';
import { LaunchScreen } from './LaunchScreen';
import type { LaunchScreenName } from './LaunchScreen';
import { AppMark } from './AppMark';
import { HeaderPrint, Icon } from './icons';
import './styles.css';
import type { AutoApplyStartResult } from '../src/background/autoApplyStart';
import { subscribeToAppState } from './stateSync';

const RESUME_HINT_DISMISSED_KEY = 'dismissed_resume_search_filter_hint';
const THEME_STORAGE_KEY = 'ui_theme';
const HINT_DISMISS_ANIMATION_MS = 200;
const EDITOR_CLOSE_ANIMATION_MS = 180;
const EXTENSION_VERSION = chrome.runtime.getManifest?.().version ?? 'dev';

type Theme = 'light' | 'dark';
type Tab = 'launch' | 'questionnaires' | 'profile' | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: 'play' | 'file-question' | 'user' | 'sliders' }> = [
  { id: 'launch', label: 'Запуск', icon: 'play' },
  { id: 'questionnaires', label: 'Анкеты', icon: 'file-question' },
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
  const runPart = settings.maxAutoAppliesPerRun > 0 ? t("{0} за запуск", settings.maxAutoAppliesPerRun) : t("без лимита за запуск");
  const dayPart = settings.maxAutoAppliesPerDay > 0 ? t("{0} в день", settings.maxAutoAppliesPerDay) : t("без лимита в день");
  return t("{0} · пауза {1}–{2} с · {3}", runPart, settings.delayMinSeconds, settings.delayMaxSeconds, dayPart);
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
  const language = useLanguage();
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>('launch');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [pendingProfileDeleteId, setPendingProfileDeleteId] = useState<string | null>(null);
  const [isEditorClosing, setIsEditorClosing] = useState(false);
  const editorCloseTimerRef = useRef<number>();
  const [logsViewerOpen, setLogsViewerOpen] = useState(false);
  const closeLogs = useCallback(() => setLogsViewerOpen(false), []);
  const [theme, setTheme] = useState<Theme>(getPreferredTheme);
  const [isResumeHintHighlighted, setIsResumeHintHighlighted] = useState(true);
  const [isResumeHintDismissing, setIsResumeHintDismissing] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToAppState(chrome.runtime, setState);
  }, []);

  useEffect(() => {
    const restorePreferences = async () => {
      const stored = await chrome.storage.local.get([RESUME_HINT_DISMISSED_KEY, THEME_STORAGE_KEY, LANGUAGE_STORAGE_KEY]);
      if (stored[LANGUAGE_STORAGE_KEY] === 'ru' || stored[LANGUAGE_STORAGE_KEY] === 'en') setLanguage(stored[LANGUAGE_STORAGE_KEY]);
      if (stored[RESUME_HINT_DISMISSED_KEY] === true) setIsResumeHintHighlighted(false);
      if (stored[THEME_STORAGE_KEY] === 'light' || stored[THEME_STORAGE_KEY] === 'dark') {
        setTheme(stored[THEME_STORAGE_KEY]);
      }
    };

    void restorePreferences();
  }, []);

  useEffect(() => { document.documentElement.lang = language; }, [language]);

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
        <div className="spinner"><span aria-hidden="true" />{t("Загрузка…")}</div>
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
  const questionnaireActionCount = state.questionnaires.queue.filter(queueItem =>
    ['detected', 'ready_for_ai', 'failed', 'needs_review', 'approved'].includes(queueItem.status)
  ).length;
  const preparedQuestionnaireActionIds = state.questionnaires.queue
    .map(item => item.manualActionId)
    .filter((id): id is string => Boolean(id));
  const todaySuccess = getTodayLocalApplyStats(state).succeeded;
  const editingProfile = editingProfileId ? state.profiles[editingProfileId] : undefined;
  const busy = runtimeVm.runtimeState === 'RUNNING' || runtimeVm.runtimeState === 'STARTING';
  const selectedResumeAvailable = isSelectedResumeAvailable(state);
  const launchScreen = deriveLaunchScreen(runtimeVm.runtimeState, manualActions.length > 0);
  const sessionBlocker = SESSION_BLOCKERS[state.sessionStatus] ?? null;
  const profileOptions = [
    { value: '', label: t("Профиль не выбран") },
    ...profileVm.profiles.map((profile) => ({ value: profile.id, label: profile.name })),
  ];
  const resumeOptions = [
    { value: '', label: t("Резюме не выбрано") },
    ...resumeVm.candidates.map((resume) => ({ value: resume.hash, label: formatResumeLabel(resume) })),
  ];

  const handleStart = () => {
    setStartError(null);
    chrome.runtime.sendMessage({ type: 'AUTO_APPLY_START' }, (response?: AutoApplyStartResult) => {
      const error = chrome.runtime.lastError?.message || (response && !response.success ? response.error : null);
      if (error) setStartError(t("Не удалось запустить автоотклики: {0}", error));
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
  const openQuestionnaireDraft = async (actionId: string, withAI: boolean) => {
    const response = await chrome.runtime.sendMessage({
      type: withAI ? 'QUESTIONNAIRE_PREPARE_MANUAL' : 'QUESTIONNAIRE_PREPARE_MANUAL_DRAFT',
      actionId,
    }) as { success?: boolean; error?: string };
    if (!response?.error) setTab('questionnaires');
    return response;
  };

  return (
    <div className="app" data-theme={theme}>
      <header className="header">
        <HeaderPrint />
        <div className="brand">
          <AppMark accessibleLabel={t("Показать скрытую анимацию HH Orbit")} />
          <span className="brand-copy">
            <span className="brand-title-row"><h1>HH Orbit</h1><span className="version">v{EXTENSION_VERSION}</span></span>
            <small>{t("Навигация по вакансиям")}</small>
          </span>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="icon-button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t("Включить светлую тему") : t("Включить тёмную тему")}
            aria-pressed={theme === 'dark'}
            title={theme === 'dark' ? t("Светлая тема") : t("Тёмная тема")}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
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
                  <b>{t(sessionBlocker.title)}</b>
                  <span>{t(sessionBlocker.text)}</span>
                </div>
              </div>
            )}
            <LaunchScreen
              screen={launchScreen}
              runtime={{
                runtimeState: runtimeVm.runtimeState,
                phaseLabel: t(runtimeVm.phaseLabel),
                processed: runtimeVm.processed,
                success: runtimeVm.success,
                manualActions: runtimeVm.manualActions,
                pausedReason: runtimeVm.pausedReason,
                canStart: runtimeVm.canStart,
                canStop: runtimeVm.canStop,
              }}
              todaySuccess={todaySuccess}
              recentAttempts={[...state.applyAttempts].sort((a, b) => b.createdAt - a.createdAt)}
              vacancies={state.vacancyQueue}
              currentVacancyId={state.analytics.attempts.find(attempt => attempt.id === state.currentRun?.currentAttemptId)?.vacancyId ?? state.liveMode.detectedVacancyId}
              manualActions={manualActions}
              preparedActionIds={preparedQuestionnaireActionIds}
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
              onFillManual={state.mode === 'backend'
                ? (id) => openQuestionnaireDraft(id, false)
                : undefined}
              onPrepareAI={state.mode === 'backend'
                ? (id) => openQuestionnaireDraft(id, true)
                : undefined}
            />
          </>
        )}

        {tab === 'questionnaires' && (
          <section className="screen screen-questionnaires" aria-labelledby="questionnaires-title">
            <div className="screen-title-row">
              <div>
                <h2 id="questionnaires-title">{t("Анкеты")}</h2>
                <p className="intro">{t("Заполняйте вручную или проверяйте AI-черновики перед отправкой.")}</p>
              </div>
              <span className="beta-badge">Beta</span>
            </div>
            <button type="button" className="text-action questionnaire-settings-link" onClick={() => setTab('settings')}>
              <Icon name="sliders" />{" " + t("AI, легенда и память ответов") + " "}</button>
            {state.mode !== 'backend' && (
              <div className="questionnaire-notice" data-kind="info">{t("Переключитесь на режим \"В фоне\", чтобы заполнять и отправлять анкеты внутри расширения.") + " "}</div>
            )}
            {backendQuestionnaireActions.length > 0 && (
              <section className="questionnaire-pending" aria-label={t("Анкеты без черновика")}>
                <h3>{t("Нужно заполнить")}</h3>
                <ManualActionsPanel
                  actions={manualActions.filter(action => backendQuestionnaireActions.some(pending => pending.id === action.id))}
                  onOpen={(url) => url && chrome.tabs.create({ url, active: true })}
                  onDone={(id) => chrome.runtime.sendMessage({ type: 'MANUAL_ACTION_DONE', id })}
                  onDismiss={(id) => chrome.runtime.sendMessage({ type: 'MANUAL_ACTION_DISMISS', id })}
                  onFillManual={state.mode === 'backend' ? (id) => openQuestionnaireDraft(id, false) : undefined}
                  onPrepareAI={state.mode === 'backend' ? (id) => openQuestionnaireDraft(id, true) : undefined}
                />
              </section>
            )}
            <QuestionnairePanel
              view="workspace"
              state={state.questionnaires}
              selectedResume={resumeVm.selectedResume}
              manualQuestionnaireCount={backendQuestionnaireActions.length}
              onPatch={(patch) => chrome.runtime.sendMessage({ type: 'UPDATE_QUESTIONNAIRE_SETTINGS', patch })}
            />
          </section>
        )}

        {tab === 'profile' && (
          <>
            <section className="screen screen-profile" aria-labelledby="screen-title">
            <h2 id="screen-title">{t("Профиль и резюме")}</h2>
              <p className="intro">{t("Профиль фильтрует вакансии, резюме прикладывается к откликам.")}</p>

              <div className="field-card">
                <div className="field-row">
                  <label className="field-label" htmlFor="active-profile">{t("Профиль")}</label>
                  <SelectMenu
                    id="active-profile"
                    value={profileVm.activeProfileId || ''}
                    options={profileOptions}
                    placeholder={t("Профиль не выбран")}
                    onChange={(value) => {
                      setPendingProfileDeleteId(null);
                      chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PROFILE', id: value || null });
                    }}
                  />
                </div>
                <div className="profile-utilities">
                  <button type="button" className="text-action" onClick={() => openProfileEditor('__new__')}>{t("Создать")}</button>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => profileVm.activeProfileId && chrome.runtime.sendMessage({ type: 'DUPLICATE_PROFILE', id: profileVm.activeProfileId })}
                    disabled={!profileVm.activeProfileId}
                  >{t("Дублировать") + " "}</button>
                  <button
                    type="button"
                    className="text-action danger-text"
                    onClick={() => setPendingProfileDeleteId(profileVm.activeProfileId)}
                    disabled={!profileVm.activeProfileId}
                  >{t("Удалить") + " "}</button>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => profileVm.activeProfileId && openProfileEditor(profileVm.activeProfileId)}
                    disabled={!profileVm.activeProfileId}
                  >{t("Редактировать") + " "}</button>
                </div>
                {pendingProfileDeleteId === profileVm.activeProfileId && (
                  <div className="profile-delete-confirmation" role="alert">
                    <span>{t("Удалить профиль? Это действие нельзя отменить.")}</span>
                    <div>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => {
                          chrome.runtime.sendMessage({ type: 'DELETE_PROFILE', id: pendingProfileDeleteId });
                          setPendingProfileDeleteId(null);
                        }}
                      >{t("Удалить")}</button>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        onClick={() => setPendingProfileDeleteId(null)}
                      >{t("Отмена")}</button>
                    </div>
                  </div>
                )}
              </div>

              {editingProfileId && (
                <section className={`field-card editor-card${isEditorClosing ? ' is-closing' : ''}`} aria-label={t("Редактор профиля")}>
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
                  <label className="field-label" htmlFor="selected-resume">{t("Резюме")}</label>
                  <div className="field-row-controls">
                    <SelectMenu
                      id="selected-resume"
                      value={resumeVm.selectedResumeHash || ''}
                      options={resumeOptions}
                      placeholder={t("Резюме не выбрано")}
                      onChange={(value) => chrome.runtime.sendMessage({ type: 'SELECT_RESUME', hash: value || null })}
                    />
                    <button
                      type="button"
                      className="icon-button compact"
                      onClick={() => chrome.runtime.sendMessage({ type: 'REFRESH_RESUMES_API' })}
                      aria-label={t("Обновить резюме из HH")}
                      title={t("Обновить резюме")}
                    >
                      <Icon name="refresh" />
                    </button>
                  </div>
                </div>
                <div className={isResumeHintHighlighted ? `form-hint highlight-hint dismissible-hint${isResumeHintDismissing ? ' is-dismissing' : ''}` : 'form-hint'}>{t("Если выбрать резюме, HH будет учитывать его как фильтр при поиске вакансий.") + " "}{isResumeHintHighlighted && (
                    <button type="button" className="hint-dismiss-button" aria-label={t("Снять выделение подсказки")} onClick={dismissResumeHint} disabled={isResumeHintDismissing}>×</button>
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        {tab === 'settings' && (
          <section className="screen screen-settings" aria-labelledby="screen-title">
            <h2 id="screen-title">{t("Настройки")}</h2>
            <p className="intro">{t("Режим работы и ограничения запуска.")}</p>

            <div className="field-card settings-language">
              <h3 className="field-card-title" id="interface-language-label">{t("Язык интерфейса")}</h3>
              <div className="segmented-control" role="radiogroup" aria-labelledby="interface-language-label">
                {(['ru', 'en'] as const).map((next) => (
                  <label key={next} className={language === next ? 'active' : ''}>
                    <input type="radio" name="interface-language" value={next} checked={language === next} onChange={() => {
                      setLanguage(next);
                      void chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: next });
                    }} />
                    {next === 'ru' ? 'Русский' : 'English'}
                  </label>
                ))}
              </div>
            </div>

            <div className="field-card">
              <h3 className="field-card-title">{t("Режим работы")}</h3>
              <div className="segmented-control" role="radiogroup" aria-label={t("Режим работы")}>
                <label className={state.mode === 'backend' ? 'active' : ''}>
                  <input type="radio" name="mode" value="backend" checked={state.mode === 'backend'} onChange={() => handleModeChange('backend')} disabled={busy} />{t("В фоне") + " "}</label>
                <label className={state.mode === 'live' ? 'active' : ''}>
                  <input type="radio" name="mode" value="live" checked={state.mode === 'live'} onChange={() => handleModeChange('live')} disabled={busy} />{t("В браузере") + " "}</label>
              </div>
              <p className="field-note">{state.mode === 'backend'
                ? t("Поиск и отклики идут через HH API, без управления вкладкой.")
                : t("Действия выполняются в реальной вкладке HH и видны вам.")}</p>
            </div>

            <div className="field-card">
              <h3 className="field-card-title">{t("Ограничения запуска")}</h3>
              <RuntimeSettingsPanel settings={controlsVm.settings} onPatch={(patch) => chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', patch })} />
            </div>

            {state.mode === 'backend' && (
              <div className="field-card">
                <h3 className="field-card-title">{t("AI и контекст")}</h3>
                <QuestionnairePanel
                  view="settings"
                  state={state.questionnaires}
                  selectedResume={resumeVm.selectedResume}
                  manualQuestionnaireCount={backendQuestionnaireActions.length}
                  onPatch={(patch) => chrome.runtime.sendMessage({ type: 'UPDATE_QUESTIONNAIRE_SETTINGS', patch })}
                />
              </div>
            )}
            <div className="settings-diagnostics">
              <div>
                <h3>{t("Диагностика")}</h3>
                <p>{t("Журнал ошибок и событий. Пригодится, если что-то не работает.")}</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLogsViewerOpen(true)}>
                <Icon name="terminal" />{t("Открыть журнал")}
              </button>
            </div>
          </section>
        )}

      </main>

      <nav className="footer-nav" aria-label={t("Разделы панели")}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="footer-nav-item"
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} />
            {t(item.label)}
            {item.id === 'launch' && manualActions.length > 0 && (
              <span className="nav-badge" aria-label={t("{0} ручных действий", manualActions.length)}>{manualActions.length}</span>
            )}
            {item.id === 'questionnaires' && questionnaireActionCount + backendQuestionnaireActions.length > 0 && (
              <span className="nav-badge" aria-label={t("Анкеты на проверке")}>
                {questionnaireActionCount + backendQuestionnaireActions.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {logsViewerOpen && <LogsViewer onClose={closeLogs} />}
    </div>
  );
};
