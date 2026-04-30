/**
 * Check Available Vacancies on Page
 *
 * Быстро проверяет DOM страницы поиска на наличие вакансий с доступными кнопками откликов.
 * Используется для определения нужно ли переходить на следующую страницу.
 */

export interface AvailableVacanciesCheck {
  hasAvailable: boolean;
  totalCards: number;
  availableCount: number;
  alreadyAppliedCount: number;
  manualActionCount: number;
}

/**
 * Проверяет страницу поиска на наличие вакансий с доступными кнопками откликов
 */
export function checkAvailableVacanciesOnPage(): AvailableVacanciesCheck {
  const cards = document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]');

  let availableCount = 0;
  let alreadyAppliedCount = 0;
  let manualActionCount = 0;

  for (const card of cards) {
    const button = card.querySelector('[data-qa="vacancy-serp__vacancy_response"]');

    if (!button) {
      continue;
    }

    const buttonText = button.textContent?.trim() || '';
    const isDisabled = button.hasAttribute('disabled');

    // Проверка: уже откликнулись
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

    // Проверка: требует ручного действия (тест, анкета)
    // Эти кнопки остаются кликабельными, но мы их уже добавили в manual actions
    const vacancyLink = card.querySelector('a[href*="/vacancy/"]');
    const href = vacancyLink?.getAttribute('href') || '';
    const vacancyIdMatch = href.match(/\/vacancy\/(\d+)/);

    if (vacancyIdMatch) {
      const vacancyId = vacancyIdMatch[1];

      // Проверяем localStorage на наличие в skip list (manual actions)
      try {
        const skipListStr = localStorage.getItem('hh_orbit_skip_list');
        if (skipListStr) {
          const skipList = JSON.parse(skipListStr);
          if (skipList[vacancyId]) {
            manualActionCount++;
            continue;
          }
        }
      } catch (e) {
        // Ignore localStorage errors
      }
    }

    // Если дошли сюда - кнопка доступна для автоотклика
    availableCount++;
  }

  return {
    hasAvailable: availableCount > 0,
    totalCards: cards.length,
    availableCount,
    alreadyAppliedCount,
    manualActionCount,
  };
}
