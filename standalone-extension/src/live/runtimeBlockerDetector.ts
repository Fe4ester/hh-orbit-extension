/**
 * Runtime blocker detection for session/login/captcha issues
 */

export interface RuntimeBlockerObservation {
  loginRequired: boolean;
  captchaRequired: boolean;
  sessionDegraded: boolean;
  pageType: string | null;
  reason?: string;
  debug?: {
    matchedMarkers: string[];
    bodyPreview: string;
    url: string;
  };
}

export function detectRuntimeBlockers(
  input: Document | string,
  url?: string
): RuntimeBlockerObservation {
  const doc = typeof input === 'string'
    ? new DOMParser().parseFromString(input, 'text/html')
    : input;

  const bodyText = doc.body?.textContent?.toLowerCase() || '';
  const urlLower = url?.toLowerCase() || '';
  const matchedMarkers: string[] = [];

  // Login detection - stricter
  const loginMarkers = {
    url_login: urlLower.includes('/login'),
    url_signin: urlLower.includes('/signin'),
    url_auth: urlLower.includes('/auth'),
    qa_login_form: !!doc.querySelector('[data-qa="account-login-form"]'),
    qa_login_button: !!doc.querySelector('[data-qa="login-button"]'),
    form_login: !!doc.querySelector('form[action*="login"]'),
    input_login: !!doc.querySelector('input[name="login"]'),
    input_password: !!doc.querySelector('input[type="password"]'),
    text_voydite: bodyText.includes('войдите'),
    text_avtorizuytes: bodyText.includes('авторизуйтесь'),
    text_trebuetsya_vhod: bodyText.includes('требуется вход'),
    text_neobhodimo_voyti: bodyText.includes('необходимо войти'),
  };

  // Count strong login signals
  const strongLoginSignals = [
    loginMarkers.url_login,
    loginMarkers.url_signin,
    loginMarkers.qa_login_form,
    loginMarkers.form_login,
  ].filter(Boolean).length;

  const loginRequired = strongLoginSignals >= 1;

  if (loginRequired) {
    Object.entries(loginMarkers).forEach(([key, value]) => {
      if (value) matchedMarkers.push(`login:${key}`);
    });
  }

  // Captcha/verification detection
  const captchaMarkers = {
    qa_captcha: !!doc.querySelector('[data-qa="captcha"]'),
    recaptcha: !!doc.querySelector('.g-recaptcha'),
    id_captcha: !!doc.querySelector('#captcha'),
    class_captcha: !!doc.querySelector('[class*="captcha"]'),
    id_captcha_any: !!doc.querySelector('[id*="captcha"]'),
    text_kapcha: bodyText.includes('капча'),
    text_captcha: bodyText.includes('captcha'),
    text_proverka: bodyText.includes('проверка безопасности'),
    text_robot: bodyText.includes('подтвердите, что вы не робот'),
    text_verify: bodyText.includes('verify you are human'),
    text_antibot: bodyText.includes('антибот'),
  };

  const captchaRequired = Object.values(captchaMarkers).some(Boolean);

  if (captchaRequired) {
    Object.entries(captchaMarkers).forEach(([key, value]) => {
      if (value) matchedMarkers.push(`captcha:${key}`);
    });
  }

  // Session degraded (soft warning)
  const sessionDegraded =
    bodyText.includes('сессия истекла') ||
    bodyText.includes('session expired') ||
    bodyText.includes('требуется повторный вход');

  if (sessionDegraded) {
    matchedMarkers.push('session_degraded');
  }

  // Page type detection
  let pageType: string | null = null;
  if (loginRequired) pageType = 'login';
  else if (captchaRequired) pageType = 'captcha';
  else if (urlLower.includes('/applicant/resumes')) pageType = 'applicant_resumes';
  else if (urlLower.includes('/vacancy/')) pageType = 'vacancy';
  else if (urlLower.includes('/search/vacancy')) pageType = 'search';
  else if (urlLower.includes('/resume/')) pageType = 'resume';

  // Reason
  let reason: string | undefined;
  if (loginRequired) reason = `Login page detected (${matchedMarkers.filter(m => m.startsWith('login:')).join(', ')})`;
  else if (captchaRequired) reason = `Captcha/verification required (${matchedMarkers.filter(m => m.startsWith('captcha:')).join(', ')})`;
  else if (sessionDegraded) reason = 'Session degraded';

  // Body preview
  const bodyPreview = bodyText.slice(0, 500).replace(/\s+/g, ' ').trim();

  return {
    loginRequired,
    captchaRequired,
    sessionDegraded,
    pageType,
    reason,
    debug: {
      matchedMarkers,
      bodyPreview,
      url: url || '',
    },
  };
}
