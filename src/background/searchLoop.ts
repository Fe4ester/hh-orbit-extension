import type { AppState } from '../state/types';

export type SearchPageScanResult =
  | {
      success: true;
      foundCount: number;
      newCount: number;
      queueSizeAfter: number;
      currentUrl: string | null;
    }
  | { success: false; error: string };

export type NextSearchPageResult =
  | { success: true; nextUrl: string }
  | { success: false; error: string };

export type SearchPaginationResult =
  | { success: true; hasNext: boolean }
  | { success: false; error: string };

interface ScanCurrentSearchPageDependencies {
  getState(): AppState;
  acquireForProfile(profileId: string, skipNavigation: boolean): Promise<{
    success: boolean;
    currentUrl: string | null;
    cardsFound: number;
    newQueued: number;
    queueSizeAfter: number;
    error?: string;
  }>;
  recordVacancyScan(foundCount: number, newCount: number): Promise<void>;
}

export async function scanCurrentSearchPage(
  dependencies: ScanCurrentSearchPageDependencies
): Promise<SearchPageScanResult> {
  const activeProfileId = dependencies.getState().activeProfileId;
  if (!activeProfileId) {
    return { success: false, error: 'No active profile' };
  }

  const acquisition = await dependencies.acquireForProfile(activeProfileId, true);
  if (!acquisition.success) {
    return { success: false, error: acquisition.error || 'Search page acquisition failed' };
  }

  await dependencies.recordVacancyScan(acquisition.cardsFound, acquisition.newQueued);
  return {
    success: true,
    foundCount: acquisition.cardsFound,
    newCount: acquisition.newQueued,
    queueSizeAfter: acquisition.queueSizeAfter,
    currentUrl: acquisition.currentUrl,
  };
}

interface RunSearchLoopDependencies {
  getState(): AppState;
  startSearchLoop(): Promise<void>;
  stopSearchLoop(): Promise<void>;
  incrementSearchLoopIteration(): Promise<void>;
  markNoMoreVacancies(reason: 'no_unseen_vacancies'): Promise<void>;
  scanCurrentPage(): Promise<SearchPageScanResult>;
  getHasNextPage(): Promise<SearchPaginationResult>;
  nextSearchPage(): Promise<NextSearchPageResult>;
}

export type SearchLoopResult =
  | ({ success: true; stopped: boolean; reason?: 'exhausted' | 'last_page'; nextUrl?: string } &
      Partial<Extract<SearchPageScanResult, { success: true }>>)
  | { success: false; error: string };

export async function runSearchLoop(
  dependencies: RunSearchLoopDependencies
): Promise<SearchLoopResult> {
  const initialState = dependencies.getState();
  if (!initialState.liveMode.controlledTabId) {
    return { success: false, error: 'No controlled tab' };
  }
  if (initialState.liveMode.pageType !== 'search') {
    return { success: false, error: 'Not on search page' };
  }
  if (initialState.vacancyScan.exhausted) {
    return { success: false, error: 'Vacancy search exhausted' };
  }
  if (initialState.runtimeBlocker) {
    return { success: false, error: `Runtime blocked: ${initialState.runtimeBlocker}` };
  }

  await dependencies.startSearchLoop();

  try {
    const scan = await dependencies.scanCurrentPage();
    if (!scan.success) {
      await dependencies.stopSearchLoop();
      return scan;
    }

    await dependencies.incrementSearchLoopIteration();
    if (dependencies.getState().vacancyScan.exhausted) {
      await dependencies.stopSearchLoop();
      return { ...scan, stopped: true, reason: 'exhausted' };
    }

    const pagination = await dependencies.getHasNextPage();
    if (!pagination.success) {
      await dependencies.stopSearchLoop();
      return pagination;
    }

    if (!pagination.hasNext) {
      if (scan.newCount === 0) {
        await dependencies.markNoMoreVacancies('no_unseen_vacancies');
      }
      await dependencies.stopSearchLoop();
      return { ...scan, stopped: true, reason: 'last_page' };
    }

    const nextPage = await dependencies.nextSearchPage();
    if (!nextPage.success) {
      await dependencies.stopSearchLoop();
      return nextPage;
    }

    await dependencies.stopSearchLoop();
    return { ...scan, stopped: false, nextUrl: nextPage.nextUrl };
  } catch (error) {
    await dependencies.stopSearchLoop();
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
