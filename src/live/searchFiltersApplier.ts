/**
 * HH.ru Search Filters Applier
 *
 * Программно выставляет фильтры на странице поиска через DOM,
 * вместо передачи их через URL параметры.
 */

import { Profile } from '../state/types';
import { FileLogger } from '../utils/fileLogger';

export interface ApplyFiltersResult {
  success: boolean;
  appliedFilters: string[];
  errors: string[];
}

/**
 * Применяет фильтры профиля на странице поиска HH.ru
 */
export async function applySearchFilters(profile: Profile): Promise<ApplyFiltersResult> {
  const appliedFilters: string[] = [];

  FileLogger.log('content_script', 'info', 'Applying search filters from profile', {
    experience: profile.experience,
    schedule: profile.schedule,
    employment: profile.employment
  });

  try {
    // 1. Исключающие слова - через специальное поле
    if (profile.keywordsExclude && profile.keywordsExclude.length > 0) {
      const excludeInput = document.querySelector('[data-qa="novafilters-excluded-text-input"]') as HTMLInputElement;
      if (excludeInput) {
        excludeInput.value = profile.keywordsExclude.join(', ');
        excludeInput.dispatchEvent(new Event('input', { bubbles: true }));
        excludeInput.dispatchEvent(new Event('change', { bubbles: true }));
        appliedFilters.push(`excluded: ${profile.keywordsExclude.join(', ')}`);
        FileLogger.log('content_script', 'info', 'Applied excluded keywords', {
          keywords: profile.keywordsExclude
        });
      }
    }

    // 2. Опыт работы (experience)
    // noExperience, between1And3, between3And6, moreThan6
    if (profile.experience && profile.experience.length > 0) {
      for (const exp of profile.experience) {
        const checkbox = document.querySelector(`[data-qa="serp__novafilter-experience-${exp}"]`) as HTMLInputElement;
        if (checkbox && !checkbox.checked) {
          checkbox.click();
          appliedFilters.push(`experience: ${exp}`);
          await sleep(100);
        }
      }
      FileLogger.log('content_script', 'info', 'Applied experience filters', {
        experience: profile.experience
      });
    }

    // 3. График работы (schedule/work_format)
    // remote → REMOTE, fullDay → ON_SITE, flexible → HYBRID
    if (profile.schedule && profile.schedule.length > 0) {
      const scheduleMap: Record<string, string> = {
        'remote': 'REMOTE',
        'fullDay': 'ON_SITE',
        'flexible': 'HYBRID',
        'shift': 'ON_SITE',
        'flyInFlyOut': 'FIELD_WORK'
      };

      for (const sch of profile.schedule) {
        const workFormat = scheduleMap[sch];
        if (workFormat) {
          const checkbox = document.querySelector(`[data-qa="serp__novafilter-work_format-${workFormat}"]`) as HTMLInputElement;
          if (checkbox && !checkbox.checked) {
            checkbox.click();
            appliedFilters.push(`work_format: ${workFormat}`);
            await sleep(100);
          }
        }
      }
      FileLogger.log('content_script', 'info', 'Applied schedule filters', {
        schedule: profile.schedule
      });
    }

    // 4. Занятость (employment/employment_form)
    // full → FULL, part → PART, project → PROJECT
    if (profile.employment && profile.employment.length > 0) {
      const employmentMap: Record<string, string> = {
        'full': 'FULL',
        'part': 'PART',
        'project': 'PROJECT',
        'probation': 'PROBATION',
        'volunteer': 'VOLUNTEER'
      };

      for (const emp of profile.employment) {
        const employmentForm = employmentMap[emp];
        if (employmentForm) {
          const checkbox = document.querySelector(`[data-qa="serp__novafilter-employment_form-${employmentForm}"]`) as HTMLInputElement;
          if (checkbox && !checkbox.checked) {
            checkbox.click();
            appliedFilters.push(`employment_form: ${employmentForm}`);
            await sleep(100);
          }
        }
      }
      FileLogger.log('content_script', 'info', 'Applied employment filters', {
        employment: profile.employment
      });
    }

    // 5. Зарплата - УДАЛЕНО (не используется)
    // Многие вакансии не указывают зарплату, поэтому фильтр по зарплате убран

    // Ждем применения фильтров
    await sleep(500);

    FileLogger.log('content_script', 'info', 'Filters applied successfully', {
      appliedCount: appliedFilters.length,
      filters: appliedFilters
    });

    return {
      success: true,
      appliedFilters,
      errors: []
    };

  } catch (error) {
    FileLogger.log('content_script', 'error', 'Failed to apply filters', {
      error: (error as Error).message
    });

    return {
      success: false,
      appliedFilters,
      errors: [(error as Error).message]
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
