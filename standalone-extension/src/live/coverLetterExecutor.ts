// Cover letter DOM executor

export interface CoverLetterUIObservation {
  visible: boolean;
  textareaFound: boolean;
  submitButtonFound: boolean;
  textLength?: number;
}

export interface FillCoverLetterResult {
  filled: boolean;
  textLength: number;
  error?: string;
}

/**
 * Detect cover letter UI in DOM
 */
export function detectCoverLetterUI(doc: Document): CoverLetterUIObservation {
  // Check for cover letter textarea
  const textarea =
    doc.querySelector('[data-qa="vacancy-response-letter-input"]') ||
    doc.querySelector('textarea[name="letter"]') ||
    doc.querySelector('textarea[placeholder*="письмо"]');

  const textareaFound = !!textarea;
  const textLength = textarea ? (textarea as HTMLTextAreaElement).value.length : undefined;

  // Check for submit button
  const submitButton =
    doc.querySelector('[data-qa="vacancy-response-submit-button"]') ||
    doc.querySelector('button[type="submit"]');

  const submitButtonFound = !!submitButton;

  // Visible if textarea found
  const visible = textareaFound;

  return {
    visible,
    textareaFound,
    submitButtonFound,
    textLength,
  };
}

/**
 * Fill cover letter textarea with text
 */
export function fillCoverLetter(doc: Document, text: string): FillCoverLetterResult {
  if (!text || text.trim().length === 0) {
    return {
      filled: false,
      textLength: 0,
      error: 'Cover letter text is empty',
    };
  }

  // Find textarea
  const textarea =
    (doc.querySelector('[data-qa="vacancy-response-letter-input"]') as HTMLTextAreaElement) ||
    (doc.querySelector('textarea[name="letter"]') as HTMLTextAreaElement) ||
    (doc.querySelector('textarea[placeholder*="письмо"]') as HTMLTextAreaElement);

  if (!textarea) {
    return {
      filled: false,
      textLength: 0,
      error: 'Cover letter textarea not found',
    };
  }

  try {
    // Set value
    textarea.value = text;

    // Trigger input event for React/Vue reactivity
    const inputEvent = new Event('input', { bubbles: true });
    textarea.dispatchEvent(inputEvent);

    // Trigger change event
    const changeEvent = new Event('change', { bubbles: true });
    textarea.dispatchEvent(changeEvent);

    return {
      filled: true,
      textLength: text.length,
    };
  } catch (error) {
    return {
      filled: false,
      textLength: 0,
      error: (error as Error).message,
    };
  }
}
