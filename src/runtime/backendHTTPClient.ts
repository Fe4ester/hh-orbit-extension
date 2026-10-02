/**
 * Backend HTTP Client
 *
 * Pure HTTP requests to HH.ru using the same flow as Python implementation.
 * Uses browser cookies for authentication.
 */

import type { Profile } from '../state/types';
import {
  buildBackendQuestionnaireBody,
  extractBackendPageText,
  parseBackendQuestionnaireForm,
  type BackendQuestionnaireFormContract,
} from '../questionnaires/backendQuestionnaireForm';
import type { AnswerPlan } from '../questionnaires/types';
import { parseSearchResults } from '../live/searchResultsParser';
import { getXsrfCookie } from '../utils/hhCookies';

export interface APIVacancy {
  id: string;
  name: string;
  employer: { name: string };
  alternate_url: string;
  salary?: { from?: number; to?: number; currency: string };
  area: { name: string };
  address?: { city?: string; country?: string };
}

export interface HHApplyContext {
  resumeHash: string;
  hhtmFrom?: string;
  hhtmSource?: string;
  referer?: string;
  lux?: boolean;
  ignorePostponed?: boolean;
}

export interface ApplyResponse {
  success: boolean;
  outcome: 'success' | 'already_applied' | 'test_required' | 'questionnaire_required' | 'cover_letter_required' | 'auth_required' | 'server_error' | 'error' | 'unknown';
  message?: string;
  error?: string;
  diagnostics?: {
    responseKind: 'json' | 'text';
    status?: number;
    keys?: string[];
    type?: string;
    errorSignal?: string | null;
    preview?: string;
  };
}

export type VacancySearchErrorCode =
  | 'missing_resume'
  | 'login_required'
  | 'captcha_required'
  | 'http_error'
  | 'contract_mismatch'
  | 'network_error';

export class VacancySearchError extends Error {
  constructor(
    public readonly code: VacancySearchErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'VacancySearchError';
  }
}

function redactSensitiveText(text: string): string {
  return text
    .replace(
      /([?&](?:resume(?:Hash)?|topic_id|chat_id|negotiation|applicantActivity)=)[^&\s"'<>]+/gi,
      '$1[redacted]'
    )
    .replace(
      /("(?:resume(?:Hash)?|topic_id|chat_id|negotiation|applicantActivity)"\s*:\s*)"[^"]*"/gi,
      '$1"[redacted]"'
    );
}

function getStructuredPreview(data: unknown): string {
  const serialized = JSON.stringify(data, (key, value) => {
    if (/token|xsrf|cookie|resume|topic|chat|negotiation|activity|streak/i.test(key)) {
      return '[redacted]';
    }
    return typeof value === 'string' ? redactSensitiveText(value) : value;
  });

  return redactSensitiveText(serialized ?? String(data)).substring(0, 200);
}

function previewText(text: string): string {
  return redactSensitiveText(text).replace(/\s+/g, ' ').trim().substring(0, 200);
}

function getErrorLogContext(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: redactSensitiveText(error.message),
      stack: error.stack ? redactSensitiveText(error.stack) : undefined,
    };
  }

  return { message: redactSensitiveText(String(error)) };
}

function hasQuickResponseQuestionnaireBlocker(data: any): boolean {
  return (
    data.responseStatus?.questionnaireRequired === true ||
    data.responseStatus?.questionnaire?.hasQuestions === true ||
    data.responseStatus?.questionnaire?.required === true ||
    data.questionnaireRequired === true
  );
}

function hasCoverLetterBlockerInText(text: string): boolean {
  return (
    text.includes('vacancy-response-letter-input') ||
    text.includes('textarea name="letter"') ||
    text.includes('Сопроводительное письмо') ||
    text.includes('cover_letter') ||
    text.includes('responseLetterRequired')
  );
}

function hasApplySuccessInText(text: string): boolean {
  return (
    text.includes('Отклик отправлен') ||
    text.includes('vacancy-response-success') ||
    text.includes('vacancy-response-submit-popup') ||
    text.includes('popup_success') ||
    text.includes('отклик отправлен')
  );
}

function hasQuestionnaireBlockerInText(text: string): boolean {
  return (
    text.includes('vacancy-response-questionnaire') ||
    text.includes('Работодатель просит ответить на вопросы') ||
    text.includes('ответить на вопросы работодателя')
  );
}

function hasAlreadyAppliedInText(text: string): boolean {
  return text.includes('Вы уже откликались') || text.includes('alreadyApplied');
}

function extractApplyErrorSignal(data: any): string | null {
  const candidates = [
    data?.error,
    data?.error_code,
    data?.reason,
    data?.responseStatus?.error,
    data?.responseStatus?.error_code,
    data?.responseStatus?.reason,
    data?.validation?.error,
    data?.validation?.error_code,
    data?.validation?.reason,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

export class BackendHTTPClient {
  private baseURL = 'https://api.hh.ru';
  private popupURL = 'https://hh.ru/applicant/vacancy_response/popup';
  private xsrfToken: string | null = null;
  private log: (...args: any[]) => void;

  constructor(deps: { log: (...args: any[]) => void }) {
    this.log = deps.log;
  }

  private isTrustedHHURL(value: string): boolean {
    try {
      const url = new URL(value, 'https://hh.ru');
      return url.protocol === 'https:'
        && (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru'));
    } catch {
      return false;
    }
  }

  private questionnaireURL(vacancyId: string, candidateUrl?: string): string {
    if (
      candidateUrl?.includes('/applicant/vacancy_response')
      && this.isTrustedHHURL(candidateUrl)
    ) {
      return new URL(candidateUrl, 'https://hh.ru').toString();
    }
    const params = new URLSearchParams({
      vacancyId,
      startedWithQuestion: 'false',
    });
    return `https://hh.ru/applicant/vacancy_response?${params.toString()}`;
  }

  async fetchQuestionnaireForm(
    vacancyId: string,
    candidateUrl?: string
  ): Promise<BackendQuestionnaireFormContract> {
    const url = this.questionnaireURL(vacancyId, candidateUrl);
    this.log('[BackendHTTP] fetchQuestionnaireForm', { vacancyId, url });
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': `https://hh.ru/vacancy/${vacancyId}`,
      },
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error('Сессия HH истекла — войдите снова');
    }
    if (!response.ok) {
      throw new Error(`HH не вернул анкету: HTTP ${response.status}`);
    }

    const html = await response.text();
    this.log('[BackendHTTP] questionnaire HTML received', {
      vacancyId,
      htmlLength: html.length,
      hasTaskFields: /name=["']task_/i.test(html),
    });
    return parseBackendQuestionnaireForm(html, response.url || url, vacancyId);
  }

  async submitQuestionnaire(
    vacancyId: string,
    resumeHash: string,
    answerPlan: AnswerPlan,
    candidateUrl?: string
  ): Promise<ApplyResponse> {
    const contract = await this.fetchQuestionnaireForm(vacancyId, candidateUrl);
    if (!this.isTrustedHHURL(contract.actionUrl)) {
      throw new Error('HH вернул недоверенный адрес отправки анкеты');
    }
    const body = buildBackendQuestionnaireBody(contract, answerPlan, resumeHash);
    await this.ensureXsrfToken();
    const headers: Record<string, string> = {
      'Accept': 'application/json,text/html;q=0.9',
      'Referer': contract.sourceUrl,
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (this.xsrfToken) headers['X-Xsrftoken'] = this.xsrfToken;

    this.log('[BackendHTTP] submitQuestionnaire', {
      vacancyId,
      url: contract.actionUrl,
      hasXsrfToken: Boolean(this.xsrfToken),
      bodyKeys: Array.from(body.keys()),
      answerCount: answerPlan.answers.length,
    });
    const response = await fetch(contract.actionUrl, {
      method: 'POST',
      credentials: 'include',
      headers,
      body,
    });
    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        outcome: 'auth_required',
        message: 'Authorization required',
      };
    }
    if (response.status >= 500) {
      return {
        success: false,
        outcome: 'server_error',
        message: `Server error: ${response.status}`,
      };
    }
    if (response.ok) return this.normalizeApplyHTTPResponse(response);
    const structuredError = await this.tryNormalizeErrorResponse(response);
    return structuredError ?? this.normalizeApplyHTTPResponse(response);
  }

  async fetchResumeContext(url: string): Promise<string> {
    if (!this.isTrustedHHURL(url)) throw new Error('Недоверенный адрес резюме');
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://hh.ru/applicant/resumes',
      },
    });
    if (!response.ok) throw new Error(`HH не вернул резюме: HTTP ${response.status}`);
    return extractBackendPageText(await response.text()).slice(0, 50_000);
  }

  /**
   * Получить список вакансий через HTML парсинг (как в Python)
   *
   * HH API блокирует автоматические запросы (403 Forbidden).
   * Используем hh.ru/search/vacancy вместо api.hh.ru/vacancies.
   */
  async fetchVacancies(_profile: Profile, page: number, resumeHash: string): Promise<APIVacancy[]> {
    const normalizedResumeHash = resumeHash.trim();
    if (!normalizedResumeHash) {
      throw new VacancySearchError('missing_resume', 'Vacancy search requires a selected resume hash');
    }

    const params = new URLSearchParams({
      items_on_page: '50',
      page: String(page),
      resume: normalizedResumeHash,
    });

    const url = `https://hh.ru/search/vacancy?${params.toString()}`;

    this.log('[BackendHTTP] fetchVacancies START (resume search)', {
      url: redactSensitiveText(url),
      strategy: 'resume_search',
      hasResumeHash: true,
      page,
    });

    try {
      const response = await fetch(url, {
        credentials: 'include',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Referer': 'https://hh.ru/',
        },
      });

      this.log('[BackendHTTP] fetchVacancies response', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        contentType: response.headers.get('content-type'),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.log('[BackendHTTP] fetchVacancies HTTP ERROR', {
          status: response.status,
          statusText: response.statusText,
          bodyPreview: previewText(errorText),
        });
        const code = response.status === 401 || response.status === 403 ? 'login_required' : 'http_error';
        throw new VacancySearchError(code, `Vacancy search failed with HTTP ${response.status}`);
      }

      const html = await response.text();
      const responseUrl = response.url || url;
      const responseUrlLower = responseUrl.toLowerCase();
      const htmlLower = html.toLowerCase();
      const hasVacancyCards = html.includes('data-qa="vacancy-serp__vacancy"');
      const hasSearchPage =
        html.includes('data-qa="vacancy-serp__results"') ||
        html.includes('data-qa="vacancy-serp"') ||
        html.includes('data-qa="vacancy-search-input"') ||
        html.includes('data-qa="search-input"');
      const hasLoginBlocker =
        responseUrlLower.includes('/login') ||
        responseUrlLower.includes('/signin') ||
        html.includes('data-qa="account-login-form"') ||
        /<form[^>]+action="[^"]*(?:login|signin)/i.test(html);
      const hasCaptchaBlocker =
        responseUrlLower.includes('captcha') ||
        html.includes('data-qa="captcha"') ||
        htmlLower.includes('g-recaptcha') ||
        htmlLower.includes('подтвердите, что вы не робот');

      this.log('[BackendHTTP] fetchVacancies HTML received', {
        htmlLength: html.length,
        responseUrl: redactSensitiveText(responseUrl),
        hasVacancyCards,
        hasSearchPage,
        hasLoginBlocker,
        hasCaptchaBlocker,
      });

      if (hasLoginBlocker || hasCaptchaBlocker) {
        const blocker = hasLoginBlocker ? 'login_required' : 'captcha_required';
        throw new VacancySearchError(blocker, `Vacancy search blocked: ${blocker}`);
      }

      const vacancies = this.parseVacanciesFromHTML(html);

      this.log('[BackendHTTP] fetchVacancies parsed', {
        totalCards: vacancies.length,
        withTitles: vacancies.filter(v => v.name).length,
        withCompanies: vacancies.filter(v => v.employer?.name).length,
      });

      if (vacancies.length === 0 && hasVacancyCards) {
        this.log('[BackendHTTP] WARNING: Found vacancy markers but parsed 0 cards', {
          htmlLength: html.length,
        });
        throw new VacancySearchError('contract_mismatch', 'Vacancy search parser contract mismatch');
      }

      if (vacancies.length === 0 && !hasSearchPage) {
        this.log('[BackendHTTP] WARNING: Unexpected vacancy search HTML', {
          htmlLength: html.length,
          responseUrl: redactSensitiveText(responseUrl),
        });
        throw new VacancySearchError('contract_mismatch', 'Vacancy search returned an unrecognized page');
      }

      return vacancies;
    } catch (error) {
      this.log('[BackendHTTP] fetchVacancies EXCEPTION', getErrorLogContext(error));
      if (error instanceof VacancySearchError) {
        throw error;
      }
      throw new VacancySearchError(
        'network_error',
        `Vacancy search request failed: ${(error as Error).message}`
      );
    }
  }

  /**
   * Парсинг вакансий из HTML (как в Python extract_vacancies_from_html)
   */
  private parseVacanciesFromHTML(html: string): APIVacancy[] {
    const vacancies: APIVacancy[] = [];
    const seenVacancyIds = new Set<string>();
    const cards = parseSearchResults(html);

    this.log('[BackendHTTP] parseVacanciesFromHTML', { cardsFound: cards.length });

    for (const card of cards) {
      if (!card.vacancyId || seenVacancyIds.has(card.vacancyId)) {
        continue;
      }

      seenVacancyIds.add(card.vacancyId);
      vacancies.push({
        id: card.vacancyId,
        name: card.title,
        employer: { name: card.company || 'Unknown' },
        alternate_url: card.url,
        area: { name: card.location || 'Unknown' },
      });
    }

    return vacancies;
  }

  /**
   * Preflight GET — проверка перед откликом + получение XSRF
   */
  async preflightApply(vacancyId: string, resumeHash: string): Promise<{
    canProceed: boolean;
    reason?: string;
    requiresTest?: boolean;
    requiresQuestionnaire?: boolean;
    requiresCoverLetter?: boolean;
    alreadyApplied?: boolean;
    letterMaxLength?: number;
    questionnaireUrl?: string;
  }> {
    const url = `${this.popupURL}?vacancyId=${vacancyId}&resumeHash=${resumeHash}&lux=true&alreadyApplied=false&isTest=no&withoutTest=no`;

    this.log('[BackendHTTP] preflightApply', {
      vacancyId,
      hasResumeHash: resumeHash.trim().length > 0,
      url: redactSensitiveText(url),
    });

    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://hh.ru/',
        },
      });

      this.log('[BackendHTTP] preflightApply response', { status: response.status, ok: response.ok });

      const xsrfToken = await getXsrfCookie();
      if (xsrfToken) {
        this.xsrfToken = xsrfToken;
        this.log('[BackendHTTP] XSRF token extracted', { hasXsrfToken: true });
      } else {
        this.log('[BackendHTTP] WARNING: No XSRF token found in cookies');
      }

      if (!response.ok) {
        this.log('[BackendHTTP] preflightApply failed', { status: response.status });
        if (response.status === 401 || response.status === 403) {
          return { canProceed: false, reason: 'auth_required' };
        }
        return { canProceed: false, reason: `http_${response.status}` };
      }

      const data = await response.json();

      this.log('[BackendHTTP] preflightApply data', { type: data.type });
      this.log('[BackendHTTP] preflightApply response summary', {
        summary: this.summarizeJSONResponse(data, response.status),
      });

      if (data.type === 'alreadyApplied') {
        return { canProceed: false, alreadyApplied: true, reason: 'already_applied' };
      }

      if (data.type === 'testRequired' || data.type === 'test-required') {
        return {
          canProceed: false,
          requiresTest: true,
          reason: 'test_required',
          questionnaireUrl: data.redirect_uri,
        };
      }

      if (data.type === 'questionnaireRequired') {
        return {
          canProceed: false,
          requiresQuestionnaire: true,
          reason: 'questionnaire_required',
          questionnaireUrl: data.redirect_uri,
        };
      }

      if (data.type === 'quickResponse') {
        if (data.responseStatus?.test?.hasTests === true) {
          return {
            canProceed: false,
            requiresTest: true,
            reason: 'test_required',
            questionnaireUrl: data.redirect_uri,
          };
        }

        if (hasQuickResponseQuestionnaireBlocker(data)) {
          return {
            canProceed: false,
            requiresQuestionnaire: true,
            reason: 'questionnaire_required',
            questionnaireUrl: data.redirect_uri,
          };
        }

        if (data.responseStatus?.shortVacancy?.['@responseLetterRequired'] === true) {
          return {
            canProceed: false,
            requiresCoverLetter: true,
            reason: 'cover_letter_required',
            letterMaxLength: data.responseStatus?.letterMaxLength,
          };
        }

        this.log('[BackendHTTP] preflightApply: quickResponse type, proceeding');
        return { canProceed: true };
      }

      if (data.type === 'modal') {
        if (data.responseStatus?.shortVacancy?.['@responseLetterRequired'] === true) {
          this.log('[BackendHTTP] preflightApply: modal cover letter required, blocking backend apply');
          return {
            canProceed: false,
            requiresCoverLetter: true,
            reason: 'cover_letter_required',
            letterMaxLength: data.responseStatus?.letterMaxLength,
          };
        }

        this.log('[BackendHTTP] preflightApply: modal type, proceeding with POST');
        return { canProceed: true };
      }

      this.log('[BackendHTTP] preflightApply: unknown type, blocking', { type: data.type });
      return { canProceed: false, reason: `unknown_preflight_type:${String(data.type)}` };
    } catch (error) {
      this.log('[BackendHTTP] preflightApply error', getErrorLogContext(error));
      return { canProceed: false, reason: 'network_error' };
    }
  }

  /**
   * POST отклик на вакансию
   */
  async applyToVacancy(
    vacancyId: string,
    context: HHApplyContext,
    coverLetter?: string
  ): Promise<ApplyResponse> {
    await this.ensureXsrfToken();
    this.log('[BackendHTTP] applyToVacancy', { vacancyId, hasXsrf: !!this.xsrfToken });
    const hasCoverLetter = !!coverLetter?.trim();
    const { body, bodyKeys, contentTypeMode } = this.buildApplyRequestBody(
      vacancyId,
      context,
      coverLetter
    );

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': context.referer || 'https://hh.ru/',
      'x-hhtmfrom': context.hhtmFrom || 'negotiation_list',
      'x-hhtmsource': context.hhtmSource || 'main',
    };

    if (!hasCoverLetter) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    // КРИТИЧНО: добавить XSRF token
    if (this.xsrfToken) {
      headers['X-Xsrftoken'] = this.xsrfToken;
    } else {
      this.log('[BackendHTTP] WARNING: No XSRF token available');
    }

    this.log('[BackendHTTP] applyToVacancy request', {
      url: this.popupURL,
      headerKeys: Object.keys(headers),
      hasXsrfToken: Boolean(this.xsrfToken),
      bodyKeys,
      contentTypeMode,
    });

    try {
      const response = await fetch(this.popupURL, {
        method: 'POST',
        credentials: 'include',
        headers,
        body,
      });

      this.log('[BackendHTTP] applyToVacancy response', {
        status: response.status,
        ok: response.ok,
        contentType: response.headers?.get?.('content-type') ?? null,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return {
            success: false,
            outcome: 'auth_required',
            message: 'Authorization required',
          };
        }

        if (response.status >= 500) {
          return {
            success: false,
            outcome: 'server_error',
            message: `Server error: ${response.status}`,
          };
        }

        const normalizedErrorResponse = await this.tryNormalizeErrorResponse(response);
        if (normalizedErrorResponse) {
          return normalizedErrorResponse;
        }

        return {
          success: false,
          outcome: 'error',
          message: `HTTP ${response.status}`,
        };
      }

      return await this.normalizeApplyHTTPResponse(response);
    } catch (error) {
      this.log('[BackendHTTP] applyToVacancy error', getErrorLogContext(error));
      return {
        success: false,
        outcome: 'error',
        error: (error as Error).message,
      };
    }
  }

  private buildApplyRequestBody(
    vacancyId: string,
    context: HHApplyContext,
    coverLetter?: string
  ): {
    body: FormData | string;
    bodyKeys: string[];
    contentTypeMode: 'multipart/form-data' | 'application/x-www-form-urlencoded';
  } {
    const hasCoverLetter = !!coverLetter?.trim();

    if (hasCoverLetter) {
      const body = new FormData();

      if (this.xsrfToken) {
        body.append('_xsrf', this.xsrfToken);
      }

      body.append('vacancy_id', vacancyId);
      body.append('resume_hash', context.resumeHash);
      body.append('ignore_postponed', String(context.ignorePostponed ?? true));
      body.append('incomplete', 'false');
      body.append('mark_applicant_visible_in_vacancy_country', 'false');
      body.append('country_ids', '[]');
      body.append('letter', coverLetter!.trim());
      body.append('lux', String(context.lux ?? true));
      body.append('withoutTest', 'no');
      body.append('hhtmFromLabel', context.hhtmFrom || '');
      body.append('hhtmSourceLabel', context.hhtmSource || '');

      return {
        body,
        bodyKeys: Array.from(body.keys()),
        contentTypeMode: 'multipart/form-data',
      };
    }

    const body = new URLSearchParams({
      resume_hash: context.resumeHash,
      vacancy_id: vacancyId,
      lux: String(context.lux ?? true),
      ignore_postponed: String(context.ignorePostponed ?? true),
      mark_applicant_visible_in_vacancy_country: 'false',
      country_ids: '[]',
    });

    return {
      body: body.toString(),
      bodyKeys: Array.from(body.keys()),
      contentTypeMode: 'application/x-www-form-urlencoded',
    };
  }

  private async tryNormalizeErrorResponse(response: Response): Promise<ApplyResponse | null> {
    try {
      const jsonResponse = typeof response.clone === 'function' ? response.clone() : response;
      const data = await jsonResponse.json();
      const preview = getStructuredPreview(data);
      const summary = this.summarizeJSONResponse(data, response.status);
      this.log('[BackendHTTP] applyToVacancy error body', {
        status: response.status,
        data: preview,
        summary,
      });

      const normalized = this.normalizeApplyResponse(data, response.status);
      if (normalized.outcome !== 'unknown') {
        this.logCoverLetterAttemptSummary(normalized, summary);
        return normalized;
      }

      const typeSuffix = typeof data?.type === 'string' ? ` type=${data.type}` : '';
      return {
        success: false,
        outcome: 'error',
        message: `HTTP ${response.status} (unrecognized apply response${typeSuffix})`,
        error: preview,
        diagnostics: summary,
      };
    } catch (error) {
      this.log('[BackendHTTP] applyToVacancy error body parse failed', {
        status: response.status,
        error: (error as Error).message,
      });
    }

    return null;
  }

  private async ensureXsrfToken(): Promise<void> {
    if (this.xsrfToken) {
      return;
    }

    try {
      const xsrfToken = await getXsrfCookie();
      if (xsrfToken) {
        this.xsrfToken = xsrfToken;
        this.log('[BackendHTTP] XSRF token extracted', {
          hasXsrfToken: true,
        });
      }
    } catch (error) {
      this.log('[BackendHTTP] Failed to get XSRF token', {
        error: (error as Error).message,
      });
    }
  }

  private async normalizeApplyHTTPResponse(response: Response): Promise<ApplyResponse> {
    try {
      const jsonResponse = typeof response.clone === 'function' ? response.clone() : response;
      const data = await jsonResponse.json();
      const summary = this.summarizeJSONResponse(data, response.status);

      this.log('[BackendHTTP] applyToVacancy response body', {
        data: getStructuredPreview(data),
        summary,
      });

      const normalized = this.normalizeApplyResponse(data, response.status);
      this.logCoverLetterAttemptSummary(normalized, summary);
      return normalized;
    } catch (error) {
      this.log('[BackendHTTP] applyToVacancy JSON parse failed, trying text fallback', {
        status: response.status,
        error: (error as Error).message,
      });
    }

    const text = await response.text();
    const preview = previewText(text);

    this.log('[BackendHTTP] applyToVacancy text fallback', {
      status: response.status,
      preview,
    });

    const normalized = this.normalizeApplyTextResponse(text, response.status);
    this.logCoverLetterAttemptSummary(normalized, normalized.diagnostics);
    return normalized;
  }

  private normalizeApplyTextResponse(text: string, status: number): ApplyResponse {
    const diagnostics = {
      responseKind: 'text' as const,
      status,
      preview: previewText(text),
    };

    if (hasAlreadyAppliedInText(text)) {
      return {
        success: false,
        outcome: 'already_applied',
        message: 'Already applied to this vacancy',
        diagnostics,
      };
    }

    if (hasQuestionnaireBlockerInText(text)) {
      return {
        success: false,
        outcome: 'questionnaire_required',
        message: 'Questionnaire required',
        diagnostics,
      };
    }

    if (hasApplySuccessInText(text)) {
      return {
        success: true,
        outcome: 'success',
        message: 'Application sent successfully (text fallback)',
        diagnostics,
      };
    }

    if (hasCoverLetterBlockerInText(text)) {
      return {
        success: false,
        outcome: 'cover_letter_required',
        message: 'Cover letter required',
        diagnostics,
      };
    }

    return {
      success: false,
      outcome: 'error',
      message: `HTTP ${status} (unrecognized text apply response)`,
      error: previewText(text),
      diagnostics,
    };
  }

  private normalizeApplyResponse(data: any, status?: number): ApplyResponse {
    const applyErrorSignal = extractApplyErrorSignal(data)?.toLowerCase();
    const diagnostics = this.summarizeJSONResponse(data, status);

    // Success signals - ВАЖНО: success это СТРОКА "true", не boolean!
    if (data.success === 'true' || data.topic_id || data.chat_id) {
      return {
        success: true,
        outcome: 'success',
        message: 'Application sent successfully',
        diagnostics,
      };
    }

    if (data.responseStatus?.negotiations?.topicList?.length > 0) {
      return {
        success: true,
        outcome: 'success',
        message: 'Application sent (negotiation started)',
        diagnostics,
      };
    }

    if (data.alreadyApplied === true || data.type === 'alreadyApplied') {
      return {
        success: false,
        outcome: 'already_applied',
        message: 'Already applied to this vacancy',
        diagnostics,
      };
    }

    if (data.responseStatus?.test?.hasTests === true) {
      return {
        success: false,
        outcome: 'test_required',
        message: 'Test completion required',
        diagnostics,
      };
    }

    if (data.type === 'testRequired' || data.type === 'test-required') {
      return {
        success: false,
        outcome: 'test_required',
        message: 'Test required',
        diagnostics,
      };
    }

    if (hasQuickResponseQuestionnaireBlocker(data)) {
      return {
        success: false,
        outcome: 'questionnaire_required',
        message: 'Questionnaire required',
        diagnostics,
      };
    }

    if (data.type === 'questionnaireRequired') {
      return {
        success: false,
        outcome: 'questionnaire_required',
        message: 'Questionnaire required',
        diagnostics,
      };
    }

    if (
      applyErrorSignal === 'letter-required' ||
      applyErrorSignal === 'letter_required'
    ) {
      return {
        success: false,
        outcome: 'cover_letter_required',
        message: 'Cover letter required (server validation)',
        diagnostics,
      };
    }

    if (data.responseStatus?.shortVacancy?.['@responseLetterRequired'] === true) {
      return {
        success: false,
        outcome: 'cover_letter_required',
        message: 'Cover letter required',
        diagnostics,
      };
    }

    this.log('[BackendHTTP] Unknown response', { preview: getStructuredPreview(data) });
    return {
      success: false,
      outcome: 'unknown',
      message: 'Unknown response',
      error: getStructuredPreview(data),
      diagnostics,
    };
  }

  private summarizeJSONResponse(data: any, status?: number): ApplyResponse['diagnostics'] {
    return {
      responseKind: 'json',
      status,
      keys: data && typeof data === 'object' ? Object.keys(data).sort().slice(0, 12) : [],
      type: typeof data?.type === 'string' ? data.type : undefined,
      errorSignal: extractApplyErrorSignal(data),
      preview: getStructuredPreview(data),
    };
  }

  private logCoverLetterAttemptSummary(
    applyResult: ApplyResponse,
    diagnostics?: ApplyResponse['diagnostics']
  ): void {
    if (!diagnostics) {
      return;
    }

    if (applyResult.outcome !== 'success' && applyResult.outcome !== 'cover_letter_required') {
      return;
    }

    this.log('[BackendHTTP] coverLetter apply summary', {
      outcome: applyResult.outcome,
      message: applyResult.message,
      diagnostics,
    });
  }

  /**
   * Проверить авторизацию через cookies
   *
   * Проверяем только наличие cookies, без HTTP запросов.
   * Если сессия протухла, это выяснится при первом реальном запросе (preflight/apply).
   */
  async checkAuth(): Promise<{ authorized: boolean }> {
    this.log('[BackendHTTP] checkAuth');

    try {
      const hhtoken = await chrome.cookies.get({ url: 'https://hh.ru', name: 'hhtoken' });
      const xsrf = await getXsrfCookie();

      this.log('[BackendHTTP] checkAuth cookies', { hasHhtoken: !!hhtoken, hasXsrf: !!xsrf });

      const authorized = !!(hhtoken || xsrf);

      this.log('[BackendHTTP] checkAuth result', { authorized });

      return { authorized };
    } catch (error) {
      this.log('[BackendHTTP] checkAuth error', getErrorLogContext(error));
      return { authorized: false };
    }
  }

  /**
   * Получить список резюме через API
   */
  async getMyResumes(): Promise<Array<{ hash: string; title: string; url: string }>> {
    const url = `${this.baseURL}/resumes/mine`;

    this.log('[BackendHTTP] getMyResumes', { url });

    try {
      const response = await fetch(url, {
        credentials: 'include',
        headers: {
          'User-Agent': 'HH-Orbit-Extension/1.0',
        },
      });

      if (!response.ok) {
        this.log('[BackendHTTP] getMyResumes failed', { status: response.status });
        return [];
      }

      const data = await response.json();

      const resumes = data.items.map((r: any) => ({
        hash: r.id,
        title: r.title,
        url: r.alternate_url,
      }));

      this.log('[BackendHTTP] getMyResumes result', { count: resumes.length });

      return resumes;
    } catch (error) {
      this.log('[BackendHTTP] getMyResumes error', getErrorLogContext(error));
      return [];
    }
  }

  async searchVacancies(profile: Profile): Promise<APIVacancy[]> {
    return this.fetchVacancies(profile, 0, profile.selectedResumeHash || '');
  }

  async getVacancyDetail(_vacancyId: string): Promise<any | null> {
    return null;
  }

  async checkSession(): Promise<{ success: boolean; blocker?: string }> {
    const authResult = await this.checkAuth();
    return {
      success: authResult.authorized,
      blocker: authResult.authorized ? undefined : 'login_required',
    };
  }
}
