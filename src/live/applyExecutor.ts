// Browser-owned apply executor skeleton

import { VacancyDetailObservation, PreflightClassification } from './vacancyDetailParser';
import {
  ClickExecutionObservation,
  PostClickObservation,
} from './respondButtonExecutor';
import {
  CoverLetterUIObservation,
  FillCoverLetterResult,
} from './coverLetterExecutor';
import {
  FinalSubmitClickObservation,
  PostSubmitObservation,
} from './finalSubmitExecutor';

export interface ApplyExecutionOptions {
  selectedResumeHash: string | null;
  coverLetterText?: string | null;
  realClick?: boolean;
}

export type ApplyOutcome =
  | 'success'
  | 'already_applied'
  | 'login_required'
  | 'resume_required'
  | 'cover_letter_required'
  | 'cover_letter_ready'
  | 'external_apply'
  | 'questionnaire_required'
  | 'manual_action_required'
  | 'apply_unavailable'
  | 'unknown';

export interface ApplyExecutionResult {
  outcome: ApplyOutcome;
  message: string;
  metadata?: Record<string, any>;
}

/**
 * Execute apply skeleton (dry-run, DOM-driven)
 *
 * This is a skeleton executor that validates preflight conditions
 * without performing actual network submit.
 */
export function executeApplyPrechecked(
  observation: VacancyDetailObservation,
  preflight: PreflightClassification,
  options: ApplyExecutionOptions
): ApplyExecutionResult {
  // Already applied
  if (observation.alreadyApplied) {
    return {
      outcome: 'already_applied',
      message: 'Вы уже откликались на эту вакансию',
      metadata: { preflightCode: preflight.code },
    };
  }

  // Login required
  if (observation.requiresLogin) {
    return {
      outcome: 'login_required',
      message: 'Требуется авторизация для отклика',
      metadata: { preflightCode: preflight.code },
    };
  }

  // External apply
  if (observation.externalApply) {
    return {
      outcome: 'external_apply',
      message: 'Отклик через внешний сайт работодателя',
      metadata: { preflightCode: preflight.code },
    };
  }

  // Archived or unavailable
  if (observation.archivedOrUnavailable) {
    return {
      outcome: 'apply_unavailable',
      message: 'Вакансия архивирована или недоступна',
      metadata: { preflightCode: preflight.code },
    };
  }

  // No respond button
  if (!observation.hasRespondButton) {
    return {
      outcome: 'apply_unavailable',
      message: 'Кнопка отклика не найдена',
      metadata: { preflightCode: preflight.code },
    };
  }

  // Resume required
  if (!observation.resumeSelectorVisible && !options.selectedResumeHash) {
    return {
      outcome: 'resume_required',
      message: 'Требуется выбор резюме',
      metadata: { preflightCode: preflight.code },
    };
  }

  // Cover letter required (hint present but no text provided)
  if (observation.coverLetterHint && !options.coverLetterText) {
    return {
      outcome: 'cover_letter_required',
      message: 'Рекомендуется сопроводительное письмо',
      metadata: { preflightCode: preflight.code, hint: 'cover_letter' },
    };
  }

  // Questionnaire required
  if (observation.questionnaireHint) {
    return {
      outcome: 'questionnaire_required',
      message: 'Требуется заполнение анкеты работодателя',
      metadata: { preflightCode: preflight.code, hint: 'questionnaire' },
    };
  }

  // Success dry-run (skeleton passed all checks)
  return {
    outcome: 'success',
    message: options.realClick
      ? 'Apply skeleton ready for real click'
      : 'Apply skeleton passed preflight and would click respond',
    metadata: {
      preflightCode: preflight.code,
      dryRun: !options.realClick,
      resumeHash: options.selectedResumeHash,
      hasCoverLetter: !!options.coverLetterText,
    },
  };
}

/**
 * Classify apply result from post-click observation
 */
export function classifyPostClickResult(
  clickObservation: ClickExecutionObservation,
  postClickObservation: PostClickObservation,
  coverLetterText?: string | null
): ApplyExecutionResult {
  // Click failed
  if (!clickObservation.clicked) {
    return {
      outcome: 'apply_unavailable',
      message: clickObservation.error || 'Failed to click respond button',
      metadata: { clickObservation },
    };
  }

  // Login redirect after click
  if (postClickObservation.loginRedirectVisible) {
    return {
      outcome: 'login_required',
      message: 'Требуется авторизация (обнаружено после клика)',
      metadata: { clickObservation, postClickObservation },
    };
  }

  // Already applied after click
  if (postClickObservation.alreadyAppliedVisible) {
    return {
      outcome: 'already_applied',
      message: 'Вы уже откликались (обнаружено после клика)',
      metadata: { clickObservation, postClickObservation },
    };
  }

  // External apply after click
  if (postClickObservation.externalApplyVisible) {
    return {
      outcome: 'external_apply',
      message: 'Отклик через внешний сайт (обнаружено после клика)',
      metadata: { clickObservation, postClickObservation },
    };
  }

  // Modal opened - check for questionnaire/cover letter
  if (postClickObservation.modalOpened) {
    if (postClickObservation.questionnaireUIVisible) {
      return {
        outcome: 'questionnaire_required',
        message: 'Требуется заполнение анкеты (modal opened)',
        metadata: { clickObservation, postClickObservation },
      };
    }

    if (postClickObservation.coverLetterUIVisible) {
      // Cover letter UI visible - check if we have text
      if (!coverLetterText || coverLetterText.trim().length === 0) {
        return {
          outcome: 'cover_letter_required',
          message: 'Требуется сопроводительное письмо (modal opened, no text provided)',
          metadata: { clickObservation, postClickObservation },
        };
      }

      // We have text but haven't filled yet - this will be handled by caller
      return {
        outcome: 'cover_letter_required',
        message: 'Cover letter UI detected, ready to fill',
        metadata: { clickObservation, postClickObservation, hasCoverLetterText: true },
      };
    }

    // Modal opened without blockers - success signal
    return {
      outcome: 'success',
      message: 'Respond button clicked, modal opened',
      metadata: { clickObservation, postClickObservation, realClick: true },
    };
  }

  // Unknown state - click happened but no clear signal
  return {
    outcome: 'unknown',
    message: 'Click executed but post-click state unclear',
    metadata: { clickObservation, postClickObservation },
  };
}

/**
 * Classify result after cover letter fill
 */
export function classifyAfterCoverLetterFill(
  clickObservation: ClickExecutionObservation,
  postClickObservation: PostClickObservation,
  coverLetterObservation: CoverLetterUIObservation,
  fillResult: FillCoverLetterResult
): ApplyExecutionResult {
  if (!fillResult.filled) {
    return {
      outcome: 'cover_letter_required',
      message: fillResult.error || 'Failed to fill cover letter',
      metadata: { clickObservation, postClickObservation, coverLetterObservation, fillResult },
    };
  }

  // Successfully filled - but not submitted yet
  return {
    outcome: 'cover_letter_ready',
    message: `Cover letter filled (${fillResult.textLength} chars), ready for submit`,
    metadata: {
      clickObservation,
      postClickObservation,
      coverLetterObservation,
      fillResult,
      realClick: true,
    },
  };
}

/**
 * Classify result after final submit
 */
export function classifyPostSubmitResult(
  clickObservation: ClickExecutionObservation,
  postClickObservation: PostClickObservation,
  finalSubmitObservation: FinalSubmitClickObservation,
  postSubmitObservation: PostSubmitObservation
): ApplyExecutionResult {
  // Submit click failed
  if (!finalSubmitObservation.clicked) {
    return {
      outcome: 'apply_unavailable',
      message: finalSubmitObservation.error || 'Failed to click final submit button',
      metadata: { clickObservation, postClickObservation, finalSubmitObservation, postSubmitObservation },
    };
  }

  // Success signal
  if (postSubmitObservation.successVisible) {
    return {
      outcome: 'success',
      message: 'Отклик успешно отправлен',
      metadata: {
        clickObservation,
        postClickObservation,
        finalSubmitObservation,
        postSubmitObservation,
        realClick: true,
        finalSubmitTried: true,
      },
    };
  }

  // Already applied
  if (postSubmitObservation.alreadyAppliedVisible) {
    return {
      outcome: 'already_applied',
      message: 'Вы уже откликались (обнаружено после submit)',
      metadata: { clickObservation, postClickObservation, finalSubmitObservation, postSubmitObservation },
    };
  }

  // Login required
  if (postSubmitObservation.loginRequiredVisible) {
    return {
      outcome: 'login_required',
      message: 'Требуется авторизация (обнаружено после submit)',
      metadata: { clickObservation, postClickObservation, finalSubmitObservation, postSubmitObservation },
    };
  }

  // Questionnaire still visible
  if (postSubmitObservation.questionnaireVisible) {
    return {
      outcome: 'questionnaire_required',
      message: 'Требуется заполнение анкеты (обнаружено после submit)',
      metadata: { clickObservation, postClickObservation, finalSubmitObservation, postSubmitObservation },
    };
  }

  // Cover letter still visible - NOT success
  if (postSubmitObservation.coverLetterStillVisible) {
    return {
      outcome: 'cover_letter_required',
      message: 'Cover letter UI still visible after submit',
      metadata: { clickObservation, postClickObservation, finalSubmitObservation, postSubmitObservation },
    };
  }

  // Error visible
  if (postSubmitObservation.errorVisible) {
    return {
      outcome: 'apply_unavailable',
      message: postSubmitObservation.errorText || 'Ошибка при отправке отклика',
      metadata: { clickObservation, postClickObservation, finalSubmitObservation, postSubmitObservation },
    };
  }

  // Unknown state
  return {
    outcome: 'unknown',
    message: 'Post-submit state unclear',
    metadata: { clickObservation, postClickObservation, finalSubmitObservation, postSubmitObservation },
  };
}

/**
 * Classify apply result from raw execution
 */
export function classifyApplyResult(raw: ApplyExecutionResult): ApplyExecutionResult {
  // Pass through for now (future: add post-processing logic)
  return raw;
}
