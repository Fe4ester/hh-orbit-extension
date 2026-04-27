import { describe, it, expect } from 'vitest';
import {
  getPrimaryControlsState,
  getPrimaryRuntimeStatusViewModel,
  getUserFacingManualActions,
} from '../src/state/selectors';
import { INITIAL_STATE, AppState } from '../src/state/types';

describe('Primary selectors', () => {
  it('shows user-facing runtime phase labels', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      runtime: {
        ...INITIAL_STATE.runtime,
        currentPhase: 'session_check',
      },
    };

    const vm = getPrimaryRuntimeStatusViewModel(state);
    expect(vm.phaseLabel).toBe('Проверка сессии');
  });

  it('returns pending manual actions only', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      manualActions: [
        {
          id: 'a1',
          type: 'questionnaire',
          vacancyId: '1',
          vacancyTitle: 'Vac1',
          company: 'C1',
          createdAt: 1,
          status: 'pending',
          reasonCode: 'questionnaire_required',
        },
        {
          id: 'a2',
          type: 'test',
          vacancyId: '2',
          vacancyTitle: 'Vac2',
          company: 'C2',
          createdAt: 2,
          status: 'done',
          reasonCode: 'test_required',
        },
      ],
    };

    const rows = getUserFacingManualActions(state);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('a1');
  });

  it('controls start/stop visibility by runtime state', () => {
    const idle = getPrimaryControlsState({ ...INITIAL_STATE, runtimeState: 'IDLE' });
    expect(idle.canStart).toBe(true);
    expect(idle.canStop).toBe(false);
  });
});
