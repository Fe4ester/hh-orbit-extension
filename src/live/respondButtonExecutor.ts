// Real DOM click executor for HH respond button

export interface ClickExecutionObservation {
  found: boolean;
  clicked: boolean;
  buttonText?: string;
  error?: string;
}

export interface PostClickObservation {
  modalOpened: boolean;
  loginRedirectVisible: boolean;
  alreadyAppliedVisible: boolean;
  externalApplyVisible: boolean;
  coverLetterUIVisible: boolean;
  questionnaireUIVisible: boolean;
  unknownState: boolean;
}

/**
 * Find respond button in vacancy page DOM
 */
export function findRespondButton(doc: Document): HTMLElement | null {
  // Try primary selector
  const button = doc.querySelector('[data-qa="vacancy-response-button"]') as HTMLElement;
  if (button) {
    return button;
  }

  // Fallback: search by class/text
  const buttons = Array.from(doc.querySelectorAll('button, a.bloko-button'));
  for (const btn of buttons) {
    const text = btn.textContent?.trim().toLowerCase() || '';
    if (text.includes('откликнуться') || text.includes('откликнуться')) {
      return btn as HTMLElement;
    }
  }

  return null;
}

/**
 * Click respond button and observe immediate result
 */
export function clickRespondButton(doc: Document): ClickExecutionObservation {
  const button = findRespondButton(doc);

  if (!button) {
    return {
      found: false,
      clicked: false,
      error: 'Respond button not found',
    };
  }

  const buttonText = button.textContent?.trim();

  try {
    // Check if button is disabled
    if (button.hasAttribute('disabled') || button.classList.contains('disabled')) {
      return {
        found: true,
        clicked: false,
        buttonText,
        error: 'Button is disabled',
      };
    }

    // Perform click
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
 * Observe post-click state (after short delay)
 */
export function observePostClickState(doc: Document): PostClickObservation {
  // Check for modal
  const modalOpened =
    !!doc.querySelector('[data-qa="vacancy-response-modal"]') ||
    !!doc.querySelector('.vacancy-response-popup') ||
    !!doc.querySelector('[role="dialog"]');

  // Check for login redirect
  const loginRedirectVisible =
    !!doc.querySelector('[data-qa="vacancy-response-login-required"]') ||
    doc.body.textContent?.includes('Войдите, чтобы откликнуться') ||
    false;

  // Check for already applied
  const alreadyAppliedVisible =
    !!doc.querySelector('[data-qa="vacancy-response-already-applied"]') ||
    doc.body.textContent?.includes('Вы уже откликались') ||
    false;

  // Check for external apply
  const externalApplyVisible =
    !!doc.querySelector('[data-qa="vacancy-response-external"]') ||
    doc.body.textContent?.includes('Откликнуться на сайте') ||
    false;

  // Check for cover letter UI
  const coverLetterUIVisible =
    !!doc.querySelector('[data-qa="vacancy-response-letter-toggle"]') ||
    !!doc.querySelector('[data-qa="vacancy-response-letter-input"]') ||
    doc.body.textContent?.includes('Сопроводительное письмо') ||
    false;

  // Check for questionnaire UI
  const questionnaireUIVisible =
    !!doc.querySelector('[data-qa="vacancy-response-questionnaire"]') ||
    doc.body.textContent?.includes('Работодатель просит ответить на вопросы') ||
    false;

  // Unknown state if no clear signals
  const unknownState =
    !modalOpened &&
    !loginRedirectVisible &&
    !alreadyAppliedVisible &&
    !externalApplyVisible &&
    !coverLetterUIVisible &&
    !questionnaireUIVisible;

  return {
    modalOpened,
    loginRedirectVisible,
    alreadyAppliedVisible,
    externalApplyVisible,
    coverLetterUIVisible,
    questionnaireUIVisible,
    unknownState,
  };
}
