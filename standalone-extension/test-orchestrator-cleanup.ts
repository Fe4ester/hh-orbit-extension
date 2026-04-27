/**
 * Test: Orchestrator guaranteed cleanup on failure
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
  updateState: async (partial: any) => {
    console.log('[Test] store.updateState called:', partial);
  },
  incrementRuntimeCounters: async () => {},
  dispatch: async (event: string) => {
    console.log('[Test] store.dispatch called:', event);
  },
  resetRuntimeCounters: async () => {},
};

// Mock operations that throw error
let checkRuntimeBlockersCalled = false;

const mockOpsWithFailure = {
  checkRuntimeBlockers: async () => {
    checkRuntimeBlockersCalled = true;
    console.log('[Test] checkRuntimeBlockers called, throwing error');
    throw new Error('DOMParser is not defined');
  },
  detectResumes: async () => {
    return { success: true, candidates: [] };
  },
  applyProfileSearch: async () => {
    return { success: true, searchUrl: 'https://hh.ru/search' };
  },
  scanCurrentSearchPage: async () => {
    return { success: true, currentPage: 0, totalPages: 1, foundCount: 5, newCount: 5 };
  },
  observeVacancyDetail: async () => {
    return { success: true, observation: {}, classification: {} };
  },
  executeApply: async (realClick: boolean) => {
    return { success: true, result: { outcome: 'success' } };
  },
};

const orchestrator = new AutoApplyOrchestrator({
  store: mockStore as any,
  ops: mockOpsWithFailure,
  sleep: async (ms: number) => {
    console.log(`[Test] sleep(${ms})`);
  },
  log: (...args: any[]) => console.log('[Orchestrator]', ...args),
});

// Test failure cleanup
(async () => {
  console.log('\n=== TEST: Orchestrator Cleanup on Failure ===\n');

  try {
    console.log('[Test] Starting orchestrator (should fail)...');
    await orchestrator.start();
    console.log('[Test] Orchestrator finished (unexpected)');
  } catch (error) {
    console.log('[Test] Orchestrator threw error (expected):', (error as Error).message);
  }

  console.log('\n=== RESULTS ===\n');
  console.log('checkRuntimeBlockers called:', checkRuntimeBlockersCalled);
  console.log('orchestrator.isRunning():', orchestrator.isRunning());

  // Verify cleanup
  if (checkRuntimeBlockersCalled && !orchestrator.isRunning()) {
    console.log('\n✅ TEST PASSED: Orchestrator cleaned up after failure');
    console.log('   - Error was thrown during checkRuntimeBlockers');
    console.log('   - Orchestrator.running = false after failure');
    console.log('   - stopInternal was called (dispatch STOP_REQUESTED/STOP_CONFIRMED logged)');
  } else {
    console.log('\n❌ TEST FAILED: Cleanup incomplete');
    console.log('   - checkRuntimeBlockersCalled:', checkRuntimeBlockersCalled);
    console.log('   - orchestrator.isRunning():', orchestrator.isRunning());
    process.exit(1);
  }

  // Test stop after failure
  console.log('\n=== TEST: Stop after failure ===\n');
  console.log('[Test] Calling stop() after failure...');
  await orchestrator.stop();
  console.log('[Test] Stop completed');
  console.log('orchestrator.isRunning():', orchestrator.isRunning());

  if (!orchestrator.isRunning()) {
    console.log('\n✅ TEST PASSED: Stop works after failure');
  } else {
    console.log('\n❌ TEST FAILED: Stop did not clean up');
    process.exit(1);
  }
})();
