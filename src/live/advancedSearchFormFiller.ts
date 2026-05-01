/**
 * HH.ru Global Search URL Builder
 *
 * Строит URL для глобального поиска с привязкой резюме.
 */

/**
 * Строит URL для глобального поиска с резюме
 */
export function buildGlobalSearchUrl(resumeHash: string | null): string {
  if (resumeHash) {
    return `https://hh.ru/search/vacancy?resume=${resumeHash}`;
  }
  return 'https://hh.ru/search/vacancy';
}
