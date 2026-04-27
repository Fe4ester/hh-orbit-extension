// Vacancy detail page parser

export interface VacancyDetailObservation {
  vacancyId: string | null;
  title?: string;
  company?: string;
  hasRespondButton: boolean;
  respondButtonText?: string;
  requiresLogin: boolean;
  alreadyApplied: boolean;
  externalApply: boolean;
  archivedOrUnavailable: boolean;
  coverLetterHint: boolean;
  resumeSelectorVisible: boolean;
  questionnaireHint: boolean;
  contactHiddenOrBlocked?: boolean;
}

export type PreflightCode =
  | 'can_apply'
  | 'login_required'
  | 'resume_required'
  | 'cover_letter_required'
  | 'external_apply'
  | 'already_applied'
  | 'archived_or_unavailable'
  | 'questionnaire_possible'
  | 'unknown';

export type PreflightSeverity = 'info' | 'warn' | 'error' | 'success';

export interface PreflightClassification {
  code: PreflightCode;
  message: string;
  severity: PreflightSeverity;
}

/**
 * Check if HTML is a vacancy detail page
 */
export function isVacancyDetailPage(html: string): boolean {
  return (
    html.includes('vacancy-title') ||
    html.includes('vacancy-company-name') ||
    html.includes('vacancy-response-button')
  );
}

/**
 * Parse vacancy detail page
 */
export function parseVacancyDetail(
  html: string,
  url?: string
): VacancyDetailObservation {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Extract vacancy ID from URL
  let vacancyId: string | null = null;
  if (url) {
    const match = url.match(/\/vacancy\/(\d+)/);
    vacancyId = match ? match[1] : null;
  }

  // Extract title
  const titleEl = doc.querySelector('.vacancy-title');
  const title = titleEl?.textContent?.trim();

  // Extract company
  const companyEl = doc.querySelector('.vacancy-company-name');
  const company = companyEl?.textContent?.trim();

  // Check respond button
  const respondButton = doc.querySelector('[data-qa="vacancy-response-button"]');
  const hasRespondButton = !!respondButton;
  const respondButtonText = respondButton?.textContent?.trim();

  // Check login required
  const requiresLogin =
    html.includes('Войдите, чтобы откликнуться') ||
    html.includes('vacancy-response-login-required');

  // Check already applied
  const alreadyApplied =
    html.includes('Вы уже откликались') ||
    html.includes('vacancy-response-already-applied') ||
    respondButtonText?.includes('Вы откликнулись') ||
    false;

  // Check external apply
  const externalApply =
    html.includes('Откликнуться на сайте') ||
    html.includes('vacancy-response-external') ||
    respondButtonText?.includes('на сайте') ||
    false;

  // Check archived/unavailable
  const archivedOrUnavailable =
    html.includes('Вакансия архивирована') ||
    html.includes('Вакансия недоступна') ||
    html.includes('vacancy-archived');

  // Check cover letter hint
  const coverLetterHint =
    html.includes('Сопроводительное письмо') ||
    html.includes('vacancy-response-letter-toggle');

  // Check resume selector
  const resumeSelectorVisible = !!doc.querySelector('[data-qa="vacancy-response-resume-select"]');

  // Check questionnaire hint
  const questionnaireHint =
    html.includes('Работодатель просит ответить на вопросы') ||
    html.includes('vacancy-response-questionnaire');

  // Check contact hidden/blocked
  const contactHiddenOrBlocked =
    html.includes('Контакты скрыты') || html.includes('vacancy-contacts-hidden');

  return {
    vacancyId,
    title,
    company,
    hasRespondButton,
    respondButtonText,
    requiresLogin,
    alreadyApplied,
    externalApply,
    archivedOrUnavailable,
    coverLetterHint,
    resumeSelectorVisible,
    questionnaireHint,
    contactHiddenOrBlocked,
  };
}

/**
 * Classify preflight state
 */
export function classifyPreflight(
  observation: VacancyDetailObservation
): PreflightClassification {
  // Archived/unavailable
  if (observation.archivedOrUnavailable) {
    return {
      code: 'archived_or_unavailable',
      message: 'Вакансия архивирована или недоступна',
      severity: 'error',
    };
  }

  // Already applied
  if (observation.alreadyApplied) {
    return {
      code: 'already_applied',
      message: 'Вы уже откликались на эту вакансию',
      severity: 'info',
    };
  }

  // Login required
  if (observation.requiresLogin) {
    return {
      code: 'login_required',
      message: 'Требуется авторизация',
      severity: 'error',
    };
  }

  // External apply
  if (observation.externalApply) {
    return {
      code: 'external_apply',
      message: 'Отклик через внешний сайт',
      severity: 'warn',
    };
  }

  // Resume required (no selector visible)
  if (!observation.resumeSelectorVisible && observation.hasRespondButton) {
    return {
      code: 'resume_required',
      message: 'Требуется выбор резюме',
      severity: 'warn',
    };
  }

  // Cover letter hint
  if (observation.coverLetterHint) {
    return {
      code: 'cover_letter_required',
      message: 'Рекомендуется сопроводительное письмо',
      severity: 'info',
    };
  }

  // Questionnaire possible
  if (observation.questionnaireHint) {
    return {
      code: 'questionnaire_possible',
      message: 'Возможна анкета от работодателя',
      severity: 'info',
    };
  }

  // Can apply
  if (observation.hasRespondButton) {
    return {
      code: 'can_apply',
      message: 'Готово к отклику',
      severity: 'success',
    };
  }

  // Unknown
  return {
    code: 'unknown',
    message: 'Не удалось определить состояние',
    severity: 'warn',
  };
}
