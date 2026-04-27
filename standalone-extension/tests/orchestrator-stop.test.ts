import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoApplyOrchestrator } from '../src/runtime/autoApplyOrchestrator';

describe('AutoApplyOrchestrator stopInternal', () => {
  let mockStore: any;
  let mockOps: any;
  let mockAcquisitionService: any;
  let mockSleep: any;
  let mockLog: any;
  let orchestrator: AutoApplyOrchestrator;

  beforeEach(() => {
    mockLog = vi.fn();
    mockSleep = vi.fn().mockResolvedValue(undefined);

    mockStore = {
      getState: vi.fn(),
      dispatch: vi.fn().mockResolvedValue(undefined),
      updateState: vi.fn().mockResolvedValue(undefined),
      setRuntimePhase: vi.fn().mockResolvedValue(undefined),
      resetRuntimeCounters: vi.fn().mockResolvedValue(undefined),
    };

    mockOps = {
      checkRuntimeBlockers: vi.fn(),
      detectResumes: vi.fn(),
      observeVacancyDetail: vi.fn(),
      executeApply: vi.fn(),
    };

    mockAcquisitionService = {
      acquireForProfile: vi.fn(),
    };

    orchestrator = new AutoApplyOrchestrator({
      store: mockStore,
      ops: mockOps,
      acquisitionService: mockAcquisitionService,
      sleep: mockSleep,
      log: mockLog,
    });
  });

  it('should not dispatch STOP_CONFIRMED when already STOPPED', async () => {
    mockStore.getState.mockReturnValue({
      runtimeState: 'STOPPED',
      runtime: { currentPhase: 'idle' },
    });

    await orchestrator.stop();

    expect(mockStore.dispatch).not.toHaveBeenCalledWith('STOP_REQUESTED');
    expect(mockStore.dispatch).not.toHaveBeenCalledWith('STOP_CONFIRMED');
    expect(mockLog).toHaveBeenCalledWith(
      '[Orchestrator] AUTO_APPLY_STOP: Already STOPPED, cleanup only'
    );
  });

  it('should dispatch STOP_REQUESTED then STOP_CONFIRMED when RUNNING', async () => {
    mockStore.getState.mockReturnValue({
      runtimeState: 'RUNNING',
      runtime: { currentPhase: 'apply' },
    });

    await orchestrator.stop();

    expect(mockStore.dispatch).toHaveBeenCalledWith('STOP_REQUESTED');
    expect(mockStore.dispatch).toHaveBeenCalledWith('STOP_CONFIRMED');
    expect(mockLog).toHaveBeenCalledWith(
      '[Orchestrator] AUTO_APPLY_STOP: Dispatching STOP_REQUESTED'
    );
    expect(mockLog).toHaveBeenCalledWith(
      '[Orchestrator] AUTO_APPLY_STOP: Dispatching STOP_CONFIRMED'
    );
  });

  it('should dispatch stop transitions for PAUSED_BY_USER', async () => {
    mockStore.getState.mockReturnValue({
      runtimeState: 'PAUSED_BY_USER',
      runtime: { currentPhase: 'paused_auth' },
    });

    await orchestrator.stop();

    expect(mockStore.dispatch).toHaveBeenCalledWith('STOP_REQUESTED');
    expect(mockStore.dispatch).toHaveBeenCalledWith('STOP_CONFIRMED');
  });

  it('should dispatch stop transitions for PAUSED_MANUAL_ACTION', async () => {
    mockStore.getState.mockReturnValue({
      runtimeState: 'PAUSED_MANUAL_ACTION',
      runtime: { currentPhase: 'paused_manual_action' },
    });

    await orchestrator.stop();

    expect(mockStore.dispatch).toHaveBeenCalledWith('STOP_REQUESTED');
    expect(mockStore.dispatch).toHaveBeenCalledWith('STOP_CONFIRMED');
  });

  it('should dispatch stop transitions for PAUSED_NO_VACANCIES', async () => {
    mockStore.getState.mockReturnValue({
      runtimeState: 'PAUSED_NO_VACANCIES',
      runtime: { currentPhase: 'paused_no_vacancies' },
    });

    await orchestrator.stop();

    expect(mockStore.dispatch).toHaveBeenCalledWith('STOP_REQUESTED');
    expect(mockStore.dispatch).toHaveBeenCalledWith('STOP_CONFIRMED');
  });

  it('should force IDLE when state is ERROR', async () => {
    mockStore.getState.mockReturnValue({
      runtimeState: 'ERROR',
      runtime: { currentPhase: 'error' },
    });

    await orchestrator.stop();

    expect(mockStore.dispatch).not.toHaveBeenCalled();
    expect(mockStore.updateState).toHaveBeenCalledWith({ runtimeState: 'IDLE' });
    expect(mockLog).toHaveBeenCalledWith(
      '[Orchestrator] AUTO_APPLY_STOP: ERROR state, forcing IDLE'
    );
  });

  it('should force STOPPED on unexpected state', async () => {
    mockStore.getState.mockReturnValue({
      runtimeState: 'UNKNOWN_STATE' as any,
      runtime: { currentPhase: 'idle' },
    });

    await orchestrator.stop();

    expect(mockStore.updateState).toHaveBeenCalledWith({ runtimeState: 'STOPPED' });
    expect(mockLog).toHaveBeenCalledWith(
      '[Orchestrator] AUTO_APPLY_STOP: Unexpected state, forcing STOPPED',
      { currentState: 'UNKNOWN_STATE' }
    );
  });

  it('should force STOPPED if dispatch fails', async () => {
    mockStore.getState.mockReturnValue({
      runtimeState: 'RUNNING',
      runtime: { currentPhase: 'apply' },
    });

    mockStore.dispatch.mockRejectedValueOnce(new Error('Invalid transition'));

    await orchestrator.stop();

    expect(mockStore.updateState).toHaveBeenCalledWith({ runtimeState: 'STOPPED' });
    expect(mockLog).toHaveBeenCalledWith(
      '[Orchestrator] AUTO_APPLY_STOP: dispatch failed, forcing STOPPED',
      expect.any(Error)
    );
  });

  it('should always set runtime phase to idle at the end', async () => {
    mockStore.getState.mockReturnValue({
      runtimeState: 'RUNNING',
      runtime: { currentPhase: 'apply' },
    });

    await orchestrator.stop();

    expect(mockStore.setRuntimePhase).toHaveBeenCalledWith('idle', null);
  });
});
