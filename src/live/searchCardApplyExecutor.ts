/**
 * Apply executor для search page cards (без navigation)
 */

import { FileLogger } from '../utils/fileLogger';

export interface SearchCardApplyResult {
  success: boolean;
  outcome: 'success' | 'already_applied' | 'modal_opened' | 'button_not_found' | 'error';
  message?: string;
}

/**
 * Click respond button on search card
 */
export async function clickRespondButtonOnCard(
  tabId: number,
  cardIndex: number,
  vacancyId: string
): Promise<SearchCardApplyResult> {
  FileLogger.log('service_worker', 'info', 'Clicking respond button on card', { cardIndex, vacancyId });

  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      type: 'CLICK_RESPOND_ON_CARD',
      cardIndex,
      vacancyId,
    });

    FileLogger.log('service_worker', 'info', 'Click respond result', result);
    return result;
  } catch (error) {
    FileLogger.log('service_worker', 'error', 'Failed to click respond button', { error: (error as Error).message });
    return {
      success: false,
      outcome: 'error',
      message: (error as Error).message,
    };
  }
}
