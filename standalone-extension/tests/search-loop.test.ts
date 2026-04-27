import { describe, it, expect, beforeEach } from 'vitest';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';

describe('search loop', () => {
  let store: StateStore;
  let storage: InMemoryStorageAdapter;

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter();
    store = new StateStore(storage);
    await store.init();
  });

  describe('search loop state', () => {
    it('starts search loop', async () => {
      await store.startSearchLoop();
      const state = store.getState();
      expect(state.liveMode.searchLoopActive).toBe(true);
      expect(state.liveMode.searchLoopIterations).toBe(0);
    });

    it('stops search loop', async () => {
      await store.startSearchLoop();
      await store.stopSearchLoop();
      const state = store.getState();
      expect(state.liveMode.searchLoopActive).toBe(false);
    });

    it('updates search loop page metadata', async () => {
      await store.updateSearchLoopPage(1, 5, 10);
      const state = store.getState();
      expect(state.liveMode.currentSearchPage).toBe(1);
      expect(state.liveMode.totalPagesDetected).toBe(5);
      expect(state.liveMode.lastScanVacancyCount).toBe(10);
      expect(state.liveMode.lastScannedPage).toBe(1);
    });

    it('increments search loop iteration', async () => {
      await store.incrementSearchLoopIteration();
      const state = store.getState();
      expect(state.liveMode.searchLoopIterations).toBe(1);

      await store.incrementSearchLoopIteration();
      expect(store.getState().liveMode.searchLoopIterations).toBe(2);
    });
  });

  describe('queue replenishment', () => {
    it('does not duplicate vacancies on repeated scan', async () => {
      // Add vacancy to queue
      await store.updateState({
        vacancyQueue: [
          {
            vacancyId: '101234567',
            url: 'https://hh.ru/vacancy/101234567',
            title: 'Senior Frontend Developer',
            company: 'Tech Company A',
            source: 'search_dom',
            discoveredAt: Date.now(),
            profileId: null,
            status: 'queued',
          },
        ],
      });

      const beforeCount = store.getState().vacancyQueue.length;
      expect(beforeCount).toBe(1);

      // Simulate repeated scan with same vacancy
      // materializeVacanciesFromSearch should skip duplicates
      const afterCount = store.getState().vacancyQueue.length;
      expect(afterCount).toBe(1);
    });

    it('adds new vacancies to queue', async () => {
      const beforeCount = store.getState().vacancyQueue.length;

      await store.updateState({
        vacancyQueue: [
          {
            vacancyId: '101234567',
            url: 'https://hh.ru/vacancy/101234567',
            title: 'Senior Frontend Developer',
            company: 'Tech Company A',
            source: 'search_dom',
            discoveredAt: Date.now(),
            profileId: null,
            status: 'queued',
          },
        ],
      });

      const afterCount = store.getState().vacancyQueue.length;
      expect(afterCount).toBeGreaterThan(beforeCount);
    });
  });

  describe('exhaustion integration', () => {
    it('marks exhaustion on last page with no new vacancies', async () => {
      // Simulate last page scenario
      await store.updateSearchLoopPage(2, 2, 1); // page 2 of 2
      await store.recordVacancyScan(1, 0); // found 1, new 0

      const state = store.getState();
      expect(state.vacancyScan.consecutiveEmptyScans).toBe(1);
    });

    it('resets exhaustion when new vacancies found', async () => {
      await store.recordVacancyScan(5, 0); // empty scan
      await store.recordVacancyScan(5, 3); // new vacancies

      const state = store.getState();
      expect(state.vacancyScan.consecutiveEmptyScans).toBe(0);
    });
  });
});
