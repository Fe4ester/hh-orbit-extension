// Manual action detection module

import type { ManualActionType } from '../state/types';

export interface ManualActionDetectionResult {
  requiresManualAction: boolean;
  type: ManualActionType | null;
  reasonCode: string;
  title?: string;
  details?: Record<string, any>;
}

type DetectedManualActionType = Exclude<ManualActionType, 'manual_review'>;

interface DetectionConfig {
  type: DetectedManualActionType;
  reasonCode: string;
  title: string;
}

const questionnaireMarkers = [
  '[data-qa="vacancy-response-questionnaire"]',
  '[data-qa="task-body"]',
  '.vacancy-response-questionnaire',
  '[data-qa="vacancy-test"]',
];

const testPatterns = [
  /выполните\s+тест/i,
  /пройдите\s+тест/i,
  /тестовое\s+задание/i,
  /выполнить\s+задание/i,
  /ответьте\s+на\s+вопросы/i,
];

const questionnairePatterns = [
  /заполните\s+анкету/i,
  /ответьте\s+на\s+вопросы\s+работодателя/i,
  /дополнительные\s+вопросы/i,
];

const loginMarkers = [
  '[data-qa="login-form"]',
  '[data-qa="account-signup"]',
  '.account-login-form',
];

const captchaMarkers = [
  '[data-qa="captcha"]',
  '.captcha',
  '#captcha',
  'iframe[src*="captcha"]',
  'iframe[src*="recaptcha"]',
];

function createManualActionResult(
  config: DetectionConfig,
  details: Record<string, any>
): ManualActionDetectionResult {
  return {
    requiresManualAction: true,
    ...config,
    details,
  };
}

function findManualActionByPattern(
  bodyText: string,
  patterns: RegExp[],
  config: DetectionConfig
): ManualActionDetectionResult | null {
  for (const pattern of patterns) {
    if (pattern.test(bodyText)) {
      return createManualActionResult(config, { detectedPattern: pattern.source });
    }
  }

  return null;
}

function findManualActionBySelector(
  doc: Document,
  markers: string[],
  config: DetectionConfig
): ManualActionDetectionResult | null {
  for (const selector of markers) {
    if (doc.querySelector(selector)) {
      return createManualActionResult(config, { detectedSelector: selector });
    }
  }

  return null;
}

function detectQuestionnaireOrTestBySelector(doc: Document): ManualActionDetectionResult | null {
  for (const selector of questionnaireMarkers) {
    const element = doc.querySelector(selector);
    if (element) {
      const text = element.textContent || '';
      const isTest = text.includes('тест') || text.includes('задание') || text.includes('задача');
      const config: DetectionConfig = isTest
        ? {
            type: 'test',
            reasonCode: 'test_required',
            title: 'Требуется выполнение теста',
          }
        : {
            type: 'questionnaire',
            reasonCode: 'questionnaire_required',
            title: 'Требуется заполнение анкеты',
          };

      return createManualActionResult(config, {
        detectedSelector: selector,
        textPreview: text.substring(0, 200),
      });
    }
  }

  return null;
}

function detectMissingCoverLetter(doc: Document): ManualActionDetectionResult | null {
  const coverLetterTextarea = doc.querySelector(
    '[data-qa="vacancy-response-letter-input"]'
  ) as HTMLTextAreaElement;

  if (coverLetterTextarea && coverLetterTextarea.value.trim().length === 0) {
    const submitButton = doc.querySelector('[data-qa="vacancy-response-submit-button"]');
    if (!submitButton?.hasAttribute('disabled')) {
      return null;
    }

    return createManualActionResult(
      {
        type: 'cover_letter_missing',
        reasonCode: 'cover_letter_required',
        title: 'Требуется сопроводительное письмо',
      },
      { textareaEmpty: true, submitDisabled: true }
    );
  }

  return null;
}

/**
 * Detect if manual action is required based on DOM state
 */
export function detectManualActionNeed(doc: Document): ManualActionDetectionResult {
  const selectorResult = detectQuestionnaireOrTestBySelector(doc);
  if (selectorResult) return selectorResult;

  const bodyText = doc.body.textContent || '';
  const testResult = findManualActionByPattern(bodyText, testPatterns, {
    type: 'test',
    reasonCode: 'test_required',
    title: 'Требуется выполнение теста',
  });
  if (testResult) return testResult;

  const questionnaireResult = findManualActionByPattern(bodyText, questionnairePatterns, {
    type: 'questionnaire',
    reasonCode: 'questionnaire_required',
    title: 'Требуется заполнение анкеты',
  });
  if (questionnaireResult) return questionnaireResult;

  const loginResult = findManualActionBySelector(doc, loginMarkers, {
    type: 'login_required',
    reasonCode: 'login_required',
    title: 'Требуется авторизация',
  });
  if (loginResult) return loginResult;

  const captchaResult = findManualActionBySelector(doc, captchaMarkers, {
    type: 'captcha',
    reasonCode: 'captcha_required',
    title: 'Требуется прохождение капчи',
  });
  if (captchaResult) return captchaResult;

  const coverLetterResult = detectMissingCoverLetter(doc);
  if (coverLetterResult) return coverLetterResult;

  return {
    requiresManualAction: false,
    type: null,
    reasonCode: 'no_manual_action',
  };
}
