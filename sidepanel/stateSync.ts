import type { AppState } from '../src/state/types';

type StateUpdateMessage = { type: 'STATE_UPDATE'; state: AppState };
type StateMessageListener = (message: unknown) => void;

export interface StateSyncRuntime {
  sendMessage(
    message: { type: 'GET_STATE' },
    callback: (response?: { state?: AppState }) => void
  ): void;
  onMessage: {
    addListener(listener: StateMessageListener): void;
    removeListener(listener: StateMessageListener): void;
  };
}

function isStateUpdate(message: unknown): message is StateUpdateMessage {
  return Boolean(
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'STATE_UPDATE' &&
    'state' in message &&
    typeof message.state === 'object' &&
    message.state !== null
  );
}

export function subscribeToAppState(
  runtime: StateSyncRuntime,
  onState: (state: AppState) => void
): () => void {
  let active = true;
  let updateGeneration = 0;

  const listener: StateMessageListener = (message) => {
    if (!active || !isStateUpdate(message)) return;
    updateGeneration += 1;
    onState(message.state);
  };

  runtime.onMessage.addListener(listener);
  const initialGeneration = updateGeneration;
  runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
    if (!active || updateGeneration !== initialGeneration || !response?.state) return;
    onState(response.state);
  });

  return () => {
    active = false;
    runtime.onMessage.removeListener(listener);
  };
}
