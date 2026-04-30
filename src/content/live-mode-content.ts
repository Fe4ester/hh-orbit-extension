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
import { fillAndSubmitAdvancedSearchForm } from '../live/advancedSearchFormFiller';
import { FileLogger } from '../utils/fileLogger';

console.log('[LiveContent] Content script loaded');
FileLogger.log('content_script', 'info', 'Content script loaded', { url: window.location.href });

// Close HH.ru modals on page load
window.addEventListener('load', () => {
  setTimeout(() => {
    // Close "Why didn't you apply?" modal - both old and new systems
    const closeButtons = document.querySelectorAll('[data-qa="bloko-modal-close"]');
    closeButtons.forEach(btn => (btn as HTMLElement).click());

    // Close old bloko modals
    const blokoOverlays = document.querySelectorAll('[data-qa="bloko-modal"]');
    blokoOverlays.forEach(overlay => {
      const close = overlay.querySelector('button[aria-label="Закрыть"]');
      if (close) (close as HTMLElement).click();
    });

    // Close new Magritte modals (but NOT apply modals)
    const magritteModals = document.querySelectorAll('[class*="magritte-mobile-container"], [class*="magritte-overlay"]');
    magritteModals.forEach(modal => {
      const modalText = modal.textContent || '';
      // Skip apply-related modals
      if (
        modalText.includes('Откликнуться') ||
        modalText.includes('откликнуться') ||
        modalText.includes('Всё равно откликнуться') ||
        modal.querySelector('textarea')
      ) {
        return;
      }
      const close = modal.querySelector('button[aria-label="Закрыть"]') || modal.querySelector('[class*="close"]');
      if (close) (close as HTMLElement).click();
    });
  }, 1000);
});

// Message listener
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[LiveContent] Message received', { type: message.type });
  FileLogger.log('content_script', 'debug', 'Message received', { type: message.type });

  try {
    switch (message.type) {
      case 'PING':
        FileLogger.log('content_script', 'debug', 'PING received');
        sendResponse({ pong: true });
        break;

      case 'GET_HTML':
        FileLogger.log('content_script', 'info', 'GET_HTML received');
        const html = document.documentElement.outerHTML;
        FileLogger.log('content_script', 'info', 'GET_HTML response', { length: html.length });
        sendResponse({ html });
        break;

      case 'GET_VACANCY_LINKS': {
        const html = document.documentElement.outerHTML;
        const cards = parseSearchResults(html);
        console.log('[LiveContent] Parsed vacancy cards', { count: cards.length });
        FileLogger.log('content_script', 'info', 'GET_VACANCY_LINKS', { count: cards.length });
        sendResponse({ cards });
        break;
      }

      case 'CLICK_APPLY_BUTTON': {
        const result = clickRespondButton(document);
        console.log('[LiveContent] Click apply button result', result);
        FileLogger.log('content_script', 'info', 'CLICK_APPLY_BUTTON', result);
        sendResponse(result);
        break;
      }

      case 'OBSERVE_POST_CLICK': {
        const observation = observePostClickState(document);
        console.log('[LiveContent] Post-click observation', observation);
        FileLogger.log('content_script', 'info', 'OBSERVE_POST_CLICK', observation);
        sendResponse(observation);
        break;
      }

      case 'DETECT_COVER_LETTER_UI': {
        const observation = detectCoverLetterUI(document);
        console.log('[LiveContent] Cover letter UI observation', observation);
        FileLogger.log('content_script', 'info', 'DETECT_COVER_LETTER_UI', {
          ...observation,
          url: window.location.href
        });
        sendResponse(observation);
        break;
      }

      case 'FILL_COVER_LETTER': {
        const text = message.text || '';

        // Try to find textarea in modal first
        const modal =
          document.querySelector('[class*="magritte-mobile-container"]') ||
          document.querySelector('[class*="magritte-overlay"]') ||
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
          FileLogger.log('content_script', 'error', 'Textarea not found');
          sendResponse({ filled: false, error: 'Textarea not found' });
          break;
        }

        try {
          (textarea as HTMLTextAreaElement).value = text;

          // Trigger events
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));

          FileLogger.log('content_script', 'info', 'Cover letter filled', {
            length: text.length,
            inModal: !!modal
          });

          sendResponse({ filled: true, textLength: text.length });
        } catch (error) {
          FileLogger.log('content_script', 'error', 'Fill failed', {
            error: (error as Error).message
          });
          sendResponse({ filled: false, error: (error as Error).message });
        }
        break;
      }

      case 'CLICK_SUBMIT': {
        // Try to find submit button in modal first
        const modal =
          document.querySelector('[class*="magritte-mobile-container"]') ||
          document.querySelector('[class*="magritte-overlay"]') ||
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
          FileLogger.log('content_script', 'error', 'Submit button not found');
          sendResponse({ clicked: false, error: 'Button not found' });
          break;
        }

        try {
          (submitButton as HTMLElement).click();
          FileLogger.log('content_script', 'info', 'Submit clicked', {
            inModal: !!modal,
            buttonText: submitButton.textContent
          });
          sendResponse({ clicked: true });
        } catch (error) {
          FileLogger.log('content_script', 'error', 'Click failed', {
            error: (error as Error).message
          });
          sendResponse({ clicked: false, error: (error as Error).message });
        }
        break;
      }

      case 'OBSERVE_POST_SUBMIT': {
        const observation = observePostSubmitState(document);
        console.log('[LiveContent] Post-submit observation', observation);
        FileLogger.log('content_script', 'info', 'OBSERVE_POST_SUBMIT', observation);
        sendResponse(observation);
        break;
      }

      case 'CHECK_TEST_REQUIRED': {
        const testRequired =
          !!document.querySelector('[data-qa="vacancy-response-questionnaire"]') ||
          !!document.querySelector('[data-qa="vacancy-response-letter-toggle"]') ||
          document.body.textContent?.includes('Работодатель просит ответить на вопросы') ||
          document.body.textContent?.includes('тестовое задание') ||
          document.body.textContent?.includes('Пройти тест') ||
          window.location.href.includes('startedWithQuestion=true') ||
          false;

        console.log('[LiveContent] Test required check', {
          testRequired,
          url: window.location.href,
          hasQuestionnaire: !!document.querySelector('[data-qa="vacancy-response-questionnaire"]')
        });

        FileLogger.log('content_script', 'info', 'CHECK_TEST_REQUIRED', {
          testRequired,
          url: window.location.href
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

        FileLogger.log('content_script', 'info', 'Button state', {
          vacancyId,
          buttonText,
          alreadyApplied
        });

        sendResponse({ alreadyApplied, buttonText });
        break;
      }

      case 'HANDLE_ANY_MODAL': {
        FileLogger.log('content_script', 'info', 'Handle modal start');

        // Universal modal handler - handles ANY modal with "Откликнуться" button
        // Supports sequential modals: relocation warning → cover letter
        const modal =
          document.querySelector('[class*="magritte-mobile-container"]') ||
          document.querySelector('[class*="magritte-overlay"]') ||
          document.querySelector('[data-qa="bloko-modal"]') ||
          document.querySelector('[role="dialog"]') ||
          document.querySelector('.bloko-modal');

        if (!modal) {
          FileLogger.log('content_script', 'debug', 'Modal not found');
          sendResponse({ handled: false });
          break;
        }

        const modalText = modal.textContent || '';
        FileLogger.log('content_script', 'info', 'Modal found', {
          textPreview: modalText.substring(0, 300)
        });

        // Check for textarea (cover letter)
        const textarea = modal.querySelector('textarea');
        let hadTextarea = false;

        if (textarea) {
          FileLogger.log('content_script', 'info', 'Cover letter textarea found');
          hadTextarea = true;

          // Get cover letter from message or use default
          const coverLetterText = message.coverLetter || 'Здравствуйте! Заинтересован в данной вакансии.';

          try {
            (textarea as HTMLTextAreaElement).value = coverLetterText;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            FileLogger.log('content_script', 'info', 'Cover letter filled', { length: coverLetterText.length });
          } catch (error) {
            FileLogger.log('content_script', 'error', 'Cover letter fill failed', { error: (error as Error).message });
          }
        }

        // Find and click button
        const buttons = Array.from(modal.querySelectorAll('button'));
        FileLogger.log('content_script', 'debug', 'Modal buttons found', {
          count: buttons.length,
          texts: buttons.map(b => b.textContent?.trim())
        });

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

        // Priority 4: Primary button (usually confirm)
        if (!respondButton) {
          respondButton = buttons.find(btn => {
            const classList = Array.from(btn.classList);
            return classList.some(c => c.includes('primary') || c.includes('submit'));
          });
        }

        // Priority 5: Last button (usually confirm)
        if (!respondButton && buttons.length > 0) {
          respondButton = buttons[buttons.length - 1];
          FileLogger.log('content_script', 'info', 'Using last button as fallback');
        }

        if (respondButton) {
          // Check if button is disabled
          if (respondButton.hasAttribute('disabled') || respondButton.getAttribute('aria-disabled') === 'true') {
            FileLogger.log('content_script', 'warn', 'Modal button disabled', {
              text: respondButton.textContent?.trim()
            });
            sendResponse({ handled: false, hadTextarea, error: 'button_disabled' });
            break;
          }

          const buttonText = respondButton.textContent?.trim() || '';
          FileLogger.log('content_script', 'info', 'Modal button click', {
            text: buttonText
          });

          (respondButton as HTMLElement).click();

          FileLogger.log('content_script', 'info', 'Modal button clicked', {
            text: buttonText
          });

          sendResponse({
            handled: true,
            hadTextarea,
            buttonClicked: buttonText
          });
        } else {
          FileLogger.log('content_script', 'warn', 'Modal button not found');
          sendResponse({ handled: false, hadTextarea });
        }
        break;
      }

      case 'CHECK_MODAL_TYPE': {
        // Check what type of modal is open
        const modal =
          document.querySelector('[class*="magritte-mobile-container"]') ||
          document.querySelector('[class*="magritte-overlay"]') ||
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

        FileLogger.log('content_script', 'info', 'Modal type detected', {
          hasCoverLetter,
          hasConfirmation,
          hasTextarea: !!textarea,
          buttonCount: modal.querySelectorAll('button').length,
          modalText: modalText.substring(0, 300)
        });

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
          document.querySelector('[class*="magritte-mobile-container"]') ||
          document.querySelector('[class*="magritte-overlay"]') ||
          document.querySelector('[data-qa="bloko-modal"]') ||
          document.querySelector('[role="dialog"]');

        if (!modal) {
          sendResponse({ clicked: false, error: 'Modal not found' });
          break;
        }

        const buttons = Array.from(modal.querySelectorAll('button'));
        FileLogger.log('content_script', 'info', 'Modal buttons', {
          count: buttons.length,
          texts: buttons.map(b => b.textContent?.trim())
        });

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
          FileLogger.log('content_script', 'info', 'Clicking modal confirm', {
            buttonText: confirmButton.textContent
          });
          (confirmButton as HTMLElement).click();
          sendResponse({ clicked: true });
        } else {
          FileLogger.log('content_script', 'warn', 'Modal confirm button not found');
          sendResponse({ clicked: false, error: 'Button not found' });
        }
        break;
      }

      case 'GO_BACK': {
        console.log('[LiveContent] Going back');
        window.history.back();
        sendResponse({ success: true });
        break;
      }

      case 'CLICK_NEXT_PAGE': {
        // Парсим текущий URL и увеличиваем номер страницы
        try {
          const currentUrl = new URL(window.location.href);
          const currentPage = parseInt(currentUrl.searchParams.get('page') || '0', 10);
          const nextPage = currentPage + 1;

          // Просто увеличиваем номер страницы в URL
          currentUrl.searchParams.set('page', String(nextPage));
          const nextUrl = currentUrl.toString();

          FileLogger.log('content_script', 'info', 'Navigating to next page via URL', {
            currentPage,
            nextPage,
            nextUrl
          });

          window.location.href = nextUrl;
          sendResponse({ success: true, clicked: true, nextPage });
        } catch (error) {
          FileLogger.log('content_script', 'error', 'Failed to navigate to next page', {
            error: (error as Error).message
          });
          sendResponse({ success: false, clicked: false, error: (error as Error).message });
        }
        break;
      }

      case 'CHECK_HAS_NEXT_PAGE': {
        // Проверить наличие следующей страницы в пагинации
        try {
          const currentUrl = new URL(window.location.href);
          const currentPage = parseInt(currentUrl.searchParams.get('page') || '0', 10);
          const nextPage = currentPage + 1;

          // Ищем ссылку на следующую страницу в пагинации
          // Если её нет - значит это последняя страница
          const nextPageLink = document.querySelector(`[data-qa="pager-page"][href*="page=${nextPage}"]`);
          const hasNext = !!nextPageLink;

          FileLogger.log('content_script', 'info', 'Check has next page', {
            currentPage,
            nextPage,
            hasNext,
            foundLink: !!nextPageLink
          });

          sendResponse({ hasNext, currentPage, nextPage });
        } catch (error) {
          FileLogger.log('content_script', 'error', 'Failed to check next page', {
            error: (error as Error).message
          });
          sendResponse({ hasNext: false, error: (error as Error).message });
        }
        break;
      }

      case 'CHECK_AVAILABLE_VACANCIES': {
        // Быстрая проверка DOM на наличие доступных вакансий
        const { skipList } = message; // Получаем skip list из service worker
        FileLogger.log('content_script', 'info', 'Checking available vacancies on page', {
          skipListSize: skipList ? Object.keys(skipList).length : 0
        });

        const cards = document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]');
        let availableCount = 0;
        let alreadyAppliedCount = 0;
        let manualActionCount = 0;

        for (const card of cards) {
          const button = card.querySelector('[data-qa="vacancy-serp__vacancy_response"]');
          if (!button) continue;

          const buttonText = button.textContent?.trim() || '';
          const isDisabled = button.hasAttribute('disabled');

          // Уже откликнулись
          if (
            buttonText.includes('Отклик отправлен') ||
            buttonText.includes('Вы откликнулись') ||
            buttonText.includes('Приглашение') ||
            buttonText.includes('Отказ') ||
            isDisabled
          ) {
            alreadyAppliedCount++;
            continue;
          }

          // Проверка на manual action (в skip list из service worker)
          const vacancyLink = card.querySelector('a[href*="/vacancy/"]');
          const href = vacancyLink?.getAttribute('href') || '';
          const vacancyIdMatch = href.match(/\/vacancy\/(\d+)/);

          if (vacancyIdMatch && skipList) {
            const vacancyId = vacancyIdMatch[1];
            if (skipList[vacancyId]) {
              manualActionCount++;
              continue;
            }
          }

          // Доступна для автоотклика
          availableCount++;
        }

        const result = {
          hasAvailable: availableCount > 0,
          totalCards: cards.length,
          availableCount,
          alreadyAppliedCount,
          manualActionCount,
        };

        FileLogger.log('content_script', 'info', 'Available vacancies check result', result);
        sendResponse(result);
        break;
      }

      case 'SCROLL_TO_VACANCY': {
        const { vacancyId } = message;
        FileLogger.log('content_script', 'debug', 'Scroll to vacancy', { vacancyId });

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
          FileLogger.log('content_script', 'warn', 'Vacancy card not found for scroll', { vacancyId });
          sendResponse({ success: false });
          break;
        }

        // Scroll and highlight
        (card as HTMLElement).scrollIntoView({ behavior: 'auto', block: 'center' });

        const originalBg = (card as HTMLElement).style.backgroundColor;
        const originalTransition = (card as HTMLElement).style.transition;
        (card as HTMLElement).style.transition = 'background-color 0.3s';
        (card as HTMLElement).style.backgroundColor = '#ffebee'; // Красноватый для test-required

        setTimeout(() => {
          (card as HTMLElement).style.backgroundColor = originalBg;
          (card as HTMLElement).style.transition = originalTransition;
        }, 1000);

        FileLogger.log('content_script', 'debug', 'Vacancy scrolled into view', { vacancyId });
        sendResponse({ success: true });
        break;
      }

      // V2 handlers
      case 'VALIDATE_VACANCY': {
        const { vacancyId } = message;
        FileLogger.log('content_script', 'debug', 'Validate vacancy start', { vacancyId });

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

            FileLogger.log('content_script', 'debug', 'Vacancy button state', {
              vacancyId,
              buttonText: btnText,
              alreadyApplied
            });
            break;
          }
        }

        if (!exists) {
          FileLogger.log('content_script', 'warn', 'Vacancy card not found', { vacancyId });
        }

        sendResponse({ exists, alreadyApplied });
        break;
      }

      case 'CLICK_RESPOND_BUTTON': {
        const { vacancyId } = message;
        FileLogger.log('content_script', 'debug', 'Respond click start', { vacancyId });

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
          FileLogger.log('content_script', 'error', 'Vacancy card not found', { vacancyId });
          sendResponse({ success: false });
          break;
        }

        FileLogger.log('content_script', 'debug', 'Vacancy card found', { vacancyId });

        // Scroll to card FIRST (важно для видимости)
        // Используем instant для мгновенного скролла, чтобы было заметно
        (card as HTMLElement).scrollIntoView({ behavior: 'auto', block: 'center' });

        // Highlight card для визуальной обратной связи
        const originalBg = (card as HTMLElement).style.backgroundColor;
        const originalTransition = (card as HTMLElement).style.transition;
        (card as HTMLElement).style.transition = 'background-color 0.3s';
        (card as HTMLElement).style.backgroundColor = '#fff3cd'; // Желтый highlight

        // Wait for scroll to complete and show highlight
        setTimeout(() => {
          // Find button
          const respondButton = card!.querySelector('[data-qa="vacancy-serp__vacancy_response"]') ||
                                card!.querySelector('button[data-qa*="response"]') ||
                                Array.from(card!.querySelectorAll('button')).find(btn =>
                                  btn.textContent?.includes('Откликнуться')
                                );

          if (!respondButton) {
            FileLogger.log('content_script', 'error', '❌ Button NOT found in card', { vacancyId });
            sendResponse({ success: false });
            return;
          }

          const buttonText = respondButton.textContent?.trim() || '';
          FileLogger.log('content_script', 'info', '✅ Button found, clicking', {
            vacancyId,
            buttonText
          });

          // Click
          (respondButton as HTMLElement).click();

          // Remove highlight after click
          setTimeout(() => {
            (card as HTMLElement).style.backgroundColor = originalBg;
            (card as HTMLElement).style.transition = originalTransition;
          }, 1000);

          FileLogger.log('content_script', 'info', '✅ Button CLICKED', { vacancyId });
          sendResponse({ success: true });
        }, 500); // Увеличил до 500ms чтобы highlight был виден

        // Return true to indicate async response
        return true;
      }

      case 'CHECK_MODAL_EXISTS': {
        // Ищем модалку по разным селекторам
        const selectors = [
          // Magritte modals (новая система HH.ru)
          '[class*="magritte-mobile-container"]',
          '[class*="magritte-overlay"]',
          // Old bloko modals
          '[data-qa="bloko-modal"]',
          '[role="dialog"]',
          '.bloko-modal',
          '[data-qa="relocation-warning-modal"]',
          '[data-qa="vacancy-response-letter-popup"]',
          '.vacancy-response-popup',
          'div[class*="modal"]',
          'div[class*="Modal"]',
          'div[class*="popup"]',
          'div[class*="Popup"]',
        ];

        let modal: Element | null = null;
        let usedSelector = '';

        for (const selector of selectors) {
          const found = document.querySelector(selector);
          if (found) {
            const el = found as HTMLElement;
            const style = getComputedStyle(el);

            // Проверяем видимость: display !== 'none' && visibility !== 'hidden' && opacity > 0
            // offsetParent не работает для position:fixed элементов!
            const isVisible =
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              parseFloat(style.opacity) > 0;

            if (isVisible) {
              modal = found;
              usedSelector = selector;
              break;
            }
          }
        }

        const exists = !!modal;
        const modalText = modal ? (modal.textContent || '').substring(0, 200) : '';
        const modalCount = selectors.map(s => document.querySelectorAll(s).length).reduce((a, b) => a + b, 0);
        const allModals = selectors.map(s => {
          const elements = document.querySelectorAll(s);
          return Array.from(elements).map(el => {
            const style = getComputedStyle(el as HTMLElement);
            const isVisible =
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              parseFloat(style.opacity) > 0;
            return {
              selector: s,
              visible: isVisible,
              text: (el.textContent || '').substring(0, 50)
            };
          });
        }).flat();

        FileLogger.log('content_script', 'info', 'CHECK_MODAL_EXISTS', {
          exists,
          count: modalCount,
          text: modalText,
          url: window.location.href,
          usedSelector,
          allModals: allModals.filter(m => m.visible)
        });

        sendResponse({ exists, count: modalCount, text: modalText });
        break;
      }

      case 'HANDLE_MODAL': {
        const { coverLetter } = message;
        FileLogger.log('content_script', 'info', 'HANDLE_MODAL');

        const modal = document.querySelector('[class*="magritte-mobile-container"]') ||
                      document.querySelector('[class*="magritte-overlay"]') ||
                      document.querySelector('[data-qa="bloko-modal"]') ||
                      document.querySelector('[role="dialog"]') ||
                      document.querySelector('.bloko-modal');

        if (!modal) {
          FileLogger.log('content_script', 'warn', 'Modal not found');
          sendResponse({ handled: false });
          break;
        }

        // Fill textarea if exists
        const textarea = modal.querySelector('textarea');
        if (textarea) {
          (textarea as HTMLTextAreaElement).value = coverLetter;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          FileLogger.log('content_script', 'info', 'Textarea filled');
        }

        // Find and click button
        const buttons = Array.from(modal.querySelectorAll('button'));
        const respondButton = buttons.find(btn => {
          const text = btn.textContent?.trim() || '';
          const textLower = text.toLowerCase();
          // Приоритет 1: Точные совпадения (с "ё" и "е")
          return text === 'Всё равно откликнуться' ||
                 text === 'Все равно откликнуться' ||
                 text === 'Откликнуться' ||
                 text === 'Отправить' ||
                 // Приоритет 2: Содержит "равно откликнуться" (любой вариант)
                 textLower.includes('равно откликнуться');
        }) || buttons.find(btn => {
          const text = btn.textContent?.trim().toLowerCase() || '';
          // Приоритет 3: Любая кнопка с откликом/отправкой
          return text.includes('откликнуться') || text.includes('отправить') || text.includes('подтвердить');
        }) || buttons[buttons.length - 1]; // Fallback: последняя кнопка

        if (respondButton) {
          (respondButton as HTMLElement).click();
          FileLogger.log('content_script', 'info', 'Modal button clicked', { buttonText: respondButton.textContent?.trim() });
          sendResponse({ handled: true });
        } else {
          FileLogger.log('content_script', 'warn', 'Modal button not found');
          sendResponse({ handled: false });
        }
        break;
      }

      case 'CLICK_RESPOND_ON_CARD': {
        const { vacancyId } = message;

        FileLogger.log('content_script', 'info', 'CLICK_RESPOND_ON_CARD start', { vacancyId });

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
              FileLogger.log('content_script', 'info', 'Already applied', { vacancyId, btnText });
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
          FileLogger.log('content_script', 'error', 'Card not found', {
            vacancyId,
            totalCards: allCards.length
          });
          sendResponse({
            success: false,
            outcome: 'button_not_found',
            message: `Card not found`,
          });
          return;
        }

        FileLogger.log('content_script', 'info', 'Card found, scrolling', { vacancyId });

        // Scroll (instant, no animation)
        (card as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'center' });

        // Find button
        const respondButton = card.querySelector('[data-qa="vacancy-serp__vacancy_response"]') ||
                              card.querySelector('button[data-qa*="response"]') ||
                              Array.from(card.querySelectorAll('button')).find(btn =>
                                btn.textContent?.includes('Откликнуться')
                              );

        if (!respondButton) {
          FileLogger.log('content_script', 'error', 'Button not found', { vacancyId });
          sendResponse({
            success: false,
            outcome: 'button_not_found',
            message: 'Button not found',
          });
          return;
        }

        FileLogger.log('content_script', 'info', 'Clicking button', { vacancyId });

        // Click
        (respondButton as HTMLElement).click();

        FileLogger.log('content_script', 'info', 'Button clicked', { vacancyId });

        sendResponse({
          success: true,
          outcome: 'clicked',
          message: 'Button clicked',
        });
        break;
      }

      case 'OBSERVE_RESPOND_MODAL': {
        // Check if modal is open
        const modal = document.querySelector('[class*="magritte-mobile-container"]') ||
                      document.querySelector('[class*="magritte-overlay"]') ||
                      document.querySelector('[data-qa="vacancy-response-modal"]') ||
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
        const modal = document.querySelector('[class*="magritte-mobile-container"]') ||
                      document.querySelector('[class*="magritte-overlay"]') ||
                      document.querySelector('[data-qa="vacancy-response-modal"]') ||
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
        const modal = document.querySelector('[class*="magritte-mobile-container"]') ||
                      document.querySelector('[class*="magritte-overlay"]') ||
                      document.querySelector('[data-qa="vacancy-response-modal"]') ||
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

      case 'CHECK_FOR_CAPTCHA': {
        // Проверяем наличие капчи на странице
        const captchaSelectors = [
          '[data-qa="captcha"]',
          '.g-recaptcha',
          '#captcha',
          'iframe[src*="recaptcha"]',
          'iframe[src*="captcha"]',
          '[class*="captcha"]',
          '[id*="captcha"]'
        ];

        let captchaFound = false;
        let captchaType = null;

        for (const selector of captchaSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            captchaFound = true;
            captchaType = selector;
            break;
          }
        }

        // Также проверяем текст на странице
        const bodyText = document.body.textContent || '';
        if (bodyText.includes('Проверка безопасности') ||
            bodyText.includes('Подтвердите, что вы не робот') ||
            bodyText.includes('Введите символы с картинки')) {
          captchaFound = true;
          captchaType = 'text_detection';
        }

        FileLogger.log('content_script', captchaFound ? 'warn' : 'info', 'Captcha check', {
          found: captchaFound,
          type: captchaType
        });

        sendResponse({
          captchaFound,
          captchaType
        });
        break;
      }

      case 'FILL_ADVANCED_SEARCH_FORM': {
        FileLogger.log('content_script', 'info', 'FILL_ADVANCED_SEARCH_FORM received', {
          profile: message.profile?.name
        });

        fillAndSubmitAdvancedSearchForm(message.profile, message.resumeHash)
          .then(result => {
            FileLogger.log('content_script', 'info', 'Advanced search form filled', result);
            sendResponse(result);
          })
          .catch(error => {
            FileLogger.log('content_script', 'error', 'Failed to fill advanced search form', {
              error: error.message
            });
            sendResponse({ success: false, error: error.message });
          });

        return true; // Async response
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

// Auto-close ONLY non-apply HH.ru modals (avoid closing apply modals)
setInterval(() => {
  try {
    // Check both old bloko modals and new Magritte modals
    const blokoModals = document.querySelectorAll('[data-qa="bloko-modal"]');
    const magritteModals = document.querySelectorAll('[class*="magritte-mobile-container"], [class*="magritte-overlay"]');
    const allModals = [...Array.from(blokoModals), ...Array.from(magritteModals)];

    allModals.forEach(modal => {
      const modalText = modal.textContent || '';

      // Skip apply-related modals
      if (
        modalText.includes('Откликнуться') ||
        modalText.includes('откликнуться') ||
        modalText.includes('Всё равно откликнуться') ||
        modalText.includes('Сопроводительное письмо') ||
        modalText.includes('Отклик отправлен') ||
        modalText.includes('другой стране') ||
        modal.querySelector('textarea') ||
        modal.querySelector('[data-qa*="vacancy-response"]')
      ) {
        return; // Don't close apply modals
      }

      // Close non-apply modals (surveys, etc)
      const closeBtn = modal.querySelector('[data-qa="bloko-modal-close"]') ||
                       modal.querySelector('button[aria-label="Закрыть"]') ||
                       modal.querySelector('[class*="close"]');
      if (closeBtn) {
        FileLogger.log('content_script', 'info', 'Closing non-apply modal');
        (closeBtn as HTMLElement).click();
      }
    });
  } catch (error) {
    // Ignore errors
  }
}, 3000);
