import { afterEach, describe, it, expect, vi } from 'vitest';
import { PreflightService } from '../src/runtime/preflightService';
import { FileLogger } from '../src/utils/fileLogger';

describe('PreflightService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks unknown preflight types instead of treating them as success', () => {
    const service = new PreflightService(vi.fn());

    const result = (service as any).parsePreflightResponse({
      type: 'brandNewServerState',
    });

    expect(result.canProceed).toBe(false);
    expect(result.type).toBe('error');
    expect(result.error).toBe('unknown_preflight_type:brandNewServerState');
  });

  it('does not persist XSRF tokens in FileLogger context', async () => {
    const xsrfToken = 'secret-xsrf-token-1234567890';
    const fileLoggerSpy = vi.spyOn(FileLogger, 'log').mockResolvedValue();
    (chrome as any).cookies = {
      get: vi.fn().mockResolvedValue({ value: xsrfToken }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ type: 'quickResponse' }),
    }));

    await new PreflightService(vi.fn()).check('123', 'resume123');

    const serializedPayload = JSON.stringify(fileLoggerSpy.mock.calls);
    expect(serializedPayload).not.toContain(xsrfToken);
    expect(serializedPayload).not.toContain('secret-xsrf');
    expect(serializedPayload).not.toContain(xsrfToken.substring(0, 8));
    expect(fileLoggerSpy).toHaveBeenCalledWith(
      'service_worker',
      'info',
      'XSRF token obtained',
      { source: 'cookie', hasXsrfToken: true }
    );
  });
});
