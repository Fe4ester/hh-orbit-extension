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

  it('blocks quickResponse payload with cover letter requirement for backend mode', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        type: 'quickResponse',
        responseStatus: {
          shortVacancy: { '@responseLetterRequired': true },
        },
      }),
    });

    const result = await client.preflightApply('123', 'resume123');

    expect(result.canProceed).toBe(false);
    expect(result.requiresCoverLetter).toBe(true);
    expect(result.reason).toBe('cover_letter_required');
  });

  it('blocks modal payload with cover letter requirement for backend mode', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        type: 'modal',
        responseStatus: {
          shortVacancy: { '@responseLetterRequired': true },
        },
      }),
    });

    const result = await client.preflightApply('123', 'resume123');

    expect(result.canProceed).toBe(false);
    expect(result.requiresCoverLetter).toBe(true);
    expect(result.reason).toBe('cover_letter_required');
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

  it('preserves already_applied classification from non-ok apply responses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ type: 'alreadyApplied' }),
    });

    const result = await client.applyToVacancy('123', {
      resumeHash: 'resume123',
    });

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('already_applied');
    expect(result.message).toContain('Already applied');
  });

  it('preserves questionnaire_required classification from non-ok apply responses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ type: 'questionnaireRequired' }),
    });

    const result = await client.applyToVacancy('123', {
      resumeHash: 'resume123',
    });

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('questionnaire_required');
    expect(result.message).toBe('Questionnaire required');
  });

  it('preserves questionnaire_required classification from nested non-ok apply responses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        type: 'quickResponse',
        responseStatus: {
          questionnaire: { hasQuestions: true },
        },
      }),
    });

    const result = await client.applyToVacancy('123', {
      resumeHash: 'resume123',
    });

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('questionnaire_required');
    expect(result.message).toBe('Questionnaire required');
  });

  it('keeps structured diagnostics for unrecognized non-ok apply responses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ type: 'brandNewServerState' }),
    });

    const result = await client.applyToVacancy('123', {
      resumeHash: 'resume123',
    });

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('error');
    expect(result.message).toBe('HTTP 400 (unrecognized apply response type=brandNewServerState)');
    expect(result.error).toContain('"type":"brandNewServerState"');
  });
});
