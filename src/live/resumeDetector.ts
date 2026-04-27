// Resume detection from HH pages

import { ResumeCandidate } from '../state/types';

export interface ResumeDetectionDebug {
  strategy: 'resumes_list' | 'single_resume_page' | 'resume_links_fallback' | 'no_match';
  candidatesCount: number;
  hashSample: string[];
  titleSample: string[];
  markers: string[];
}

/**
 * Check if page is a resume page
 */
export function isResumePage(html: string, url?: string): boolean {
  // URL check
  if (url) {
    if (url.includes('hh.ru/applicant/resumes') || url.includes('hh.ru/resume/')) {
      return true;
    }
  }

  // HTML markers
  const resumeMarkers = [
    'data-qa="resume"',
    'data-qa="resume-title"',
    'data-qa="resume-block-title"',
    'class="resume-block"',
    'applicant/resumes',
  ];

  return resumeMarkers.some((marker) => html.includes(marker));
}

/**
 * Detect resume candidates from HH HTML
 */
export function detectResumeCandidates(html: string, currentUrl?: string): ResumeCandidate[] {
  const result = detectResumeCandidatesWithDebug(html, currentUrl);
  return result.candidates;
}

/**
 * Detect resume candidates with debug metadata
 */
export function detectResumeCandidatesWithDebug(
  html: string,
  currentUrl?: string
): { candidates: ResumeCandidate[]; debug: ResumeDetectionDebug } {
  const candidates: ResumeCandidate[] = [];
  const markers: string[] = [];
  let strategy: ResumeDetectionDebug['strategy'] = 'no_match';

  // Parse HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Case 1: Resumes list page (applicant/resumes)
  const resumeItems = doc.querySelectorAll('[data-qa="resume-item"]');
  if (resumeItems.length > 0) {
    strategy = 'resumes_list';
    markers.push(`resume-item count=${resumeItems.length}`);

    resumeItems.forEach((item) => {
      const titleElement = item.querySelector('[data-qa="resume-title-link"]');
      const statusElement = item.querySelector('[data-qa="resume-status"]');

      if (titleElement) {
        const href = titleElement.getAttribute('href');
        const title = titleElement.textContent?.trim() || 'Без названия';

        if (href) {
          const hash = extractResumeHash(href);
          if (hash) {
            const isActive = statusElement?.textContent?.includes('Опубликовано') || false;

            candidates.push({
              hash,
              title,
              url: href.startsWith('http') ? href : `https://hh.ru${href}`,
              isActive,
              lastSeenAt: Date.now(),
            });
          }
        }
      }
    });
  }

  // Case 2: Single resume page
  if (candidates.length === 0) {
    const resumeTitleElement =
      doc.querySelector('[data-qa="resume-block-title-position"]') ||
      doc.querySelector('.resume-block__title-text') ||
      doc.querySelector('[data-qa="resume-title"]');

    if (resumeTitleElement && currentUrl) {
      markers.push('single_resume_page: title element found');
      const hash = extractResumeHash(currentUrl);
      if (hash) {
        strategy = 'single_resume_page';
        const title = resumeTitleElement.textContent?.trim() || 'Без названия';

        // Check if published
        const statusElement = doc.querySelector('[data-qa="resume-status"]');
        const isActive = statusElement?.textContent?.includes('Опубликовано') || false;

        candidates.push({
          hash,
          title,
          url: currentUrl,
          isActive,
          lastSeenAt: Date.now(),
        });
      }
    }
  }

  // Case 3: Resume links fallback (broader)
  if (candidates.length === 0) {
    const resumeLinks = doc.querySelectorAll('a[href*="/resume/"]');
    markers.push(`resume_links_fallback: found ${resumeLinks.length} links`);
    const seen = new Set<string>();

    resumeLinks.forEach((link) => {
      const href = link.getAttribute('href');
      if (href) {
        const hash = extractResumeHash(href);
        if (hash && !seen.has(hash)) {
          seen.add(hash);

          const title = link.textContent?.trim() || 'Без названия';

          // Filter out noise: require meaningful title (>3 chars, not just hash)
          if (title.length > 3 && title !== hash) {
            candidates.push({
              hash,
              title,
              url: href.startsWith('http') ? href : `https://hh.ru${href}`,
              lastSeenAt: Date.now(),
            });
          }
        }
      }
    });

    if (candidates.length > 0) {
      strategy = 'resume_links_fallback';
    }
  }

  const debug: ResumeDetectionDebug = {
    strategy,
    candidatesCount: candidates.length,
    hashSample: candidates.slice(0, 3).map((c) => c.hash),
    titleSample: candidates.slice(0, 3).map((c) => c.title),
    markers,
  };

  return { candidates, debug };
}

/**
 * Extract resume hash from URL
 */
function extractResumeHash(url: string): string | null {
  // Pattern: /resume/{hash} or resume={hash}
  // Allow full alphanumeric hashes
  const patterns = [
    /\/resume\/([a-z0-9]+)/i,
    /resume=([a-z0-9]+)/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}
