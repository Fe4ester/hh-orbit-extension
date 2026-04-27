// HH search results DOM parser

import { FileLogger } from '../utils/fileLogger';

export interface ParsedVacancyCard {
  vacancyId: string | null;
  title: string;
  company?: string;
  salary?: string;
  url: string;
  location?: string;
  isViewed?: boolean;
  cardIndex?: number;
}

/**
 * Extract vacancy ID from HH vacancy URL
 * Example: https://hh.ru/vacancy/123456 -> "123456"
 */
export function extractVacancyIdFromLink(url: string): string | null {
  const match = url.match(/\/vacancy\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Check if HTML is a search results page
 */
export function isSearchResultsPage(html: string): boolean {
  return (
    html.includes('vacancy-serp-content') ||
    html.includes('serp-item') ||
    html.includes('vacancy-serp-item') ||
    html.includes('search-result-item') ||
    html.includes('data-qa="vacancy-serp__vacancy')
  );
}

/**
 * Parse vacancy cards from HH search results HTML using regex (no DOMParser)
 */
export function parseSearchResults(html: string): ParsedVacancyCard[] {
  if (!isSearchResultsPage(html)) {
    console.warn('[Parser] Not a search results page');
    FileLogger.log('parser', 'warn', 'Not a search results page', { htmlLength: html.length });
    return [];
  }

  const cards: ParsedVacancyCard[] = [];
  FileLogger.log('parser', 'info', 'Parsing search results', { htmlLength: html.length });

  // Find all vacancy links with /vacancy/ pattern
  const vacancyLinkRegex = /<a[^>]*href="([^"]*\/vacancy\/\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;

  let match;
  let index = 0;

  while ((match = vacancyLinkRegex.exec(html)) !== null) {
    try {
      let url = match[1];
      const titleHtml = match[2];

      // Clean up URL
      url = url.replace(/&amp;/g, '&').trim();
      if (!url.startsWith('http')) {
        url = 'https://hh.ru' + url;
      }

      const vacancyId = extractVacancyIdFromLink(url);

      if (!vacancyId) {
        continue;
      }

      // Extract title text (strip HTML tags)
      const title = titleHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

      if (!title) {
        continue;
      }

      // Find the card block containing this link to extract metadata
      const linkPos = match.index;
      const beforeLink = html.substring(Math.max(0, linkPos - 2000), linkPos);

      // Check respond button status BEFORE adding to queue
      const afterLink = html.substring(linkPos, Math.min(html.length, linkPos + 2000));
      const respondButtonMatch = afterLink.match(/data-qa="vacancy-serp__vacancy_response"[^>]*>([^<]*)</);

      if (respondButtonMatch) {
        const buttonText = respondButtonMatch[1].trim();

        // Skip if already applied
        if (
          buttonText.includes('Отклик отправлен') ||
          buttonText.includes('Вы откликнулись') ||
          buttonText.includes('Приглашение') ||
          buttonText.includes('Отказ')
        ) {
          continue;
        }
      }

      // Find the start of the card div
      const cardStartMatch = beforeLink.match(/<div[^>]*class="[^"]*(?:serp-item|vacancy-serp-item)[^"]*"[^>]*>(?![\s\S]*<div[^>]*class="[^"]*(?:serp-item|vacancy-serp-item))/);

      if (!cardStartMatch) {
        // Still add the card with minimal info
        cards.push({
          vacancyId,
          title,
          url,
          cardIndex: index,
        });
        continue;
      }

      // Calculate absolute position of card start in original html
      const cardStartPosInBeforeLink = cardStartMatch.index!;
      const cardStartPosInHtml = Math.max(0, linkPos - 2000) + cardStartPosInBeforeLink;

      // Find end of current card (start of next card or end of search window)
      const searchEnd = Math.min(html.length, linkPos + 2000);
      const afterLinkHtml = html.substring(linkPos + match[0].length, searchEnd);
      const nextCardMatch = afterLinkHtml.match(/<div[^>]*class="[^"]*(?:serp-item|vacancy-serp-item)[^"]*"[^>]*data-qa="vacancy-serp__vacancy"/);
      const cardEndPos = nextCardMatch
        ? linkPos + match[0].length + nextCardMatch.index!
        : searchEnd;

      const cardHtml = html.substring(cardStartPosInHtml, cardEndPos);

      // Extract company (optional)
      const companyRegex = /<a[^>]*class="[^"]*bloko-link_kind-tertiary[^"]*"[^>]*>([\s\S]*?)<\/a>/;
      const companyMatch = cardHtml.match(companyRegex);
      const company = companyMatch ? companyMatch[1].replace(/<[^>]+>/g, '').trim() : undefined;

      // Extract salary (optional)
      const salaryRegex = /<span[^>]*class="[^"]*bloko-header-section-2[^"]*"[^>]*>([\s\S]*?)<\/span>/;
      const salaryMatch = cardHtml.match(salaryRegex);
      const salary = salaryMatch ? salaryMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : undefined;

      // Extract location (optional)
      const locationRegex = /<div[^>]*class="[^"]*vacancy-serp-item__meta-info-item[^"]*"[^>]*>([\s\S]*?)<\/div>/;
      const locationMatch = cardHtml.match(locationRegex);
      const location = locationMatch ? locationMatch[1].replace(/<[^>]+>/g, '').trim() : undefined;

      // Check if viewed
      const isViewed = /vacancy-serp-item_visited/.test(cardHtml);

      cards.push({
        vacancyId,
        title,
        company,
        salary,
        url,
        location,
        isViewed,
        cardIndex: index,
      });

      index++;
    } catch (err) {
      console.warn(`[Parser] Failed to parse vacancy card ${index}:`, err);
      index++;
    }
  }

  console.log(`[Parser] Successfully parsed ${cards.length} vacancy cards`);
  FileLogger.log('parser', 'info', 'Parsing complete', { cardsFound: cards.length });
  return cards;
}
