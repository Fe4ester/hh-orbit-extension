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

  it('blocks quickResponse payload with cover letter requirement for backend mode and exposes letter limit', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        type: 'quickResponse',
        responseStatus: {
          shortVacancy: { '@responseLetterRequired': true },
          letterMaxLength: 4000,
        },
      }),
    });

    const result = await client.preflightApply('123', 'resume123');

    expect(result.canProceed).toBe(false);
    expect(result.requiresCoverLetter).toBe(true);
    expect(result.reason).toBe('cover_letter_required');
    expect(result.letterMaxLength).toBe(4000);
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

  it('classifies apply responses that still require cover letter after POST', async () => {
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

    const result = await client.applyToVacancy('123', {
      resumeHash: 'resume123',
    }, 'Hello from template');

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('cover_letter_required');
    expect(result.message).toBe('Cover letter required');
  });

  it('uses HAR-aligned multipart form contract for cover-letter apply requests', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockResolvedValue({ success: 'true' }),
    });

    const result = await client.applyToVacancy('123', {
      resumeHash: 'resume123',
      hhtmFrom: 'negotiation_list',
      hhtmSource: 'main',
      lux: true,
      ignorePostponed: true,
    }, 'Hello from template');

    expect(result.success).toBe(true);

    const fetchArgs = fetchMock.mock.calls[0][1];
    expect(fetchArgs.headers['Content-Type']).toBeUndefined();
    expect(fetchArgs.body).toBeInstanceOf(FormData);

    const body = fetchArgs.body as FormData;
    expect(body.get('_xsrf')).toBe('token123456');
    expect(body.get('vacancy_id')).toBe('123');
    expect(body.get('resume_hash')).toBe('resume123');
    expect(body.get('ignore_postponed')).toBe('true');
    expect(body.get('incomplete')).toBe('false');
    expect(body.get('mark_applicant_visible_in_vacancy_country')).toBe('false');
    expect(body.get('country_ids')).toBe('[]');
    expect(body.get('letter')).toBe('Hello from template');
    expect(body.get('lux')).toBe('true');
    expect(body.get('withoutTest')).toBe('no');
    expect(body.get('hhtmFromLabel')).toBe('negotiation_list');
    expect(body.get('hhtmSourceLabel')).toBe('main');
    expect(body.get('cover_letter')).toBeNull();
  });

  it('keeps urlencoded contract for non-cover-letter apply requests', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockResolvedValue({ success: 'true' }),
    });

    const result = await client.applyToVacancy('123', {
      resumeHash: 'resume123',
    });

    expect(result.success).toBe(true);

    const fetchArgs = fetchMock.mock.calls[0][1];
    expect(fetchArgs.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(fetchArgs.body).toContain('resume_hash=resume123');
    expect(fetchArgs.body).toContain('vacancy_id=123');
    expect(fetchArgs.body).not.toContain('letter=');
  });

  it('classifies structured apply response { error: \"letter-required\" } as cover letter blocker', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: 'letter-required',
      }),
    });

    const result = await client.applyToVacancy('123', {
      resumeHash: 'resume123',
    }, 'Hello from template');

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('cover_letter_required');
    expect(result.message).toBe('Cover letter required (server validation)');
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        responseKind: 'json',
        status: 400,
        errorSignal: 'letter-required',
        keys: ['error'],
      })
    );
  });

  it('classifies structured apply response { reason: \"letter-required\" } as cover letter blocker', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        reason: 'letter-required',
      }),
    });

    const result = await client.applyToVacancy('123', {
      resumeHash: 'resume123',
    }, 'Hello from template');

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('cover_letter_required');
    expect(result.message).toBe('Cover letter required (server validation)');
  });

  it('classifies HTML apply responses that still show cover letter UI after POST', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue('text/html') },
      json: vi.fn().mockRejectedValue(new Error('Unexpected token < in JSON')),
      text: vi.fn().mockResolvedValue('<html><body><textarea data-qa="vacancy-response-letter-input"></textarea><div>Сопроводительное письмо</div></body></html>'),
    });

    const result = await client.applyToVacancy('123', {
      resumeHash: 'resume123',
    }, 'Hello from template');

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('cover_letter_required');
    expect(result.message).toBe('Cover letter required');
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        responseKind: 'text',
        status: 200,
      })
    );
  });

  it('classifies text/html success response as success instead of cover letter blocker', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue('text/html') },
      json: vi.fn().mockRejectedValue(new Error('Unexpected token < in JSON')),
      text: vi.fn().mockResolvedValue('<html><body><div data-qa="vacancy-response-submit-popup">Отклик отправлен</div></body></html>'),
    });

    const result = await client.applyToVacancy('123', {
      resumeHash: 'resume123',
    }, 'Hello from template');

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('success');
    expect(result.message).toBe('Application sent successfully (text fallback)');
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        responseKind: 'text',
        status: 200,
        preview: expect.stringContaining('Отклик отправлен'),
      })
    );
  });

  it('preserves diff-friendly diagnostics for successful cover-letter apply responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockResolvedValue({
        success: 'true',
        topic_id: 'topic-1',
        negotiation_id: 'neg-1',
      }),
    });

    const result = await client.applyToVacancy('123', {
      resumeHash: 'resume123',
    }, 'Hello from template');

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('success');
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        responseKind: 'json',
        status: 200,
        keys: ['negotiation_id', 'success', 'topic_id'],
        preview: expect.stringContaining('"success":"true"'),
      })
    );
  });
});
