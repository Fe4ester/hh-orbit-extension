/**
 * Test: Orchestrator uses direct operations, not self-message
 */

import { AutoApplyOrchestrator } from './src/runtime/autoApplyOrchestrator';

// Mock store
const mockStore = {
  getState: () => ({
    runtimeBlocker: null,
    selectedResumeHash: 'test-hash',
    resumeCandidates: [{ hash: 'test-hash', title: 'Test Resume' }],
    liveMode: { pageType: 'search', currentUrl: 'https://hh.ru/search', controlledTabId: 123 },
    vacancyQueue: [{ vacancyId: 'v1', status: 'discovered', url: 'https://hh.ru/vacancy/1' }],
    settings: { maxAutoAppliesPerRun: 10, stopOnManualAction: false, delayMinSeconds: 1, delayMaxSeconds: 2 },
    runtime: { processed: 0 },
    runtimeState: 'RUNNING',
  }),
  setRuntimePhase: async () => {},
  selectResume: async () => {},
  bindControlledTab: async () => {},
  updateState: async () => {},
  incrementRuntimeCounters: async () => {},
  dispatch: async () => {},
  resetRuntimeCounters: async () => {},
};

// Mock operations
let checkRuntimeBlockersCalled = false;
let detectResumesCalled = false;
let applyProfileSearchCalled = false;
let scanCurrentSearchPageCalled = false;
let observeVacancyDetailCalled = false;
let executeApplyCalled = false;

const mockOps = {
  checkRuntimeBlockers: async () => {
    checkRuntimeBlockersCalled = true;
    console.log('[Test] checkRuntimeBlockers called directly');
    return { success: true, status: 'ok' };
  },
  detectResumes: async () => {
    detectResumesCalled = true;
    console.log('[Test] detectResumes called directly');
    return { success: true, candidates: [] };
  },
  applyProfileSearch: async () => {
    applyProfileSearchCalled = true;
    console.log('[Test] applyProfileSearch called directly');
    return { success: true, searchUrl: 'https://hh.ru/search' };
  },
  scanCurrentSearchPage: async () => {
    scanCurrentSearchPageCalled = true;
    console.log('[Test] scanCurrentSearchPage called directly');
    return { success: true, currentPage: 0, totalPages: 1, foundCount: 5, newCount: 5 };
  },
  observeVacancyDetail: async () => {
    observeVacancyDetailCalled = true;
    console.log('[Test] observeVacancyDetail called directly');
    return { success: true, observation: {}, classification: {} };
  },
  executeApply: async (realClick: boolean) => {
    executeApplyCalled = true;
    console.log('[Test] executeApply called directly with realClick:', realClick);
    return { success: true, result: { outcome: 'success' } };
  },
};

const orchestrator = new AutoApplyOrchestrator({
  store: mockStore as any,
  ops: mockOps,
  sleep: async (ms: number) => {
    console.log(`[Test] sleep(${ms})`);
  },
  log: (...args: any[]) => console.log('[Orchestrator]', ...args),
});

// Run single cycle
(async () => {
  console.log('\n=== TEST: Orchestrator Direct Operations ===\n');

  // Mock chrome.tabs.create
  (global as any).chrome = {
    tabs: {
      create: async (options: any) => {
        console.log('[Test] chrome.tabs.create called:', options.url);
        return { id: 456, windowId: 1, url: options.url };
      },
    },
  };

  try {
    // Call runCycle via reflection (it's private)
    const runCycle = (orchestrator as any).runCycle.bind(orchestrator);
    const result = await runCycle();

    console.log('\n=== RESULTS ===\n');
    console.log('Cycle result:', result);
    console.log('checkRuntimeBlockers called:', checkRuntimeBlockersCalled);
    console.log('detectResumes called:', detectResumesCalled);
    console.log('applyProfileSearch called:', applyProfileSearchCalled);
    console.log('scanCurrentSearchPage called:', scanCurrentSearchPageCalled);
    console.log('observeVacancyDetail called:', observeVacancyDetailCalled);
    console.log('executeApply called:', executeApplyCalled);

    // Verify all operations were called directly
    const allCalled =
      checkRuntimeBlockersCalled &&
      !detectResumesCalled && // Not called because resume already selected
      applyProfileSearchCalled &&
      scanCurrentSearchPageCalled &&
      observeVacancyDetailCalled &&
      executeApplyCalled;

    if (allCalled) {
      console.log('\n✅ TEST PASSED: All operations called directly, no self-message');
    } else {
      console.log('\n❌ TEST FAILED: Some operations not called');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  }
})();
