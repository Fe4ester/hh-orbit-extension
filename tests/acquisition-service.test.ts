import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcquisitionService } from '../src/runtime/acquisitionService';

describe('AcquisitionService', () => {
  let mockStore: any;
  let mockLog: any;
  let service: AcquisitionService;

  beforeEach(() => {
    mockLog = vi.fn();
    mockStore = {
      getState: vi.fn(),
      updateState: vi.fn(),
      materializeVacanciesFromSearch: vi.fn(),
    };

    service = new AcquisitionService({
      store: mockStore as any,
      log: mockLog,
    });
  });

  describe('ensureRuntimeSearchTab', () => {
    it('should reuse valid existing tab', async () => {
      const mockTabId = 123;

      mockStore.getState.mockReturnValue({
        liveMode: { controlledTabId: mockTabId },
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test',
            keywordsInclude: [],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        vacancyQueue: [],
      });

      // Mock chrome.tabs.get to return valid tab
      vi.mocked(chrome.tabs.get).mockResolvedValue({ id: mockTabId, status: 'complete', url: 'https://hh.ru/search' } as any);
      vi.mocked(chrome.tabs.update).mockResolvedValue({} as any);
      vi.mocked(chrome.tabs.create).mockClear();
      vi.mocked(chrome.tabs.sendMessage).mockResolvedValue({ html: '<html><div class="serp-item"><a href="https://hh.ru/vacancy/123">Test</a></div></html>' });
      vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
        { result: 'complete' },
      ] as any);

      await service.acquireForProfile('prof1');

      expect(chrome.tabs.update).toHaveBeenCalledWith(mockTabId, expect.any(Object));
      expect(chrome.tabs.create).not.toHaveBeenCalled();
    });

    it('should recreate tab when stored tabId is stale', async () => {
      const staleTabId = 999;
      const newTabId = 456;

      mockStore.getState.mockReturnValue({
        liveMode: { controlledTabId: staleTabId },
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test',
            keywordsInclude: [],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        vacancyQueue: [],
      });

      // Mock chrome.tabs.get to throw (tab doesn't exist)
      vi.mocked(chrome.tabs.get).mockRejectedValue(new Error('No tab with id: 999'));
      vi.mocked(chrome.tabs.create).mockResolvedValue({ id: newTabId, status: 'complete', url: 'https://hh.ru/search' } as any);
      vi.mocked(chrome.tabs.update).mockRejectedValue(new Error('No tab with id: 999'));
      vi.mocked(chrome.tabs.sendMessage).mockResolvedValue({ html: '<html><div class="serp-item"><a href="https://hh.ru/vacancy/456">Test</a></div></html>' });
      vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
        { result: 'complete' },
      ] as any);

      const result = await service.acquireForProfile('prof1');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should create new tab when no stored tabId', async () => {
      const newTabId = 789;

      mockStore.getState.mockReturnValue({
        liveMode: { controlledTabId: newTabId },
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test',
            keywordsInclude: [],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        vacancyQueue: [],
      });

      vi.mocked(chrome.tabs.create).mockResolvedValue({ id: newTabId, status: 'complete', url: 'https://hh.ru/search' } as any);
      vi.mocked(chrome.tabs.get).mockClear();
      vi.mocked(chrome.tabs.update).mockResolvedValue({} as any);
      vi.mocked(chrome.tabs.sendMessage).mockResolvedValue({ html: '<html><div class="serp-item"><a href="https://hh.ru/vacancy/789">Test</a></div></html>' });
      vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
        { result: 'complete' },
      ] as any);

      await service.acquireForProfile('prof1');

      expect(chrome.tabs.update).toHaveBeenCalled();
    });

    it('accepts applicant vacancy search page when navigation is skipped', async () => {
      const mockTabId = 321;
      const html = '<html><body><div data-qa="vacancy-serp__vacancy"><a href="https://hh.ru/vacancy/321" data-qa="vacancy-serp__vacancy-title">Test vacancy</a></div></body></html>';

      mockStore.getState.mockReturnValue({
        liveMode: { controlledTabId: mockTabId },
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test',
            keywordsInclude: [],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        vacancyQueue: [],
      });

      vi.mocked(chrome.tabs.get).mockResolvedValue({
        id: mockTabId,
        status: 'complete',
        url: 'https://hh.ru/applicant/vacancy_search?page=1',
      } as any);
      vi.mocked(chrome.tabs.sendMessage)
        .mockResolvedValueOnce({ pong: true } as any)
        .mockResolvedValueOnce({ html } as any);
      mockStore.materializeVacanciesFromSearch.mockImplementation(async () => {
        mockStore.getState.mockReturnValue({
          liveMode: { controlledTabId: mockTabId },
          profiles: {
            prof1: {
              id: 'prof1',
              name: 'Test',
              keywordsInclude: [],
              keywordsExclude: [],
              locations: [],
              experience: [],
              schedule: [],
              employment: [],
            },
          },
          vacancyQueue: [
            { vacancyId: '321', status: 'discovered' },
          ],
        });
      });

      const result = await service.acquireForProfile('prof1', true);

      expect(result.success).toBe(true);
      expect(result.currentUrl).toContain('/applicant/vacancy_search');
      expect(result.error).toBeUndefined();
    });

    it('reports only actually queued vacancies in newQueued', async () => {
      const mockTabId = 654;
      const html = `
        <html><body>
          <div data-qa="vacancy-serp__vacancy"><a href="https://hh.ru/vacancy/1001" data-qa="vacancy-serp__vacancy-title">First</a></div>
          <div data-qa="vacancy-serp__vacancy"><a href="https://hh.ru/vacancy/1002" data-qa="vacancy-serp__vacancy-title">Second</a></div>
        </body></html>
      `;

      let queueState = [{ vacancyId: 'existing', status: 'discovered' }];

      mockStore.getState.mockImplementation(() => ({
        liveMode: { controlledTabId: mockTabId },
        profiles: {
          prof1: {
            id: 'prof1',
            name: 'Test',
            keywordsInclude: [],
            keywordsExclude: [],
            locations: [],
            experience: [],
            schedule: [],
            employment: [],
          },
        },
        vacancyQueue: queueState,
      }));

      vi.mocked(chrome.tabs.get).mockResolvedValue({
        id: mockTabId,
        status: 'complete',
        url: 'https://hh.ru/search/vacancy?page=0',
      } as any);
      vi.mocked(chrome.tabs.sendMessage)
        .mockResolvedValueOnce({ pong: true } as any)
        .mockResolvedValueOnce({ html } as any);
      mockStore.materializeVacanciesFromSearch.mockImplementation(async () => {
        queueState = [
          ...queueState,
          { vacancyId: '1001', status: 'discovered' },
        ];
      });

      const result = await service.acquireForProfile('prof1', true);

      expect(result.success).toBe(true);
      expect(result.cardsFound).toBe(2);
      expect(result.newQueued).toBe(1);
      expect(result.queueSizeAfter).toBe(2);
    });
  });

});
