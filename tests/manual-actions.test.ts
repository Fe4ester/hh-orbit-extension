import { describe, it, expect, beforeEach } from 'vitest';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';

describe('Manual Actions', () => {
  let store: StateStore;

  beforeEach(async () => {
    store = new StateStore(new InMemoryStorageAdapter());
    await store.init();
  });

  describe('createManualAction', () => {
    it('creates manual action with generated id and timestamp', async () => {
      await store.createManualAction({
        type: 'questionnaire',
        vacancyId: 'v123',
        vacancyTitle: 'Test Vacancy',
        company: 'Test Company',
        url: 'https://hh.ru/vacancy/123',
        profileId: 'p1',
        status: 'pending',
        reasonCode: 'questionnaire_required',
      });

      const state = store.getState();
      expect(state.manualActions).toHaveLength(1);
      expect(state.manualActions[0].id).toMatch(/^ma_/);
      expect(state.manualActions[0].type).toBe('questionnaire');
      expect(state.manualActions[0].status).toBe('pending');
      expect(state.manualActions[0].createdAt).toBeGreaterThan(0);
    });

    it('stores manual action details', async () => {
      await store.createManualAction({
        type: 'test',
        vacancyId: 'v456',
        vacancyTitle: 'Senior Developer',
        company: 'Tech Corp',
        url: 'https://hh.ru/vacancy/456',
        profileId: 'p2',
        status: 'pending',
        reasonCode: 'test_required',
        details: {
          testType: 'coding',
          duration: '60min',
        },
      });

      const state = store.getState();
      const action = state.manualActions[0];
      expect(action.vacancyTitle).toBe('Senior Developer');
      expect(action.company).toBe('Tech Corp');
      expect(action.details?.testType).toBe('coding');
    });
  });

  describe('markManualActionDone', () => {
    it('marks action as done', async () => {
      await store.createManualAction({
        type: 'questionnaire',
        vacancyId: 'v123',
        status: 'pending',
        reasonCode: 'questionnaire_required',
      });

      const state1 = store.getState();
      const actionId = state1.manualActions[0].id;

      await store.markManualActionDone(actionId);

      const state2 = store.getState();
      expect(state2.manualActions[0].status).toBe('done');
    });
  });

  describe('dismissManualAction', () => {
    it('marks action as dismissed', async () => {
      await store.createManualAction({
        type: 'questionnaire',
        vacancyId: 'v123',
        status: 'pending',
        reasonCode: 'questionnaire_required',
      });

      const state1 = store.getState();
      const actionId = state1.manualActions[0].id;

      await store.dismissManualAction(actionId);

      const state2 = store.getState();
      expect(state2.manualActions[0].status).toBe('dismissed');
    });
  });

  describe('clearCompletedManualActions', () => {
    it('removes done and dismissed actions', async () => {
      await store.createManualAction({
        type: 'questionnaire',
        vacancyId: 'v1',
        status: 'pending',
        reasonCode: 'questionnaire_required',
      });

      await store.createManualAction({
        type: 'test',
        vacancyId: 'v2',
        status: 'pending',
        reasonCode: 'test_required',
      });

      await store.createManualAction({
        type: 'login_required',
        vacancyId: 'v3',
        status: 'pending',
        reasonCode: 'login_required',
      });

      const state1 = store.getState();
      await store.markManualActionDone(state1.manualActions[0].id);
      await store.dismissManualAction(state1.manualActions[1].id);

      await store.clearCompletedManualActions();

      const state2 = store.getState();
      expect(state2.manualActions).toHaveLength(1);
      expect(state2.manualActions[0].status).toBe('pending');
      expect(state2.manualActions[0].type).toBe('login_required');
    });

    it('keeps pending actions', async () => {
      await store.createManualAction({
        type: 'questionnaire',
        vacancyId: 'v1',
        status: 'pending',
        reasonCode: 'questionnaire_required',
      });

      await store.clearCompletedManualActions();

      const state = store.getState();
      expect(state.manualActions).toHaveLength(1);
    });
  });
});
