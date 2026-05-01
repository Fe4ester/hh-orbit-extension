import React, { useEffect, useState } from 'react';
import { AppState, AutoApplyMode } from '../src/state/types';
import {
  getPrimaryControlsState,
  getPrimaryProfileViewModel,
  getPrimaryResumeViewModel,
  getPrimaryRuntimeStatusViewModel,
  getUserFacingManualActions,
} from '../src/state/selectors';
import { RuntimeSettingsPanel } from '../src/components/RuntimeSettingsPanel';
import { ManualActionsPanel } from '../src/components/ManualActionsPanel';
import { ProfileEditor } from '../src/components/ProfileEditor';
import './styles.css';

export const App: React.FC = () => {
  const [state, setState] = useState<AppState | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);

  useEffect(() => {
    console.log('[Sidepanel] Component mounted, setting up listeners');

    // Initial fetch
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      console.log('[Sidepanel] GET_STATE response', {
        hasState: !!response?.state,
        processed: response?.state?.runtime?.processed,
        success: response?.state?.runtime?.success,
      });
      if (response?.state) {
        setState(response.state);
      }
    });

    // Polling every 500ms for real-time updates
    const pollInterval = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
        if (response?.state) {
          console.log('[Sidepanel] Poll update', {
            processed: response.state.runtime.processed,
            success: response.state.runtime.success,
            manualActions: response.state.runtime.manualActions,
          });
          setState(response.state);
        }
      });
    }, 500);

    // Message listener (for instant updates when available)
    const listener = (message: any) => {
      console.log('[Sidepanel] Message received', { type: message.type });

      if (message.type === 'STATE_UPDATE') {
        console.log('[Sidepanel] STATE_UPDATE', {
          processed: message.state.runtime.processed,
          success: message.state.runtime.success,
          manualActions: message.state.runtime.manualActions,
        });
        setState(message.state);
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
      console.log('[Sidepanel] Component unmounting');
      clearInterval(pollInterval);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  if (!state) {
    return <div className="app loading"><div className="spinner">Загрузка...</div></div>;
  }

  console.log('[Sidepanel] Rendering with state', {
    processed: state?.runtime?.processed,
    success: state?.runtime?.success,
    manualActions: state?.runtime?.manualActions,
    runtimeState: state?.runtimeState,
  });

  const runtimeVm = getPrimaryRuntimeStatusViewModel(state);
  const resumeVm = getPrimaryResumeViewModel(state);
  const profileVm = getPrimaryProfileViewModel(state);
  const controlsVm = getPrimaryControlsState(state);
  const manualActions = getUserFacingManualActions(state);
  const editingProfile = editingProfileId ? state.profiles[editingProfileId] : undefined;

  const handleStart = () => chrome.runtime.sendMessage({ type: 'AUTO_APPLY_START' });
  const handleStop = () => chrome.runtime.sendMessage({ type: 'AUTO_APPLY_STOP' });
  const handleModeChange = (mode: AutoApplyMode) => chrome.runtime.sendMessage({ type: 'SET_MODE', mode });

  return (
    <div className="app">
      <header className="header">
        <h1>HH Orbit</h1>
        <div className="version">v1.0.0</div>
      </header>

      <main className="main">
        <section className="section">
          <h2>Режим работы</h2>
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="mode"
                value="backend"
                checked={state.mode === 'backend'}
                onChange={() => handleModeChange('backend')}
                disabled={runtimeVm.runtimeState === 'RUNNING'}
              />
              <div>
                <strong>Backend</strong>
                <div style={{ fontSize: 12, color: '#666' }}>Скрытые вкладки, только счётчики</div>
              </div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="mode"
                value="live"
                checked={state.mode === 'live'}
                onChange={() => handleModeChange('live')}
                disabled={runtimeVm.runtimeState === 'RUNNING'}
              />
              <div>
                <strong>Live</strong>
                <div style={{ fontSize: 12, color: '#666' }}>Видимые вкладки, весь процесс</div>
              </div>
            </label>
          </div>
        </section>
        <section className="section">
          <h2>Резюме</h2>
          <select
            className="resume-select"
            value={resumeVm.selectedResumeHash || ''}
            onChange={(e) => chrome.runtime.sendMessage({ type: 'SELECT_RESUME', hash: e.target.value || null })}
          >
            <option value="">Резюме не выбрано</option>
            {resumeVm.candidates.map((resume) => (
              <option key={resume.hash} value={resume.hash}>{resume.title}</option>
            ))}
          </select>
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-secondary" onClick={() => chrome.runtime.sendMessage({ type: 'REFRESH_RESUMES_API' })}>
              Обновить резюме из HH
            </button>
          </div>
        </section>

        <section className="section">
          <h2>Профиль</h2>
          <select
            className="resume-select"
            value={profileVm.activeProfileId || ''}
            onChange={(e) => chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PROFILE', id: e.target.value || null })}
          >
            <option value="">Профиль не выбран</option>
            {profileVm.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setEditingProfileId('__new__')}
            >
              Создать профиль
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setEditingProfileId(profileVm.activeProfileId)}
              disabled={!profileVm.activeProfileId}
            >
              Редактировать
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (profileVm.activeProfileId) {
                  chrome.runtime.sendMessage({ type: 'DUPLICATE_PROFILE', id: profileVm.activeProfileId });
                }
              }}
              disabled={!profileVm.activeProfileId}
            >
              Дублировать
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (profileVm.activeProfileId && confirm('Удалить профиль? Это действие нельзя отменить.')) {
                  chrome.runtime.sendMessage({ type: 'DELETE_PROFILE', id: profileVm.activeProfileId });
                }
              }}
              disabled={!profileVm.activeProfileId}
            >
              Удалить
            </button>
          </div>
          {editingProfileId && (
            <div style={{ marginTop: 12 }}>
              <ProfileEditor
                profile={editingProfileId === '__new__' ? undefined : editingProfile}
                resumeCandidates={state.resumeCandidates}
                onSave={(payload) => {
                  chrome.runtime.sendMessage({ type: 'CREATE_PROFILE', payload }, () => setEditingProfileId(null));
                }}
                onUpdate={(payload) => {
                  if (editingProfile) {
                    chrome.runtime.sendMessage({ type: 'UPDATE_PROFILE', id: editingProfile.id, payload }, () => setEditingProfileId(null));
                  }
                }}
                onCancel={() => setEditingProfileId(null)}
              />
            </div>
          )}
        </section>

        <section className="section">
          <h2>Настройки запуска</h2>
          <RuntimeSettingsPanel
            settings={controlsVm.settings}
            onPatch={(patch) => chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', patch })}
          />
        </section>

        <section className="section">
          <h2>Управление</h2>
          <div className="controls">
            <button className="btn btn-primary" onClick={handleStart} disabled={!controlsVm.canStart}>Запустить автоотклики</button>
            <button className="btn btn-danger" onClick={handleStop} disabled={!controlsVm.canStop}>Остановить</button>
          </div>
        </section>

        <section className="section">
          <h2>Статус рантайма</h2>
          <div className="status-card">
            <div className="status-indicator" data-state={runtimeVm.runtimeState}>{runtimeVm.phaseLabel}</div>
            <div className="stat-row"><span>Обработано</span><strong>{runtimeVm.processed}</strong></div>
            <div className="stat-row"><span>Успех</span><strong>{runtimeVm.success}</strong></div>
            <div className="stat-row"><span>manual actions</span><strong>{runtimeVm.manualActions}</strong></div>
          </div>
        </section>

        <section className="section">
          <h2>Ручные действия</h2>
          <ManualActionsPanel
            actions={manualActions}
            onOpen={(url) => url && chrome.tabs.create({ url, active: true })}
            onDone={(id) => chrome.runtime.sendMessage({ type: 'MANUAL_ACTION_DONE', id })}
            onDismiss={(id) => chrome.runtime.sendMessage({ type: 'MANUAL_ACTION_DISMISS', id })}
            onClearCompleted={() => chrome.runtime.sendMessage({ type: 'MANUAL_ACTION_CLEAR_COMPLETED' })}
          />
        </section>
      </main>
    </div>
  );
};
