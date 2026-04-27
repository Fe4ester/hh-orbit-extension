/**
 * Live Mode Content Script
 *
 * Выполняет DOM манипуляции в контексте страницы HH.ru
 * Получает команды от service worker через chrome.runtime.sendMessage
 */

// Import DOM executors
import { clickRespondButton, observePostClickState } from '../live/respondButtonExecutor';
import { detectCoverLetterUI } from '../live/coverLetterExecutor';
import { observePostSubmitState } from '../live/finalSubmitExecutor';
import { parseSearchResults } from '../live/searchResultsParser';
import { FileLogger } from '../utils/fileLogger';

console.log('[LiveContent] Content script loaded');
FileLogger.log('content_script', 'info', 'Content script loaded', { url: window.location.href });

// Close HH.ru modals on page load
window.addEventListener('load', () => {
  setTimeout(() => {
    // Close "Why didn't you apply?" modal
    const closeButtons = document.querySelectorAll('[data-qa="bloko-modal-close"]');
    closeButtons.forEach(btn => (btn as HTMLElement).click());

    // Close other popups
    const overlays = document.querySelectorAll('[data-qa="bloko-modal"]');
    overlays.forEach(overlay => {
      const close = overlay.querySelector('button[aria-label="Закрыть"]');
      if (close) (close as HTMLElement).click();
    });
  }, 1000);
});

// Message listener
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const runId = message.runId || 'unknown';
  const vacancyId = message.vacancyId || 'unknown';

  try {
    switch (message.type) {
      case 'PING':
        sendResponse({ pong: true });
        break;

      case 'GET_HTML':
        const html = document.documentElement.outerHTML;
        sendResponse({ html });
        break;

      case 'GET_VACANCY_LINKS': {
        const html = document.documentElement.outerHTML;
        const cards = parseSearchResults(html);
        sendResponse({ cards });
        break;
      }

      case 'CLICK_APPLY_BUTTON': {
        const result = clickRespondButton(document);
        sendResponse(result);
        break;
      }

      case 'OBSERVE_POST_CLICK': {
        const observation = observePostClickState(document);
        sendResponse(observation);
        break;
      }

      case 'DETECT_COVER_LETTER_UI': {
        const observation = detectCoverLetterUI(document);
        sendResponse(observation);
        break;
      }

      case 'FILL_COVER_LETTER': {
        const text = message.text || '';

        // Try to find textarea in modal first
        const modal =
          document.querySelector('[data-qa="bloko-modal"]') ||
          document.querySelector('[role="dialog"]');

        let textarea = null;
        if (modal) {
          textarea =
            modal.querySelector('[data-qa="vacancy-response-letter-input"]') ||
            modal.querySelector('textarea[name="letter"]') ||
            modal.querySelector('textarea[placeholder*="письмо"]') ||
            modal.querySelector('textarea[placeholder*="Сопроводительное"]') ||
            modal.querySelector('textarea');
        }

        // Fallback to page-level search
        if (!textarea) {
          textarea =
            document.querySelector('[data-qa="vacancy-response-letter-input"]') ||
            document.querySelector('textarea[name="letter"]') ||
            document.querySelector('textarea[placeholder*="письмо"]') ||
            document.querySelector('textarea');
        }

        if (!textarea) {
          sendResponse({ filled: false, error: 'Textarea not found' });
          break;
        }

        try {
          (textarea as HTMLTextAreaElement).value = text;

          // Trigger events
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));

          sendResponse({ filled: true, textLength: text.length });
        } catch (error) {
          sendResponse({ filled: false, error: (error as Error).message });
        }
        break;
      }

      case 'CLICK_SUBMIT': {
        // Try to find submit button in modal first
        const modal =
          document.querySelector('[data-qa="bloko-modal"]') ||
          document.querySelector('[role="dialog"]');

        let submitButton = null;
        if (modal) {
          submitButton =
            modal.querySelector('[data-qa="vacancy-response-submit-button"]') ||
            modal.querySelector('[data-qa="bloko-modal-submit"]') ||
            modal.querySelector('button[type="submit"]') ||
            Array.from(modal.querySelectorAll('button')).find(btn =>
              btn.textContent?.includes('Откликнуться') ||
              btn.textContent?.includes('Отправить')
            );
        }

        // Fallback to page-level search
        if (!submitButton) {
          submitButton =
            document.querySelector('[data-qa="vacancy-response-submit-button"]') ||
            document.querySelector('button[type="submit"]');
        }

        if (!submitButton) {
          sendResponse({ clicked: false, error: 'Button not found' });
          break;
        }

        try {
          (submitButton as HTMLElement).click();
          sendResponse({ clicked: true });
        } catch (error) {
          sendResponse({ clicked: false, error: (error as Error).message });
        }
        break;
      }

      case 'OBSERVE_POST_SUBMIT': {
        const observation = observePostSubmitState(document);
        sendResponse(observation);
        break;
      }

      case 'CHECK_TEST_REQUIRED': {
        // Check for actual questionnaire UI elements
        const hasQuestionnaireUI = !!document.querySelector('[data-qa="vacancy-response-questionnaire"]');

        // Check for explicit test/questionnaire text
        const bodyText = document.body.textContent || '';
        const hasTestText =
          bodyText.includes('Работодатель просит ответить на вопросы') ||
          bodyText.includes('тестовое задание') ||
          bodyText.includes('Пройти тест');

        // IMPORTANT: startedWithQuestion=true is NOT a test indicator
        // It just means the response flow started, not that there's a questionnaire
        // Only consider it a test if we have actual UI elements or explicit text

        const testRequired = hasQuestionnaireUI || hasTestText;

        FileLogger.log('content_script', 'info', 'TEST_CLASSIFICATION', {
          runId,
          vacancyId,
          testRequired,
          hasQuestionnaireUI,
          hasTestText,
          url: window.location.href,
        });

        sendResponse({ testRequired });
        break;
      }

      case 'CHECK_APPLY_BUTTON_STATE': {
        const { vacancyId } = message;

        // Find card by vacancyId
        const card = document.querySelector(`[data-vacancy-id="${vacancyId}"]`) ||
                      Array.from(document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]'))
                        .find(c => {
                          const link = c.querySelector('a[href*="/vacancy/"]');
                          return link?.getAttribute('href')?.includes(`/vacancy/${vacancyId}`);
                        });

        if (!card) {
          sendResponse({ alreadyApplied: false, error: 'Card not found' });
          break;
        }

        // Check button text
        const button = card.querySelector('[data-qa="vacancy-serp__vacancy_response"]');
        const buttonText = button?.textContent || '';
        const alreadyApplied =
          buttonText.includes('Отклик отправлен') ||
          buttonText.includes('Вы откликнулись') ||
          button?.hasAttribute('disabled');

        sendResponse({ alreadyApplied, buttonText });
        break;
      }

      case 'HANDLE_ANY_MODAL': {
        // Universal modal handler - handles ANY modal with "Откликнуться" button
        const modal =
          document.querySelector('[data-qa="bloko-modal"]') ||
          document.querySelector('[role="dialog"]') ||
          document.querySelector('.bloko-modal');

        if (!modal) {
          sendResponse({ handled: false });
          break;
        }

        // Check for textarea (cover letter)
        const textarea = modal.querySelector('textarea');
        let hadTextarea = false;

        if (textarea) {
          hadTextarea = true;

          // Get cover letter from message or use default
          const coverLetterText = message.coverLetter || 'Здравствуйте! Заинтересован в данной вакансии.';

          try {
            (textarea as HTMLTextAreaElement).value = coverLetterText;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (error) {
            FileLogger.log('content_script', 'error', 'COVER_LETTER_FILL_ERROR', {
              runId,
              vacancyId,
              error: (error as Error).message
            });
          }
        }

        // Find and click button
        const buttons = Array.from(modal.querySelectorAll('button'));

        // Priority 1: Exact match for confirmation modals
        let respondButton = buttons.find(btn => {
          const text = btn.textContent?.trim() || '';
          return text === 'Всё равно откликнуться' ||
                 text === 'Откликнуться' ||
                 text === 'Отправить';
        });

        // Priority 2: Contains match (case-insensitive)
        if (!respondButton) {
          respondButton = buttons.find(btn => {
            const text = btn.textContent?.trim().toLowerCase() || '';
            return text.includes('откликнуться') ||
                   text.includes('отправить') ||
                   text.includes('подтвердить');
          });
        }

        // Priority 3: data-qa attributes
        if (!respondButton) {
          const qaButton = modal.querySelector('[data-qa="vacancy-response-submit-button"]') ||
                           modal.querySelector('[data-qa="bloko-modal-submit"]') ||
                           modal.querySelector('button[data-qa*="submit"]');
          if (qaButton) respondButton = qaButton as HTMLButtonElement;
        }

        // Priority 4: Last button (usually confirm)
        if (!respondButton && buttons.length > 0) {
          respondButton = buttons[buttons.length - 1];
        }

        if (respondButton) {
          FileLogger.log('content_script', 'info', 'MODAL_BUTTON_CLICKED', {
            runId,
            vacancyId,
            buttonText: respondButton.textContent?.trim(),
            hadTextarea
          });

          (respondButton as HTMLElement).click();

          sendResponse({
            handled: true,
            hadTextarea,
            buttonClicked: respondButton.textContent?.trim()
          });
        } else {
          FileLogger.log('content_script', 'warn', 'MODAL_BUTTON_NOT_FOUND', {
            runId,
            vacancyId,
            hadTextarea
          });
          sendResponse({ handled: false, hadTextarea });
        }
        break;
      }

      case 'CHECK_MODAL_TYPE': {
        // Check what type of modal is open
        const modal =
          document.querySelector('[data-qa="bloko-modal"]') ||
          document.querySelector('[role="dialog"]') ||
          document.querySelector('.bloko-modal');

        if (!modal) {
          sendResponse({ hasModal: false });
          break;
        }

        const modalText = modal.textContent || '';

        // Check for textarea
        const textarea =
          modal.querySelector('[data-qa="vacancy-response-letter-input"]') ||
          modal.querySelector('textarea[name="letter"]') ||
          modal.querySelector('textarea[placeholder*="письмо"]') ||
          modal.querySelector('textarea[placeholder*="Сопроводительное"]') ||
          modal.querySelector('textarea');

        // Cover letter ONLY if textarea exists AND text mentions letter
        const hasCoverLetter =
          !!textarea && (
            modalText.includes('Сопроводительное письмо') ||
            modalText.includes('сопроводительное письмо')
          );

        // Confirmation modal - if NOT cover letter AND has confirmation text
        const hasConfirmation =
          !hasCoverLetter && (
            modalText.includes('другой стране') ||
            modalText.includes('находится в другой стране') ||
            modalText.includes('расположена в другой стране') ||
            modalText.includes('Всё равно откликнуться') ||
            modalText.includes('Вы уверены') ||
            modalText.includes('Подтвердите') ||
            // Fallback: modal with button but no textarea
            (!textarea && modal.querySelectorAll('button').length >= 1 && modalText.includes('Откликнуться'))
          );

        sendResponse({
          hasModal: true,
          hasCoverLetter,
          hasConfirmation,
          modalText: modalText.substring(0, 200)
        });
        break;
      }

      case 'CLICK_MODAL_CONFIRM': {
        // Find and click confirmation button in modal
        const modal =
          document.querySelector('[data-qa="bloko-modal"]') ||
          document.querySelector('[role="dialog"]');

        if (!modal) {
          sendResponse({ clicked: false, error: 'Modal not found' });
          break;
        }

        const buttons = Array.from(modal.querySelectorAll('button'));

        const confirmButton =
          modal.querySelector('[data-qa="bloko-modal-submit"]') ||
          modal.querySelector('[data-qa="vacancy-response-submit-popup"]') ||
          modal.querySelector('button[data-qa*="submit"]') ||
          buttons.find(btn => {
            const text = btn.textContent?.trim() || '';
            return (
              text === 'Откликнуться' ||
              text === 'Всё равно откликнуться' ||
              text === 'Подтвердить' ||
              text === 'Да' ||
              text === 'Продолжить' ||
              text.includes('откликнуться')
            );
          }) ||
          buttons[buttons.length - 1]; // Fallback: last button (usually confirm)

        if (confirmButton) {
          (confirmButton as HTMLElement).click();
          sendResponse({ clicked: true });
        } else {
          sendResponse({ clicked: false, error: 'Button not found' });
        }
        break;
      }

      case 'GO_BACK': {
        window.history.back();
        sendResponse({ success: true });
        break;
      }

      case 'CLICK_NEXT_PAGE': {
        // Найти кнопку "Следующая страница"
        const nextButton =
          document.querySelector('[data-qa="pager-next"]') ||
          document.querySelector('a[rel="next"]') ||
          Array.from(document.querySelectorAll('a')).find(a =>
            a.textContent?.trim().toLowerCase().includes('дальше') ||
            a.textContent?.trim().toLowerCase().includes('следующая')
          );

        if (nextButton) {
          (nextButton as HTMLElement).click();
          sendResponse({ success: true, clicked: true });
        } else {
          sendResponse({ success: false, clicked: false, error: 'Next page button not found' });
        }
        break;
      }

      // V2 handlers
      case 'VALIDATE_VACANCY': {
        const { vacancyId } = message;

        const allCards = document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]');
        let exists = false;
        let alreadyApplied = false;

        for (const c of allCards) {
          const link = c.querySelector('a[href*="/vacancy/"]');
          const href = link?.getAttribute('href') || '';

          if (href.includes(`/vacancy/${vacancyId}`)) {
            exists = true;

            const btn = c.querySelector('[data-qa="vacancy-serp__vacancy_response"]');
            const btnText = btn?.textContent?.trim() || '';

            if (
              btnText.includes('Отклик отправлен') ||
              btnText.includes('Вы откликнулись') ||
              btnText.includes('Приглашение') ||
              btnText.includes('Отказ') ||
              btn?.hasAttribute('disabled')
            ) {
              alreadyApplied = true;
            }
            break;
          }
        }

        sendResponse({ exists, alreadyApplied });
        break;
      }

      case 'CLICK_RESPOND_BUTTON': {
        const { vacancyId } = message;

        const allCards = document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]');
        let card = null;

        for (const c of allCards) {
          const link = c.querySelector('a[href*="/vacancy/"]');
          const href = link?.getAttribute('href') || '';

          if (href.includes(`/vacancy/${vacancyId}`)) {
            card = c;
            break;
          }
        }

        if (!card) {
          sendResponse({ success: false });
          break;
        }

        // Scroll
        (card as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'center' });

        // Find button
        const respondButton = card.querySelector('[data-qa="vacancy-serp__vacancy_response"]') ||
                              card.querySelector('button[data-qa*="response"]') ||
                              Array.from(card.querySelectorAll('button')).find(btn =>
                                btn.textContent?.includes('Откликнуться')
                              );

        if (!respondButton) {
          sendResponse({ success: false });
          break;
        }

        // Click
        (respondButton as HTMLElement).click();
        sendResponse({ success: true });
        break;
      }

      case 'CHECK_MODAL_EXISTS': {
        const modal = document.querySelector('[data-qa="bloko-modal"]') ||
                      document.querySelector('[role="dialog"]') ||
                      document.querySelector('.bloko-modal');

        const exists = !!modal;
        sendResponse({ exists });
        break;
      }

      case 'HANDLE_MODAL': {
        const { coverLetter } = message;

        const modal = document.querySelector('[data-qa="bloko-modal"]') ||
                      document.querySelector('[role="dialog"]') ||
                      document.querySelector('.bloko-modal');

        if (!modal) {
          sendResponse({ handled: false });
          break;
        }

        // Fill textarea if exists
        const textarea = modal.querySelector('textarea');
        if (textarea) {
          (textarea as HTMLTextAreaElement).value = coverLetter;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Find and click button
        const buttons = Array.from(modal.querySelectorAll('button'));
        const respondButton = buttons.find(btn => {
          const text = btn.textContent?.trim() || '';
          return text === 'Всё равно откликнуться' || text === 'Откликнуться' || text === 'Отправить';
        }) || buttons.find(btn => {
          const text = btn.textContent?.trim().toLowerCase() || '';
          return text.includes('откликнуться') || text.includes('отправить') || text.includes('подтвердить');
        }) || buttons[buttons.length - 1];

        if (respondButton) {
          (respondButton as HTMLElement).click();
          sendResponse({ handled: true });
        } else {
          sendResponse({ handled: false });
        }
        break;
      }

      case 'CLICK_RESPOND_ON_CARD': {
        const { vacancyId } = message;

        FileLogger.log('content_script', 'info', 'CLICK_RESPOND_START', {
          runId,
          vacancyId,
          step: 'card_search'
        });

        // Find card
        const allCards = document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]');
        let card = null;

        for (const c of allCards) {
          const link = c.querySelector('a[href*="/vacancy/"]');
          const href = link?.getAttribute('href') || '';

          if (href.includes(`/vacancy/${vacancyId}`)) {
            // Check button before assigning
            const btn = c.querySelector('[data-qa="vacancy-serp__vacancy_response"]');
            const btnText = btn?.textContent?.trim() || '';

            if (
              btnText.includes('Отклик отправлен') ||
              btnText.includes('Вы откликнулись') ||
              btnText.includes('Приглашение') ||
              btnText.includes('Отказ') ||
              btn?.hasAttribute('disabled')
            ) {
              FileLogger.log('content_script', 'info', 'CLICK_RESPOND_RESULT', {
                runId,
                vacancyId,
                outcome: 'already_applied',
                buttonText: btnText
              });
              sendResponse({
                success: true,
                outcome: 'already_applied',
                message: 'Already applied',
              });
              return;
            }

            card = c;
            break;
          }
        }

        if (!card) {
          FileLogger.log('content_script', 'error', 'CLICK_RESPOND_RESULT', {
            runId,
            vacancyId,
            outcome: 'card_not_found',
            totalCards: allCards.length
          });
          sendResponse({
            success: false,
            outcome: 'button_not_found',
            message: `Card not found`,
          });
          return;
        }

        // Scroll (instant, no animation)
        (card as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'center' });

        // Find button
        const respondButton = card.querySelector('[data-qa="vacancy-serp__vacancy_response"]') ||
                              card.querySelector('button[data-qa*="response"]') ||
                              Array.from(card.querySelectorAll('button')).find(btn =>
                                btn.textContent?.includes('Откликнуться')
                              );

        if (!respondButton) {
          FileLogger.log('content_script', 'error', 'CLICK_RESPOND_RESULT', {
            runId,
            vacancyId,
            outcome: 'button_not_found'
          });
          sendResponse({
            success: false,
            outcome: 'button_not_found',
            message: 'Button not found',
          });
          return;
        }

        // Click
        (respondButton as HTMLElement).click();

        FileLogger.log('content_script', 'info', 'CLICK_RESPOND_RESULT', {
          runId,
          vacancyId,
          outcome: 'clicked'
        });

        sendResponse({
          success: true,
          outcome: 'clicked',
          message: 'Button clicked',
        });
        break;
      }

      case 'OBSERVE_RESPOND_MODAL': {
        // Check if modal is open
        const modal = document.querySelector('[data-qa="vacancy-response-modal"]') ||
                      document.querySelector('[role="dialog"]') ||
                      document.querySelector('.bloko-modal');

        if (!modal) {
          sendResponse({
            modalOpen: false,
          });
          break;
        }

        // Check modal content
        const alreadyApplied = !!modal.querySelector('[data-qa="vacancy-response-already-applied"]') ||
                               modal.textContent?.includes('Вы уже откликались');

        const questionnaireRequired = !!modal.querySelector('[data-qa="vacancy-response-questionnaire"]') ||
                                      modal.textContent?.includes('Работодатель просит ответить на вопросы');

        const coverLetterRequired = !!modal.querySelector('[data-qa="vacancy-response-letter-toggle"]') ||
                                    !!modal.querySelector('[data-qa="vacancy-response-letter-input"]');

        const submitButton = modal.querySelector('[data-qa="vacancy-response-submit-button"]') ||
                             modal.querySelector('button[type="submit"]');

        sendResponse({
          modalOpen: true,
          alreadyApplied,
          questionnaireRequired,
          coverLetterRequired,
          submitButtonFound: !!submitButton,
        });
        break;
      }

      case 'CLICK_SUBMIT_IN_MODAL': {
        const modal = document.querySelector('[data-qa="vacancy-response-modal"]') ||
                      document.querySelector('[role="dialog"]');

        if (!modal) {
          sendResponse({ clicked: false, error: 'Modal not found' });
          break;
        }

        const submitButton = modal.querySelector('[data-qa="vacancy-response-submit-button"]') ||
                             modal.querySelector('button[type="submit"]');

        if (!submitButton) {
          sendResponse({ clicked: false, error: 'Submit button not found' });
          break;
        }

        try {
          (submitButton as HTMLElement).click();
          FileLogger.log('content_script', 'info', 'Clicked submit in modal');
          sendResponse({ clicked: true });
        } catch (error) {
          sendResponse({ clicked: false, error: (error as Error).message });
        }
        break;
      }

      case 'OBSERVE_POST_SUBMIT_MODAL': {
        const successVisible = !!document.querySelector('[data-qa="vacancy-response-submit-popup"]') ||
                               !!document.querySelector('[data-qa="vacancy-response-success"]') ||
                               document.body.textContent?.includes('Отклик отправлен');

        sendResponse({
          successVisible,
        });
        break;
      }

      case 'CLOSE_RESPOND_MODAL': {
        const modal = document.querySelector('[data-qa="vacancy-response-modal"]') ||
                      document.querySelector('[role="dialog"]') ||
                      document.querySelector('.bloko-modal');

        if (!modal) {
          sendResponse({ closed: false, error: 'Modal not found' });
          break;
        }

        // Find close button
        const closeButton = modal.querySelector('[data-qa="bloko-modal-close"]') ||
                            modal.querySelector('button[aria-label="Закрыть"]') ||
                            modal.querySelector('.bloko-modal-close-button') ||
                            modal.querySelector('button.close') ||
                            Array.from(modal.querySelectorAll('button')).find(btn =>
                              btn.textContent?.includes('×') ||
                              btn.textContent?.includes('Закрыть')
                            );

        if (closeButton) {
          try {
            (closeButton as HTMLElement).click();
            FileLogger.log('content_script', 'info', 'Clicked close button');
            sendResponse({ closed: true });
          } catch (error) {
            sendResponse({ closed: false, error: (error as Error).message });
          }
        } else {
          // Fallback: press Escape
          try {
            const escapeEvent = new KeyboardEvent('keydown', {
              key: 'Escape',
              code: 'Escape',
              keyCode: 27,
              bubbles: true,
            });
            document.dispatchEvent(escapeEvent);

            FileLogger.log('content_script', 'info', 'Pressed Escape to close modal');
            sendResponse({ closed: true });
          } catch (error) {
            sendResponse({ closed: false, error: (error as Error).message });
          }
        }
        break;
      }

      default:
        // Not for us - let it pass to background
        return false;
    }
  } catch (error) {
    console.error('[LiveContent] Error handling message', error);
    sendResponse({ error: (error as Error).message });
  }

  // Return true to indicate async response
  return true;
});

// Auto-close HH.ru modals
setInterval(() => {
  try {
    // Close "Why didn't you apply?" modal
    const closeButtons = document.querySelectorAll('[data-qa="bloko-modal-close"]');
    if (closeButtons.length > 0) {
      closeButtons.forEach(btn => (btn as HTMLElement).click());
    }

    // Close other popups
    const overlays = document.querySelectorAll('[data-qa="bloko-modal"]');
    overlays.forEach(overlay => {
      const close = overlay.querySelector('button[aria-label="Закрыть"]');
      if (close) {
        (close as HTMLElement).click();
      }
    });
  } catch (error) {
    // Ignore errors
  }
}, 2000);
