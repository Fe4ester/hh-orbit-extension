// Final submit DOM executor

export interface FinalSubmitClickObservation {
  found: boolean;
  clicked: boolean;
  buttonText?: string;
  error?: string;
}

export interface PostSubmitObservation {
  successVisible: boolean;
  alreadyAppliedVisible: boolean;
  loginRequiredVisible: boolean;
  questionnaireVisible: boolean;
  coverLetterStillVisible: boolean;
  errorVisible: boolean;
  errorText?: string;
  unknownState: boolean;
}

/**
 * Find final submit button in modal
 */
export function findFinalSubmitButton(doc: Document): HTMLElement | null {
  // Primary: data-qa submit button
  const submitButton = doc.querySelector('[data-qa="vacancy-response-submit-button"]');
  if (submitButton) return submitButton as HTMLElement;

  // Fallback: button[type="submit"] in modal
  const modal = doc.querySelector('[data-qa="vacancy-response-popup"]') ||
                doc.querySelector('[role="dialog"]') ||
                doc.querySelector('.bloko-modal');

  if (modal) {
    const submitInModal = modal.querySelector('button[type="submit"]');
    if (submitInModal) return submitInModal as HTMLElement;
  }

  // Last resort: any submit button
  const anySubmit = doc.querySelector('button[type="submit"]');
  return anySubmit as HTMLElement | null;
}

/**
 * Click final submit button
 */
export function clickFinalSubmitButton(doc: Document): FinalSubmitClickObservation {
  const button = findFinalSubmitButton(doc);

  if (!button) {
    return {
      found: false,
      clicked: false,
      error: 'Final submit button not found',
    };
  }

  const buttonText = button.textContent?.trim() || '';

  try {
    // Check if button is disabled
    if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') {
      return {
        found: true,
        clicked: false,
        buttonText,
        error: 'Submit button is disabled',
      };
    }

    // Click
    button.click();

    return {
      found: true,
      clicked: true,
      buttonText,
    };
  } catch (error) {
    return {
      found: true,
      clicked: false,
      buttonText,
      error: (error as Error).message,
    };
  }
}

/**
 * Observe post-submit state
 */
export function observePostSubmitState(doc: Document): PostSubmitObservation {
  // Success signals
  const successVisible = !!(
    doc.querySelector('[data-qa="vacancy-response-submit-popup"]') ||
    doc.querySelector('[data-qa="vacancy-response-success"]') ||
    doc.querySelector('.vacancy-response-popup_success') ||
    doc.body.textContent?.includes('Отклик отправлен') ||
    doc.body.textContent?.includes('Ваш отклик успешно отправлен')
  );

  // Already applied
  const alreadyAppliedVisible = !!(
    doc.querySelector('[data-qa="vacancy-response-already-applied"]') ||
    doc.body.textContent?.includes('Вы уже откликались') ||
    doc.body.textContent?.includes('уже отправлен')
  );

  // Login required
  const loginRequiredVisible = !!(
    doc.querySelector('[data-qa="login-form"]') ||
    doc.querySelector('[data-qa="account-signup"]') ||
    doc.body.textContent?.includes('Войдите') ||
    doc.body.textContent?.includes('Авторизуйтесь')
  );

  // Questionnaire still visible
  const questionnaireVisible = !!(
    doc.querySelector('[data-qa="vacancy-response-questionnaire"]') ||
    doc.querySelector('[data-qa="task-body"]') ||
    doc.querySelector('.vacancy-response-questionnaire')
  );

  // Cover letter still visible
  const coverLetterStillVisible = !!(
    doc.querySelector('[data-qa="vacancy-response-letter-input"]') ||
    doc.querySelector('textarea[name="letter"]')
  );

  // Error signals
  const errorElement = doc.querySelector('[data-qa="vacancy-response-error"]') ||
                       doc.querySelector('.bloko-notification_error') ||
                       doc.querySelector('.vacancy-response-error');

  const errorVisible = !!errorElement;
  const errorText = errorElement?.textContent?.trim();

  // Unknown state if no clear signal
  const unknownState = !(
    successVisible ||
    alreadyAppliedVisible ||
    loginRequiredVisible ||
    questionnaireVisible ||
    errorVisible
  );

  return {
    successVisible,
    alreadyAppliedVisible,
    loginRequiredVisible,
    questionnaireVisible,
    coverLetterStillVisible,
    errorVisible,
    errorText,
    unknownState,
  };
}
