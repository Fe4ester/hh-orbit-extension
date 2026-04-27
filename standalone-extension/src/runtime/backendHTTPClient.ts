/**
 * Backend HTTP Client
 *
 * Pure HTTP requests to HH.ru using the same flow as Python implementation.
 * Uses browser cookies for authentication.
 */

import { Profile } from '../state/types';

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
  outcome: 'success' | 'already_applied' | 'test_required' | 'questionnaire_required' | 'auth_required' | 'server_error' | 'error' | 'unknown';
  message?: string;
  error?: string;
}

export class BackendHTTPClient {
  private baseURL = 'https://api.hh.ru';
  private popupURL = 'https://hh.ru/applicant/vacancy_response/popup';
  private xsrfToken: string | null = null;
  private log: (...args: any[]) => void;

  constructor(deps: { log: (...args: any[]) => void }) {
    this.log = deps.log;
  }

  /**
   * Получить список вакансий через HTML парсинг (как в Python)
   *
   * HH API блокирует автоматические запросы (403 Forbidden).
   * Используем hh.ru/search/vacancy вместо api.hh.ru/vacancies.
   */
  async fetchVacancies(profile: Profile, page = 0): Promise<APIVacancy[]> {
    const params = new URLSearchParams({
      text: profile.keywordsInclude.join(' '),
      items_on_page: '50',
      page: String(page),
    });

    if (profile.experience.length > 0) {
      params.append('experience', profile.experience.join(','));
    }

    if (profile.schedule.length > 0) {
      params.append('schedule', profile.schedule.join(','));
    }

    if (profile.employment.length > 0) {
      params.append('employment', profile.employment.join(','));
    }

    const url = `https://hh.ru/search/vacancy?${params.toString()}`;

    this.log('[BackendHTTP] fetchVacancies START (HTML parsing)', {
      url,
      keywords: profile.keywordsInclude,
      experience: profile.experience,
      schedule: profile.schedule,
      employment: profile.employment,
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
          bodyPreview: errorText.substring(0, 500),
        });
        return [];
      }

      const html = await response.text();

      this.log('[BackendHTTP] fetchVacancies HTML received', {
        htmlLength: html.length,
        hasVacancyCards: html.includes('data-qa="vacancy-serp__vacancy"'),
      });

      // Парсинг HTML
      const vacancies = this.parseVacanciesFromHTML(html);

      this.log('[BackendHTTP] fetchVacancies parsed', {
        totalCards: vacancies.length,
        withTitles: vacancies.filter(v => v.name).length,
        withCompanies: vacancies.filter(v => v.employer?.name).length,
      });

      // Fallback: если нашли маркеры, но не распарсили — логировать HTML
      if (vacancies.length === 0 && html.includes('data-qa="vacancy-serp__vacancy"')) {
        this.log('[BackendHTTP] WARNING: Found vacancy markers but parsed 0 cards', {
          htmlPreview: html.substring(0, 1000),
        });
      }

      return vacancies;
    } catch (error) {
      this.log('[BackendHTTP] fetchVacancies EXCEPTION', {
        message: (error as Error).message,
        stack: (error as Error).stack,
      });
      return [];
    }
  }

  /**
   * Парсинг вакансий из HTML (как в Python extract_vacancies_from_html)
   */
  private parseVacanciesFromHTML(html: string): APIVacancy[] {
    const vacancies: APIVacancy[] = [];

    // Split по карточкам вакансий
    const parts = html.split(/<div[^>]*data-qa="vacancy-serp__vacancy"[^>]*>/);
    const cards = parts.slice(1); // Первая часть — до карточек

    this.log('[BackendHTTP] parseVacanciesFromHTML', { cardsFound: cards.length });

    for (const cardHtml of cards) {
      try {
        // Extract ID
        const idMatch = cardHtml.match(/vacancy\/(\d+)/);
        if (!idMatch) continue;

        const id = idMatch[1];

        // Extract title
        const titleMatch = cardHtml.match(/data-qa="serp-item__title"[^>]*>([\s\S]*?)<\/a>/);
        const name = titleMatch ? this.stripHtml(titleMatch[1]) : `Vacancy ${id}`;

        // Extract company
        const companyMatch = cardHtml.match(/data-qa="vacancy-serp__vacancy-employer"[^>]*>([\s\S]*?)<\/a>/);
        const employerName = companyMatch ? this.stripHtml(companyMatch[1]) : 'Unknown';

        // Extract URL
        const urlMatch = cardHtml.match(/href="([^"]*\/vacancy\/\d+[^"]*)"/);
        let alternate_url: string;
        if (urlMatch) {
          const href = urlMatch[1];
          alternate_url = href.startsWith('http') ? href : `https://hh.ru${href}`;
        } else {
          alternate_url = `https://hh.ru/vacancy/${id}`;
        }

        // Extract salary (optional)
        let salary: { from?: number; to?: number; currency: string } | undefined;
        const salaryMatch = cardHtml.match(/data-qa="vacancy-serp__vacancy-compensation"[^>]*>([\s\S]*?)<\/span>/);
        if (salaryMatch) {
          const salaryText = this.stripHtml(salaryMatch[1]);
          salary = this.parseSalary(salaryText);
        }

        // Extract area (optional)
        const areaMatch = cardHtml.match(/data-qa="vacancy-serp__vacancy-address"[^>]*>([\s\S]*?)<\/div>/);
        const areaName = areaMatch ? this.stripHtml(areaMatch[1]) : 'Unknown';

        vacancies.push({
          id,
          name,
          employer: { name: employerName },
          alternate_url,
          salary,
          area: { name: areaName },
        });
      } catch (error) {
        this.log('[BackendHTTP] parseVacanciesFromHTML: card parse error', error);
        continue;
      }
    }

    return vacancies;
  }

  /**
   * Удалить HTML теги
   */
  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, '').trim();
  }

  /**
   * Парсинг зарплаты из текста
   */
  private parseSalary(text: string): { from?: number; to?: number; currency: string } | undefined {
    let currency = 'RUR';
    if (text.includes('₽')) currency = 'RUR';
    else if (text.includes('$')) currency = 'USD';
    else if (text.includes('€')) currency = 'EUR';

    // Extract numbers: "100 000" → 100000
    const numbers = [...text.matchAll(/(\d+(?:\s+\d+)*)/g)].map(m =>
      parseInt(m[1].replace(/\s+/g, ''), 10)
    );

    if (numbers.length === 0) return undefined;

    let from: number | undefined;
    let to: number | undefined;

    if (text.includes('от') && numbers.length >= 1) {
      from = numbers[0];
    } else if (text.includes('до') && numbers.length >= 1) {
      to = numbers[0];
    } else if (numbers.length === 2) {
      from = numbers[0];
      to = numbers[1];
    } else if (numbers.length === 1) {
      from = numbers[0];
    }

    return { from, to, currency };
  }

  /**
   * Preflight GET — проверка перед откликом + получение XSRF
   */
  async preflightApply(vacancyId: string, resumeHash: string): Promise<{
    canProceed: boolean;
    reason?: string;
    requiresTest?: boolean;
    requiresQuestionnaire?: boolean;
    alreadyApplied?: boolean;
  }> {
    const url = `${this.popupURL}?vacancyId=${vacancyId}&resumeHash=${resumeHash}&lux=true&alreadyApplied=false&isTest=no&withoutTest=no`;

    this.log('[BackendHTTP] preflightApply', { vacancyId, resumeHash, url });

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

      // Извлечь XSRF token из cookies через chrome.cookies API
      const xsrfCookie = await chrome.cookies.get({ url: 'https://hh.ru', name: '_xsrf' });
      if (xsrfCookie?.value) {
        this.xsrfToken = xsrfCookie.value;
        this.log('[BackendHTTP] XSRF token extracted', { token: this.xsrfToken.substring(0, 8) + '...' });
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
      this.log('[BackendHTTP] preflightApply FULL RESPONSE', { data: JSON.stringify(data) });

      // Проверить preflight response
      if (data.type === 'alreadyApplied') {
        return { canProceed: false, alreadyApplied: true, reason: 'already_applied' };
      }

      if (data.type === 'testRequired' || data.type === 'test-required') {
        return { canProceed: false, requiresTest: true, reason: 'test_required' };
      }

      if (data.type === 'questionnaireRequired') {
        return { canProceed: false, requiresQuestionnaire: true, reason: 'questionnaire_required' };
      }

      if (data.type === 'modal') {
        // Modal popup — может быть cover letter или другое
        // Попробовать POST anyway
        this.log('[BackendHTTP] preflightApply: modal type, proceeding with POST');
        return { canProceed: true };
      }

      // quickResponse или unknown — можно продолжать
      return { canProceed: true };
    } catch (error) {
      this.log('[BackendHTTP] preflightApply error', error);
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
    this.log('[BackendHTTP] applyToVacancy', { vacancyId, hasXsrf: !!this.xsrfToken });

    // Построить body (form-data)
    const body = new URLSearchParams({
      resume_hash: context.resumeHash,
      vacancy_id: vacancyId,
      lux: String(context.lux ?? true),
      ignore_postponed: String(context.ignorePostponed ?? true),
      letterRequired: String(!!coverLetter),
      mark_applicant_visible_in_vacancy_country: 'false',
      country_ids: '[]',
    });

    if (coverLetter) {
      body.append('cover_letter', coverLetter);
    }

    // Headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': context.referer || 'https://hh.ru/',
      'x-hhtmfrom': context.hhtmFrom || 'negotiation_list',
      'x-hhtmsource': context.hhtmSource || 'main',
    };

    // КРИТИЧНО: добавить XSRF token
    if (this.xsrfToken) {
      headers['X-Xsrftoken'] = this.xsrfToken;
    } else {
      this.log('[BackendHTTP] WARNING: No XSRF token available');
    }

    this.log('[BackendHTTP] applyToVacancy request', { url: this.popupURL, headers, bodyKeys: Array.from(body.keys()) });

    try {
      const response = await fetch(this.popupURL, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: body.toString(),
      });

      this.log('[BackendHTTP] applyToVacancy response', {
        status: response.status,
        ok: response.ok,
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

        return {
          success: false,
          outcome: 'error',
          message: `HTTP ${response.status}`,
        };
      }

      const data = await response.json();

      this.log('[BackendHTTP] applyToVacancy response body', { data: JSON.stringify(data).substring(0, 200) });

      // Нормализовать response
      return this.normalizeApplyResponse(data);
    } catch (error) {
      this.log('[BackendHTTP] applyToVacancy error', error);
      return {
        success: false,
        outcome: 'error',
        error: (error as Error).message,
      };
    }
  }

  private normalizeApplyResponse(data: any): ApplyResponse {
    // Success signals
    if (data.success === true || data.success === 'true') {
      return {
        success: true,
        outcome: 'success',
        message: 'Application sent successfully',
      };
    }

    if (data.topic_id || data.chat_id) {
      return {
        success: true,
        outcome: 'success',
        message: 'Application sent (topic created)',
      };
    }

    if (data.responseStatus?.negotiations?.topicList?.length > 0) {
      return {
        success: true,
        outcome: 'success',
        message: 'Application sent (negotiation started)',
      };
    }

    // Already applied
    if (data.alreadyApplied === true || data.type === 'alreadyApplied') {
      return {
        success: false,
        outcome: 'already_applied',
        message: 'Already applied to this vacancy',
      };
    }

    // Test/questionnaire required
    if (data.responseStatus?.test?.hasTests === true) {
      return {
        success: false,
        outcome: 'test_required',
        message: 'Test completion required',
      };
    }

    if (data.type === 'testRequired' || data.type === 'test-required') {
      return {
        success: false,
        outcome: 'test_required',
        message: 'Test required',
      };
    }

    if (data.type === 'questionnaireRequired') {
      return {
        success: false,
        outcome: 'questionnaire_required',
        message: 'Questionnaire required',
      };
    }

    // Unknown
    this.log('[BackendHTTP] Unknown response', data);
    return {
      success: false,
      outcome: 'unknown',
      message: 'Unknown response',
      error: JSON.stringify(data).substring(0, 200),
    };
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
      // Проверить наличие cookies через chrome.cookies API
      const hhtoken = await chrome.cookies.get({ url: 'https://hh.ru', name: 'hhtoken' });
      const xsrf = await chrome.cookies.get({ url: 'https://hh.ru', name: '_xsrf' });

      this.log('[BackendHTTP] checkAuth cookies', { hasHhtoken: !!hhtoken, hasXsrf: !!xsrf });

      // Если есть хотя бы один cookie — считаем авторизованным
      const authorized = !!(hhtoken || xsrf);

      this.log('[BackendHTTP] checkAuth result', { authorized });

      return { authorized };
    } catch (error) {
      this.log('[BackendHTTP] checkAuth error', error);
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
      this.log('[BackendHTTP] getMyResumes error', error);
      return [];
    }
  }

  // Legacy methods for compatibility
  async searchVacancies(profile: Profile): Promise<any[]> {
    return this.fetchVacancies(profile);
  }

  async getVacancyDetail(_vacancyId: string): Promise<any | null> {
    // Not needed for pure HTTP flow - preflight handles this
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
