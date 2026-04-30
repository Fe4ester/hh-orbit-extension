/**
 * Preflight Service
 *
 * Проверяет возможность отклика перед попыткой через GET запрос к HH.ru API
 * Детектит: тесты, уже откликнулись, модалки (cover letter, relocation warning)
 */

import { FileLogger } from '../utils/fileLogger';

export interface PreflightResult {
  canProceed: boolean;
  type: 'quickResponse' | 'modal' | 'test-required' | 'alreadyApplied' | 'error';

  // Модалки
  requiresCoverLetter: boolean;
  requiresRelocationConfirm: boolean;

  // Блокеры
  requiresTest: boolean;
  alreadyApplied: boolean;

  // Метаданные
  letterMaxLength?: number;
  relocationRegion?: string;
  error?: string;

  // Raw response для отладки
  raw?: any;
}

export class PreflightService {
  private xsrfToken: string | null = null;

  constructor(private log: (...args: any[]) => void) {
    this.log('[PreflightService] Initialized');
  }

  /**
   * Выполнить preflight check для вакансии
   */
  async check(vacancyId: string, resumeHash: string): Promise<PreflightResult> {
    FileLogger.log('service_worker', 'info', 'Preflight check START', { vacancyId, resumeHash });

    try {
      // Получить XSRF token
      await this.ensureXsrfToken();

      // GET запрос
      const url = `https://hh.ru/applicant/vacancy_response/popup?vacancyId=${vacancyId}&resumeHash=${resumeHash}&lux=true`;

      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://hh.ru/',
        },
      });

      if (!response.ok) {
        FileLogger.log('service_worker', 'error', 'Preflight HTTP error', {
          status: response.status,
          statusText: response.statusText
        });

        return {
          canProceed: false,
          type: 'error',
          requiresCoverLetter: false,
          requiresRelocationConfirm: false,
          requiresTest: false,
          alreadyApplied: false,
          error: `HTTP ${response.status}`,
        };
      }

      const data = await response.json();

      FileLogger.log('service_worker', 'info', 'Preflight response', {
        type: data.type,
        hasRelocationWarning: !!data.relocationWarning?.show,
        hasResponseLetterRequired: !!data.responseStatus?.shortVacancy?.['@responseLetterRequired'],
        hasTests: !!data.responseStatus?.test?.hasTests,
        alreadyApplied: !!data.responseStatus?.alreadyApplied,
        rawType: data.type,
      });

      // Парсинг ответа
      return this.parsePreflightResponse(data);

    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Preflight check failed', {
        error: (error as Error).message
      });

      return {
        canProceed: false,
        type: 'error',
        requiresCoverLetter: false,
        requiresRelocationConfirm: false,
        requiresTest: false,
        alreadyApplied: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Парсинг preflight ответа
   */
  private parsePreflightResponse(data: any): PreflightResult {
    const type = data.type;

    // 1. Already applied
    if (type === 'alreadyApplied' || data.responseStatus?.alreadyApplied === true) {
      FileLogger.log('service_worker', 'info', 'Preflight: already applied');
      return {
        canProceed: false,
        type: 'alreadyApplied',
        requiresCoverLetter: false,
        requiresRelocationConfirm: false,
        requiresTest: false,
        alreadyApplied: true,
        raw: data,
      };
    }

    // 2. Test required
    if (type === 'test-required' || type === 'testRequired' || data.responseStatus?.test?.hasTests === true) {
      FileLogger.log('service_worker', 'info', 'Preflight: test required');
      return {
        canProceed: false,
        type: 'test-required',
        requiresCoverLetter: false,
        requiresRelocationConfirm: false,
        requiresTest: true,
        alreadyApplied: false,
        raw: data,
      };
    }

    // 3. Quick response (может быть БЕЗ модалок, но может быть с relocation warning!)
    if (type === 'quickResponse') {
      // ВАЖНО: quickResponse может иметь тесты! Проверяем responseStatus
      const hasTests = data.responseStatus?.test?.hasTests === true;

      if (hasTests) {
        FileLogger.log('service_worker', 'info', 'Preflight: quickResponse but has tests');
        return {
          canProceed: false,
          type: 'test-required',
          requiresCoverLetter: false,
          requiresRelocationConfirm: false,
          requiresTest: true,
          alreadyApplied: false,
          raw: data,
        };
      }

      // ВАЖНО: quickResponse может иметь relocation warning!
      const requiresRelocationConfirm = data.relocationWarning?.show === true;
      const requiresCoverLetter = data.responseStatus?.shortVacancy?.['@responseLetterRequired'] === true;

      if (requiresRelocationConfirm || requiresCoverLetter) {
        FileLogger.log('service_worker', 'info', 'Preflight: quickResponse but has modal', {
          requiresRelocationConfirm,
          requiresCoverLetter
        });
        return {
          canProceed: true,
          type: 'modal',
          requiresCoverLetter,
          requiresRelocationConfirm,
          requiresTest: false,
          alreadyApplied: false,
          letterMaxLength: data.responseStatus?.letterMaxLength,
          relocationRegion: data.relocationWarning?.regionTrl,
          raw: data,
        };
      }

      FileLogger.log('service_worker', 'info', 'Preflight: quick response (no modals)');
      return {
        canProceed: true,
        type: 'quickResponse',
        requiresCoverLetter: false,
        requiresRelocationConfirm: false,
        requiresTest: false,
        alreadyApplied: false,
        raw: data,
      };
    }

    // 4. Modal (может быть cover letter и/или relocation warning)
    if (type === 'modal') {
      const requiresCoverLetter = data.responseStatus?.shortVacancy?.['@responseLetterRequired'] === true;
      const requiresRelocationConfirm = data.relocationWarning?.show === true;
      const letterMaxLength = data.responseStatus?.letterMaxLength;
      const relocationRegion = data.relocationWarning?.regionTrl;

      FileLogger.log('service_worker', 'info', 'Preflight: modal detected', {
        requiresCoverLetter,
        requiresRelocationConfirm,
        letterMaxLength,
        relocationRegion,
      });

      return {
        canProceed: true,
        type: 'modal',
        requiresCoverLetter,
        requiresRelocationConfirm,
        requiresTest: false,
        alreadyApplied: false,
        letterMaxLength,
        relocationRegion,
        raw: data,
      };
    }

    // Unknown type - считаем что можно попробовать
    FileLogger.log('service_worker', 'warn', 'Preflight: unknown type, assuming can proceed', { type });
    return {
      canProceed: true,
      type: 'modal', // Assume modal to be safe
      requiresCoverLetter: false,
      requiresRelocationConfirm: false,
      requiresTest: false,
      alreadyApplied: false,
      raw: data,
    };
  }

  /**
   * Получить XSRF token из cookies
   */
  private async ensureXsrfToken(): Promise<void> {
    if (this.xsrfToken) return;

    try {
      const xsrfCookie = await chrome.cookies.get({ url: 'https://hh.ru', name: '_xsrf' });
      if (xsrfCookie?.value) {
        this.xsrfToken = xsrfCookie.value;
        FileLogger.log('service_worker', 'info', 'XSRF token obtained', {
          tokenPreview: this.xsrfToken.substring(0, 8) + '...'
        });
      } else {
        FileLogger.log('service_worker', 'warn', 'XSRF token not found in cookies');
      }
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Failed to get XSRF token', {
        error: (error as Error).message
      });
    }
  }

  /**
   * Получить XSRF token для использования в POST запросах
   */
  getXsrfToken(): string | null {
    return this.xsrfToken;
  }
}
