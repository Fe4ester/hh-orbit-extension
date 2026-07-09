import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHTTPClient } from '../src/runtime/backendHTTPClient';

describe('BackendHTTPClient', () => {
  let client: BackendHTTPClient;
  let fetchMock: any;

  beforeEach(() => {
    client = new BackendHTTPClient({ log: vi.fn() });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    (chrome as any).cookies = {
      get: vi.fn().mockResolvedValue({ value: 'token123456' }),
    };
  });

  it('proceeds on quickResponse preflight responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ type: 'quickResponse' }),
    });

    const result = await client.preflightApply('123', 'resume123');

    expect(result.canProceed).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.requiresTest).toBeUndefined();
    expect(result.requiresQuestionnaire).toBeUndefined();
  });

  it('classifies quickResponse payload with tests as blocked', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        type: 'quickResponse',
        responseStatus: {
          test: { hasTests: true },
        },
      }),
    });

    const result = await client.preflightApply('123', 'resume123');

    expect(result.canProceed).toBe(false);
    expect(result.requiresTest).toBe(true);
    expect(result.reason).toBe('test_required');
  });

  it('classifies quickResponse payload with questionnaire blocker as blocked', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        type: 'quickResponse',
        responseStatus: {
          questionnaire: { hasQuestions: true },
        },
      }),
    });

    const result = await client.preflightApply('123', 'resume123');

    expect(result.canProceed).toBe(false);
    expect(result.requiresQuestionnaire).toBe(true);
    expect(result.reason).toBe('questionnaire_required');
  });

  it('does not proceed on unknown preflight response types', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ type: 'brandNewServerState' }),
    });

    const result = await client.preflightApply('123', 'resume123');

    expect(result.canProceed).toBe(false);
    expect(result.reason).toBe('unknown_preflight_type:brandNewServerState');
  });
});
