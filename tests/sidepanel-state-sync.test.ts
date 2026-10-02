import { describe, expect, it, vi } from 'vitest';
import { subscribeToAppState } from '../sidepanel/stateSync';
import type { AppState } from '../src/state/types';

function state(runtimeState: AppState['runtimeState']): AppState {
  return { runtimeState } as AppState;
}

function createRuntimeHarness(order?: string[]) {
  let listener: ((message: unknown) => void) | undefined;
  let initialResponse: ((response?: { state?: AppState }) => void) | undefined;
  const runtime = {
    sendMessage: vi.fn((_message: unknown, callback: (response?: { state?: AppState }) => void) => {
      order?.push('snapshot');
      initialResponse = callback;
    }),
    onMessage: {
      addListener: vi.fn((nextListener: (message: unknown) => void) => {
        order?.push('listen');
        listener = nextListener;
      }),
      removeListener: vi.fn(),
    },
  };

  return {
    runtime,
    getListener: () => listener,
    respond: (response?: { state?: AppState }) => initialResponse?.(response),
  };
}

describe('subscribeToAppState', () => {
  it('registers the listener before requesting the initial snapshot', () => {
    const order: string[] = [];
    const harness = createRuntimeHarness(order);

    subscribeToAppState(harness.runtime, vi.fn());

    expect(order).toEqual(['listen', 'snapshot']);
  });

  it('applies the initial snapshot when no push arrived', () => {
    const harness = createRuntimeHarness();
    const onState = vi.fn();
    subscribeToAppState(harness.runtime, onState);

    harness.respond({ state: state('IDLE') });

    expect(onState).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenCalledWith(state('IDLE'));
  });

  it('applies a STATE_UPDATE received before the initial response', () => {
    const harness = createRuntimeHarness();
    const onState = vi.fn();
    subscribeToAppState(harness.runtime, onState);

    harness.getListener()?.({ type: 'STATE_UPDATE', state: state('RUNNING') });

    expect(onState).toHaveBeenCalledWith(state('RUNNING'));
  });

  it('does not let a late initial response overwrite a newer push', () => {
    const harness = createRuntimeHarness();
    const onState = vi.fn();
    subscribeToAppState(harness.runtime, onState);

    harness.getListener()?.({ type: 'STATE_UPDATE', state: state('RUNNING') });
    harness.respond({ state: state('IDLE') });

    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenLastCalledWith(state('RUNNING'));
  });

  it('removes the listener and ignores pending callbacks after cleanup', () => {
    const harness = createRuntimeHarness();
    const onState = vi.fn();
    const unsubscribe = subscribeToAppState(harness.runtime, onState);
    const listener = harness.getListener();

    unsubscribe();
    harness.respond({ state: state('IDLE') });
    listener?.({ type: 'STATE_UPDATE', state: state('RUNNING') });

    expect(harness.runtime.onMessage.removeListener).toHaveBeenCalledWith(listener);
    expect(onState).not.toHaveBeenCalled();
  });

  it('creates an independent snapshot lifecycle after remount', () => {
    const first = createRuntimeHarness();
    const second = createRuntimeHarness();
    const onState = vi.fn();

    const unmount = subscribeToAppState(first.runtime, onState);
    unmount();
    subscribeToAppState(second.runtime, onState);
    first.respond({ state: state('IDLE') });
    second.respond({ state: state('STOPPED') });

    expect(onState).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenCalledWith(state('STOPPED'));
  });
});
