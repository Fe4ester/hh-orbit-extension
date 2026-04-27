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
      expect(mockLog).toHaveBeenCalledWith(
        '[Acquisition] Navigating controlled tab to search',
        expect.objectContaining({ tabId: mockTabId })
      );
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
      expect(mockLog).toHaveBeenCalledWith(
        '[Acquisition] Navigating controlled tab to search',
        expect.objectContaining({ tabId: newTabId })
      );
    });
  });

  describe('parseSearchResults without DOMParser', () => {
    it('should not crash on DOMParser in background context', async () => {
      // Simulate background context where DOMParser is undefined
      const originalDOMParser = global.DOMParser;
      (global as any).DOMParser = undefined;

      mockStore.getState.mockReturnValue({
        liveMode: { controlledTabId: 123 },
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

      vi.mocked(chrome.tabs.create).mockResolvedValue({ id: 123, status: 'complete', url: 'https://hh.ru/search' } as any);
      vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 123, status: 'complete', url: 'https://hh.ru/search' } as any);
      vi.mocked(chrome.tabs.update).mockResolvedValue({} as any);
      vi.mocked(chrome.tabs.sendMessage).mockResolvedValue({
        html: `
          <html>
            <div class="serp-item">
              <a href="https://hh.ru/vacancy/12345" data-qa="serp-item__title">Test Vacancy</a>
            </div>
          </html>
        `,
      });
      vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
        { result: 'complete' },
      ] as any);

      const result = await service.acquireForProfile('prof1');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      // Restore
      global.DOMParser = originalDOMParser;
    });
  });
});
