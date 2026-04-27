import { describe, it, expect } from 'vitest';
import { detectRuntimeBlockers } from '../src/live/runtimeBlockerDetector';

describe('runtimeBlockerDetector', () => {
  describe('login detection', () => {
    it('detects login page by URL', () => {
      const html = '<html><body>Welcome</body></html>';
      const result = detectRuntimeBlockers(html, 'https://hh.ru/login');

      expect(result.loginRequired).toBe(true);
      expect(result.pageType).toBe('login');
      expect(result.reason).toContain('Login');
    });

    it('detects login form by data-qa', () => {
      const html = '<html><body><form data-qa="account-login-form"></form></body></html>';
      const result = detectRuntimeBlockers(html);

      expect(result.loginRequired).toBe(true);
    });

    it('does not detect login by weak text signal alone', () => {
      const html = '<html><body><p>Войдите, чтобы продолжить</p></body></html>';
      const result = detectRuntimeBlockers(html);

      // Weak signal alone - not enough for loginRequired
      expect(result.loginRequired).toBe(false);
    });

    it('does not detect login by password input alone', () => {
      const html = '<html><body><input type="password" /></body></html>';
      const result = detectRuntimeBlockers(html);

      // Weak signal alone - not enough for loginRequired
      expect(result.loginRequired).toBe(false);
    });

    it('detects login with strong signal: form action', () => {
      const html = '<html><body><form action="/login"></form></body></html>';
      const result = detectRuntimeBlockers(html);

      expect(result.loginRequired).toBe(true);
    });
  });

  describe('captcha detection', () => {
    it('detects captcha by data-qa', () => {
      const html = '<html><body><div data-qa="captcha"></div></body></html>';
      const result = detectRuntimeBlockers(html);

      expect(result.captchaRequired).toBe(true);
      expect(result.pageType).toBe('captcha');
      expect(result.reason).toContain('Captcha');
    });

    it('detects recaptcha', () => {
      const html = '<html><body><div class="g-recaptcha"></div></body></html>';
      const result = detectRuntimeBlockers(html);

      expect(result.captchaRequired).toBe(true);
    });

    it('detects captcha by text content', () => {
      const html = '<html><body><p>Подтвердите, что вы не робот</p></body></html>';
      const result = detectRuntimeBlockers(html);

      expect(result.captchaRequired).toBe(true);
    });

    it('detects antibot challenge', () => {
      const html = '<html><body><p>Проверка безопасности</p></body></html>';
      const result = detectRuntimeBlockers(html);

      expect(result.captchaRequired).toBe(true);
    });
  });

  describe('session degraded', () => {
    it('detects expired session', () => {
      const html = '<html><body><p>Сессия истекла</p></body></html>';
      const result = detectRuntimeBlockers(html);

      expect(result.sessionDegraded).toBe(true);
    });

    it('detects session expired in English', () => {
      const html = '<html><body><p>Session expired</p></body></html>';
      const result = detectRuntimeBlockers(html);

      expect(result.sessionDegraded).toBe(true);
    });
  });

  describe('no blockers', () => {
    it('returns clean state for normal page', () => {
      const html = '<html><body><h1>Vacancy Title</h1></body></html>';
      const result = detectRuntimeBlockers(html, 'https://hh.ru/vacancy/123');

      expect(result.loginRequired).toBe(false);
      expect(result.captchaRequired).toBe(false);
      expect(result.sessionDegraded).toBe(false);
      expect(result.pageType).toBe('vacancy');
    });

    it('returns clean state for applicant resumes page', () => {
      const html = '<html><body><div data-qa="resume-item"></div></body></html>';
      const result = detectRuntimeBlockers(html, 'https://hh.ru/applicant/resumes');

      expect(result.loginRequired).toBe(false);
      expect(result.captchaRequired).toBe(false);
      expect(result.sessionDegraded).toBe(false);
      expect(result.pageType).toBe('applicant_resumes');
    });

    it('returns clean state for search page', () => {
      const html = '<html><body><div class="vacancy-serp"></div></body></html>';
      const result = detectRuntimeBlockers(html, 'https://hh.ru/search/vacancy');

      expect(result.loginRequired).toBe(false);
      expect(result.captchaRequired).toBe(false);
      expect(result.sessionDegraded).toBe(false);
      expect(result.pageType).toBe('search');
    });
  });
});
