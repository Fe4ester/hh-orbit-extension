import { describe, it, expect, vi } from 'vitest';
import { PreflightService } from '../src/runtime/preflightService';

describe('PreflightService', () => {
  it('blocks unknown preflight types instead of treating them as success', () => {
    const service = new PreflightService(vi.fn());

    const result = (service as any).parsePreflightResponse({
      type: 'brandNewServerState',
    });

    expect(result.canProceed).toBe(false);
    expect(result.type).toBe('error');
    expect(result.error).toBe('unknown_preflight_type:brandNewServerState');
  });
});
