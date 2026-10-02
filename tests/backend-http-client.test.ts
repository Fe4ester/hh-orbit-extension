import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHTTPClient } from '../src/runtime/backendHTTPClient';
import type { Profile } from '../src/state/types';

const searchProfile: Profile = {
  id: 'profile-1',
  name: 'Python',
  keywordsInclude: ['python'],
  keywordsExclude: [],
  createdAt: 1,
  updatedAt: 1,
};

describe('BackendHTTPClient', () => {
  let client: BackendHTTPClient;
  let fetchMock: any;
  let logMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logMock = vi.fn();
    client = new BackendHTTPClient({ log: logMock });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    (chrome as any).cookies = {
      get: vi.fn().mockResolvedValue({ value: 'token123456' }),
    };
  });

  it('uses the resume hash supplied by the initialized state store for vacancy search', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://hh.ru/search/vacancy?items_on_page=50&page=2&resume=resume-from-store',
      headers: { get: vi.fn().mockReturnValue('text/html; charset=utf-8') },
      text: vi.fn().mockResolvedValue('<div data-qa="vacancy-serp__results"></div>'),
    });

    await client.fetchVacancies(searchProfile, 2, 'resume-from-store');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hh.ru/search/vacancy?items_on_page=50&page=2&resume=resume-from-store',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(chrome.storage.local.get).not.toHaveBeenCalledWith('state');
    expect(chrome.storage.local.get).not.toHaveBeenCalledWith('app_state');
    expect(JSON.stringify(logMock.mock.calls)).not.toContain('resume-from-store');
  });

  it('parses the current vacancy card contract through the shared search parser', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://hh.ru/search/vacancy?resume=resume-1',
      headers: { get: vi.fn().mockReturnValue('text/html') },
      text: vi.fn().mockResolvedValue(`
        <main data-qa="vacancy-serp__results">
          <article data-qa="vacancy-serp__vacancy" class="vacancy-serp-item">
            <a data-qa="vacancy-serp__vacancy-title" href="/vacancy/123456?from=serp">
              <span>Python Backend Developer</span>
            </a>
          </article>
        </main>
      `),
    });

    await expect(client.fetchVacancies(searchProfile, 0, 'resume-1')).resolves.toEqual([
      expect.objectContaining({
        id: '123456',
        name: 'Python Backend Developer',
        alternate_url: 'https://hh.ru/vacancy/123456?from=serp',
      }),
    ]);
  });

  it('refuses to run a broad vacancy search without a resume hash', async () => {
    await expect(client.fetchVacancies(searchProfile, 0, '  ')).rejects.toThrow(
      'Vacancy search requires a selected resume hash'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an empty result only for a recognized empty search page', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://hh.ru/search/vacancy?resume=resume-1',
      headers: { get: vi.fn().mockReturnValue('text/html') },
      text: vi.fn().mockResolvedValue('<main data-qa="vacancy-serp__results"></main>'),
    });

    await expect(client.fetchVacancies(searchProfile, 0, 'resume-1')).resolves.toEqual([]);
  });

  it('does not classify a captcha page as an empty vacancy page', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://hh.ru/search/vacancy?resume=resume-1',
      headers: { get: vi.fn().mockReturnValue('text/html') },
      text: vi.fn().mockResolvedValue('<div data-qa="captcha">Подтвердите, что вы не робот</div>'),
    });

    await expect(client.fetchVacancies(searchProfile, 0, 'resume-1')).rejects.toThrow(
      'Vacancy search blocked: captcha_required'
    );
  });

  it('recognizes a login redirect even when the response body has no login form', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://hh.ru/account/login?backurl=%2Fsearch%2Fvacancy',
      headers: { get: vi.fn().mockReturnValue('text/html') },
      text: vi.fn().mockResolvedValue('<html><body>Вход в личный кабинет</body></html>'),
    });

    await expect(client.fetchVacancies(searchProfile, 0, 'resume-1')).rejects.toMatchObject({
      code: 'login_required',
    });
  });

  it('reports a parser contract mismatch instead of a false empty page', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://hh.ru/search/vacancy?resume=resume-1',
      headers: { get: vi.fn().mockReturnValue('text/html') },
      text: vi.fn().mockResolvedValue(
        '<main data-qa="vacancy-serp__results"><div data-qa="vacancy-serp__vacancy">Changed card contract</div></main>'
      ),
    });

    await expect(client.fetchVacancies(searchProfile, 0, 'resume-1')).rejects.toMatchObject({
      code: 'contract_mismatch',
    });
  });

  it('does not classify an unrecognized HTML response as an empty vacancy page', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://hh.ru/search/vacancy?resume=resume-1',
      headers: { get: vi.fn().mockReturnValue('text/html') },
      text: vi.fn().mockResolvedValue('<html><body>Temporary upstream page</body></html>'),
    });

    await expect(client.fetchVacancies(searchProfile, 0, 'resume-1')).rejects.toThrow(
      'Vacancy search returned an unrecognized page'
    );
  });

  it('does not leak XSRF tokens into runtime logger payloads', async () => {
    const xsrfToken = 'secret-xsrf-token-1234567890';
    (chrome as any).cookies.get = vi.fn().mockResolvedValue({ value: xsrfToken });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockResolvedValue({ success: 'true' }),
    });

    await client.applyToVacancy('123', { resumeHash: 'resume123' });

    const serializedPayload = JSON.stringify(logMock.mock.calls);
    expect(serializedPayload).not.toContain(xsrfToken);
    expect(serializedPayload).not.toContain('secret-xsrf');
    expect(serializedPayload).not.toContain(xsrfToken.substring(0, 8));
    expect(serializedPayload).toContain('hasXsrfToken');
    expect(logMock).toHaveBeenCalledWith(
      '[BackendHTTP] applyToVacancy request',
      expect.objectContaining({
        hasXsrfToken: true,
        headerKeys: expect.arrayContaining(['X-Xsrftoken']),
      })
    );
  });

  it('keeps resume API failures diagnosable in structured logs', async () => {
    fetchMock.mockRejectedValue(new Error('Network request failed'));

    await expect(client.getMyResumes()).resolves.toEqual([]);

    expect(logMock).toHaveBeenCalledWith(
      '[BackendHTTP] getMyResumes error',
      expect.objectContaining({ message: 'Network request failed' })
    );
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

  it('does not leak resume hashes through preflight diagnostics', async () => {
    const resumeHash = 'private-resume-hash-123';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        type: 'quickResponse',
        respondedWithResume: resumeHash,
      }),
    });

    await client.preflightApply('123', resumeHash);

    const serializedLogs = JSON.stringify(logMock.mock.calls);
    expect(serializedLogs).not.toContain(resumeHash);
    expect(serializedLogs).toContain('[redacted]');
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
        redirect_uri: '/applicant/vacancy_response?vacancyId=123',
      }),
    });

    const result = await client.preflightApply('123', 'resume123');

    expect(result.canProceed).toBe(false);
    expect(result.requiresTest).toBe(true);
    expect(result.reason).toBe('test_required');
    expect(result.questionnaireUrl).toBe('/applicant/vacancy_response?vacancyId=123');
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

  it('classifies text/html questionnaire markers before treating the response as an error', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue('text/html') },
      json: vi.fn().mockRejectedValue(new Error('Unexpected token < in JSON')),
      text: vi.fn().mockResolvedValue('<html><div>Работодатель просит ответить на вопросы</div></html>'),
    });

    const result = await client.applyToVacancy('123', { resumeHash: 'resume123' });

    expect(result).toMatchObject({
      success: false,
      outcome: 'questionnaire_required',
      message: 'Questionnaire required',
      diagnostics: { responseKind: 'text', status: 200 },
    });
  });

  it('preserves an unrecognized text/html apply response as a diagnosable error', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue('text/html') },
      json: vi.fn().mockRejectedValue(new Error('Unexpected token < in JSON')),
      text: vi.fn().mockResolvedValue('<html><div>New server state</div></html>'),
    });

    const result = await client.applyToVacancy('123', { resumeHash: 'resume123' });

    expect(result).toMatchObject({
      success: false,
      outcome: 'error',
      message: 'HTTP 200 (unrecognized text apply response)',
      error: '<html><div>New server state</div></html>',
      diagnostics: { responseKind: 'text', status: 200 },
    });
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
    expect(JSON.stringify(result.diagnostics)).not.toContain('topic-1');
    expect(JSON.stringify(result.diagnostics)).not.toContain('neg-1');
  });

  it('fetches and submits a questionnaire through authenticated backend HTTP', async () => {
    const html = `
      <form name="vacancy_response" action="/applicant/vacancy_response">
        <input type="hidden" name="_xsrf" value="fresh-form-token">
        <input type="hidden" name="guid" value="guid-1">
        <div data-qa="task-question">Ваш город?</div>
        <textarea name="task_1_text" required></textarea>
      </form>
    `;
    fetchMock
      .mockResolvedValueOnce(new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
      .mockResolvedValueOnce(new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: 'true' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const contract = await client.fetchQuestionnaireForm('123');
    const result = await client.submitQuestionnaire('123', 'resume-1', {
      questionnaireId: contract.questionnaire.id,
      providerId: 'local',
      modelId: 'openrouter/free',
      generatedAt: 1,
      answers: [{
        questionId: 'task_1',
        text: 'Москва',
        confidence: 1,
        evidence: [{ source: 'user_instruction', reference: 'Проверено' }],
        requiresReview: false,
      }],
    });

    expect(result).toMatchObject({ success: true, outcome: 'success' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const submitOptions = fetchMock.mock.calls[2][1];
    expect(submitOptions.method).toBe('POST');
    expect(submitOptions.credentials).toBe('include');
    expect(submitOptions.body).toBeInstanceOf(FormData);
    expect(submitOptions.body.get('task_1_text')).toBe('Москва');
    expect(submitOptions.body.get('resume_hash')).toBe('resume-1');
  });

  it('refuses a questionnaire form that redirects submission outside HH', async () => {
    fetchMock.mockResolvedValueOnce(new Response(`
      <form name="vacancy_response" action="https://example.com/collect">
        <div data-qa="task-question">Ваш город?</div>
        <textarea name="task_1_text" required></textarea>
      </form>
    `, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }));

    await expect(client.submitQuestionnaire('123', 'resume-1', {
      questionnaireId: 'hh_123_task_1',
      providerId: 'local',
      modelId: 'openrouter/free',
      generatedAt: 1,
      answers: [{
        questionId: 'task_1',
        text: 'Москва',
        confidence: 1,
        evidence: [{ source: 'user_instruction', reference: 'Проверено' }],
        requiresReview: false,
      }],
    })).rejects.toThrow('недоверенный адрес');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
