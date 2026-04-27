// Manual action detection module

export type ManualActionType =
  | 'questionnaire'
  | 'test'
  | 'cover_letter_missing'
  | 'login_required'
  | 'captcha'
  | 'manual_review';

export interface ManualActionDetectionResult {
  requiresManualAction: boolean;
  type: ManualActionType | null;
  reasonCode: string;
  title?: string;
  details?: Record<string, any>;
}

/**
 * Detect if manual action is required based on DOM state
 */
export function detectManualActionNeed(doc: Document): ManualActionDetectionResult {
  // Questionnaire detection
  const questionnaireMarkers = [
    '[data-qa="vacancy-response-questionnaire"]',
    '[data-qa="task-body"]',
    '.vacancy-response-questionnaire',
    '[data-qa="vacancy-test"]',
  ];

  for (const selector of questionnaireMarkers) {
    const element = doc.querySelector(selector);
    if (element) {
      const text = element.textContent || '';
      const isTest = text.includes('тест') || text.includes('задание') || text.includes('задача');

      return {
        requiresManualAction: true,
        type: isTest ? 'test' : 'questionnaire',
        reasonCode: isTest ? 'test_required' : 'questionnaire_required',
        title: isTest ? 'Требуется выполнение теста' : 'Требуется заполнение анкеты',
        details: {
          detectedSelector: selector,
          textPreview: text.substring(0, 200),
        },
      };
    }
  }

  // Test/assessment text patterns
  const bodyText = doc.body.textContent || '';
  const testPatterns = [
    /выполните\s+тест/i,
    /пройдите\s+тест/i,
    /тестовое\s+задание/i,
    /выполнить\s+задание/i,
    /ответьте\s+на\s+вопросы/i,
  ];

  for (const pattern of testPatterns) {
    if (pattern.test(bodyText)) {
      return {
        requiresManualAction: true,
        type: 'test',
        reasonCode: 'test_required',
        title: 'Требуется выполнение теста',
        details: {
          detectedPattern: pattern.source,
        },
      };
    }
  }

  // Questionnaire text patterns
  const questionnairePatterns = [
    /заполните\s+анкету/i,
    /ответьте\s+на\s+вопросы\s+работодателя/i,
    /дополнительные\s+вопросы/i,
  ];

  for (const pattern of questionnairePatterns) {
    if (pattern.test(bodyText)) {
      return {
        requiresManualAction: true,
        type: 'questionnaire',
        reasonCode: 'questionnaire_required',
        title: 'Требуется заполнение анкеты',
        details: {
          detectedPattern: pattern.source,
        },
      };
    }
  }

  // Login required
  const loginMarkers = [
    '[data-qa="login-form"]',
    '[data-qa="account-signup"]',
    '.account-login-form',
  ];

  for (const selector of loginMarkers) {
    if (doc.querySelector(selector)) {
      return {
        requiresManualAction: true,
        type: 'login_required',
        reasonCode: 'login_required',
        title: 'Требуется авторизация',
        details: {
          detectedSelector: selector,
        },
      };
    }
  }

  // Captcha detection
  const captchaMarkers = [
    '[data-qa="captcha"]',
    '.captcha',
    '#captcha',
    'iframe[src*="captcha"]',
    'iframe[src*="recaptcha"]',
  ];

  for (const selector of captchaMarkers) {
    if (doc.querySelector(selector)) {
      return {
        requiresManualAction: true,
        type: 'captcha',
        reasonCode: 'captcha_required',
        title: 'Требуется прохождение капчи',
        details: {
          detectedSelector: selector,
        },
      };
    }
  }

  // Cover letter missing (textarea visible but empty)
  const coverLetterTextarea = doc.querySelector('[data-qa="vacancy-response-letter-input"]') as HTMLTextAreaElement;
  if (coverLetterTextarea && coverLetterTextarea.value.trim().length === 0) {
    const submitButton = doc.querySelector('[data-qa="vacancy-response-submit-button"]');
    if (submitButton && submitButton.hasAttribute('disabled')) {
      return {
        requiresManualAction: true,
        type: 'cover_letter_missing',
        reasonCode: 'cover_letter_required',
        title: 'Требуется сопроводительное письмо',
        details: {
          textareaEmpty: true,
          submitDisabled: true,
        },
      };
    }
  }

  // No manual action required
  return {
    requiresManualAction: false,
    type: null,
    reasonCode: 'no_manual_action',
  };
}
