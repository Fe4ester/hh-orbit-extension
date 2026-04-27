import { describe, it, expect, beforeEach } from 'vitest';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';

describe('Runtime settings', () => {
  let store: StateStore;

  beforeEach(async () => {
    store = new StateStore(new InMemoryStorageAdapter());
    await store.init();
  });

  it('persists delay and limits settings', async () => {
    await store.updateSettings({
      delayMinSeconds: 11,
      delayMaxSeconds: 22,
      maxAutoAppliesPerRun: 5,
      maxAutoAppliesPerDay: 55,
      stopOnManualAction: false,
      autoSendCoverLetterWhenRequired: false,
    });

    const state = store.getState();
    expect(state.settings.delayMinSeconds).toBe(11);
    expect(state.settings.delayMaxSeconds).toBe(22);
    expect(state.settings.maxAutoAppliesPerRun).toBe(5);
    expect(state.settings.maxAutoAppliesPerDay).toBe(55);
    expect(state.settings.stopOnManualAction).toBe(false);
    expect(state.settings.autoSendCoverLetterWhenRequired).toBe(false);
  });
});
