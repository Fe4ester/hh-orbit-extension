/**
 * HH.ru Advanced Search Form Filler
 *
 * Заполняет форму расширенного поиска на https://hh.ru/search/vacancy/advanced
 * и отправляет её для получения результатов поиска с фильтрами.
 */

import { Profile } from '../state/types';
import { FileLogger } from '../utils/fileLogger';

export interface FormFillResult {
  success: boolean;
  error?: string;
}

/**
 * Заполняет форму расширенного поиска и отправляет её
 */
export async function fillAndSubmitAdvancedSearchForm(
  profile: Profile,
  _resumeHash: string | null
): Promise<FormFillResult> {
  try {
    FileLogger.log('content_script', 'info', 'Filling advanced search form', {
      profileId: profile.id,
      profileName: profile.name
    });

    // Логируем все доступные поля формы для отладки
    const allEmploymentInputs = document.querySelectorAll('input[name="employment_form"]');
    const allWorkFormatInputs = document.querySelectorAll('input[name="work_format"]');
    const allScheduleInputs = document.querySelectorAll('input[name="schedule"]');
    const allExperienceInputs = document.querySelectorAll('input[name="experience"]');

    FileLogger.log('content_script', 'debug', 'Available form fields', {
      employment_form: Array.from(allEmploymentInputs).map((el: any) => el.value),
      work_format: Array.from(allWorkFormatInputs).map((el: any) => el.value),
      schedule: Array.from(allScheduleInputs).map((el: any) => el.value),
      experience: Array.from(allExperienceInputs).map((el: any) => el.value)
    });

    // 1. Ключевые слова (text)
    if (profile.keywordsInclude && profile.keywordsInclude.length > 0) {
      const textInput = document.querySelector('input[name="text"]') as HTMLInputElement;
      if (textInput) {
        textInput.value = profile.keywordsInclude.join(' ');
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
        textInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // 2. Исключающие слова (excluded_text)
    if (profile.keywordsExclude && profile.keywordsExclude.length > 0) {
      const excludedInput = document.querySelector('input[name="excluded_text"]') as HTMLInputElement;
      if (excludedInput) {
        excludedInput.value = profile.keywordsExclude.join(' ');
        excludedInput.dispatchEvent(new Event('input', { bubbles: true }));
        excludedInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // 3. Опыт работы (experience) - radio button, только одно значение
    if (profile.experience) {
      const experienceRadio = document.querySelector(
        `input[name="experience"][value="${profile.experience}"]`
      ) as HTMLInputElement;
      if (experienceRadio && !experienceRadio.checked) {
        experienceRadio.click();
        await sleep(100);
      }
    }

    // 4. Тип занятости (employment_form) - checkboxes, можно несколько
    if (profile.employment && profile.employment.length > 0) {
      FileLogger.log('content_script', 'info', 'Applying employment filters', {
        employment: profile.employment
      });

      for (const emp of profile.employment) {
        const checkbox = document.querySelector(
          `input[name="employment_form"][value="${emp}"]`
        ) as HTMLInputElement;

        FileLogger.log('content_script', 'debug', 'Employment checkbox search', {
          value: emp,
          found: !!checkbox,
          checked: checkbox?.checked
        });

        if (checkbox && !checkbox.checked) {
          checkbox.click();
          await sleep(100);
          FileLogger.log('content_script', 'info', 'Employment checkbox clicked', { value: emp });
        } else if (!checkbox) {
          FileLogger.log('content_script', 'warn', 'Employment checkbox not found', { value: emp });
        }
      }
    }

    // 5. Формат работы (work_format) - radio button
    if (profile.work_format) {
      FileLogger.log('content_script', 'info', 'Applying work_format', {
        work_format: profile.work_format
      });

      const workFormatRadio = document.querySelector(
        `input[name="work_format"][value="${profile.work_format}"]`
      ) as HTMLInputElement;

      FileLogger.log('content_script', 'debug', 'Work format radio search', {
        value: profile.work_format,
        found: !!workFormatRadio,
        checked: workFormatRadio?.checked
      });

      if (workFormatRadio && !workFormatRadio.checked) {
        workFormatRadio.click();
        await sleep(100);
        FileLogger.log('content_script', 'info', 'Work format radio clicked', { value: profile.work_format });
      } else if (!workFormatRadio) {
        FileLogger.log('content_script', 'warn', 'Work format radio not found', { value: profile.work_format });
      }
    }

    // 6. Частота выплат (salary_frequency) - radio button
    if (profile.salary_frequency) {
      const salaryFreqRadio = document.querySelector(
        `input[name="salary_frequency"][value="${profile.salary_frequency}"]`
      ) as HTMLInputElement;
      if (salaryFreqRadio && !salaryFreqRadio.checked) {
        salaryFreqRadio.click();
        await sleep(100);
      }
    }

    // 7. График работы (schedule) - checkboxes
    if (profile.schedule && profile.schedule.length > 0) {
      for (const sch of profile.schedule) {
        const checkbox = document.querySelector(
          `input[name="schedule"][value="${sch}"]`
        ) as HTMLInputElement;
        if (checkbox && !checkbox.checked) {
          checkbox.click();
          await sleep(100);
        }
      }
    }

    // Ждем применения всех изменений
    await sleep(300);

    // 8. Отправляем форму - ищем кнопку "Найти"
    const submitButton = document.querySelector(
      'button[type="submit"], button[data-qa="search-button"], input[type="submit"]'
    ) as HTMLButtonElement;

    if (submitButton) {
      FileLogger.log('content_script', 'info', 'Submitting advanced search form');
      submitButton.click();

      return {
        success: true
      };
    } else {
      FileLogger.log('content_script', 'error', 'Submit button not found');
      return {
        success: false,
        error: 'Submit button not found'
      };
    }

  } catch (error) {
    FileLogger.log('content_script', 'error', 'Failed to fill advanced search form', {
      error: (error as Error).message
    });

    return {
      success: false,
      error: (error as Error).message
    };
  }
}

/**
 * Строит URL для глобального поиска с резюме
 */
export function buildGlobalSearchUrl(resumeHash: string | null): string {
  if (resumeHash) {
    return `https://hh.ru/search/vacancy?resume=${resumeHash}`;
  }
  return 'https://hh.ru/search/vacancy';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
