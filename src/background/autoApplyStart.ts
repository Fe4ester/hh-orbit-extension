import type { AutoApplyMode } from '../state/types';

export type AutoApplyStartResult =
  | { success: true; runtimeState: 'RUNNING' }
  | { success: false; error: string };

export interface StartableAutoApplyEngine {
  requestStart(): Promise<void>;
}

interface AutoApplyEngines {
  backend: StartableAutoApplyEngine;
  live: StartableAutoApplyEngine;
}

export async function startAutoApply(
  mode: AutoApplyMode,
  engines: AutoApplyEngines
): Promise<AutoApplyStartResult> {
  try {
    await engines[mode].requestStart();
    return { success: true, runtimeState: 'RUNNING' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
