import React from 'react';
import { AppState } from '../state/types';

interface RuntimeControlsProps {
  state: AppState;
}

export const RuntimeControls: React.FC<RuntimeControlsProps> = ({ state }) => {
  const handleStart = () => {
    chrome.runtime.sendMessage({ type: 'DISPATCH_EVENT', event: 'START_REQUESTED' });
  };

  const handleStop = () => {
    chrome.runtime.sendMessage({ type: 'DISPATCH_EVENT', event: 'STOP_REQUESTED' });
  };

  const handlePause = () => {
    chrome.runtime.sendMessage({ type: 'DISPATCH_EVENT', event: 'PAUSE_BY_USER' });
  };

  const handleResume = () => {
    chrome.runtime.sendMessage({ type: 'DISPATCH_EVENT', event: 'RESUME_REQUESTED' });
  };

  const handleReset = () => {
    chrome.runtime.sendMessage({ type: 'DISPATCH_EVENT', event: 'RESET' });
  };

  const canStart = state.runtimeState === 'IDLE' || state.runtimeState === 'STOPPED';
  const canStop =
    state.runtimeState === 'RUNNING' ||
    state.runtimeState.startsWith('PAUSED');
  const canPause = state.runtimeState === 'RUNNING';
  const canResume = state.runtimeState.startsWith('PAUSED');
  const canReset = state.runtimeState === 'ERROR' || state.runtimeState === 'STOPPED';

  return (
    <div className="controls">
      <button
        className="btn btn-primary"
        onClick={handleStart}
        disabled={!canStart}
      >
        Запустить
      </button>

      <button
        className="btn btn-secondary"
        onClick={handlePause}
        disabled={!canPause}
      >
        Пауза
      </button>

      <button
        className="btn btn-primary"
        onClick={handleResume}
        disabled={!canResume}
      >
        Продолжить
      </button>

      <button
        className="btn btn-danger"
        onClick={handleStop}
        disabled={!canStop}
      >
        Остановить
      </button>

      <button
        className="btn btn-secondary"
        onClick={handleReset}
        disabled={!canReset}
      >
        Сброс
      </button>
    </div>
  );
};
