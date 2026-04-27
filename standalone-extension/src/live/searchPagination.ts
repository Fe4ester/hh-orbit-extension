/**
 * Search pagination detection and navigation
 */

export function detectCurrentSearchPage(url: string): number {
  const urlObj = new URL(url);
  const pageParam = urlObj.searchParams.get('page');

  if (pageParam !== null) {
    const parsed = parseInt(pageParam, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 0; // default first page
}

export function detectTotalPages(html: string): number | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Strategy 1: pager items with data-page attributes
  const pagerItems = doc.querySelectorAll('[data-qa="pager-page"]');
  if (pagerItems.length > 0) {
    let maxPage = 0;
    pagerItems.forEach((item) => {
      const pageAttr = item.getAttribute('data-page');
      if (pageAttr) {
        const pageNum = parseInt(pageAttr, 10);
        if (!isNaN(pageNum) && pageNum > maxPage) {
          maxPage = pageNum;
        }
      }
    });
    if (maxPage > 0) {
      return maxPage;
    }
  }

  // Strategy 2: pagination links with page param
  const links = doc.querySelectorAll('a[href*="page="]');
  let maxPage = 0;
  links.forEach((link) => {
    const href = link.getAttribute('href');
    if (href) {
      const match = href.match(/page=(\d+)/);
      if (match) {
        const pageNum = parseInt(match[1], 10);
        if (!isNaN(pageNum) && pageNum > maxPage) {
          maxPage = pageNum;
        }
      }
    }
  });

  return maxPage > 0 ? maxPage : null;
}

export function findNextPageUrl(currentUrl: string): string | null {
  const currentPage = detectCurrentSearchPage(currentUrl);
  const urlObj = new URL(currentUrl);
  urlObj.searchParams.set('page', String(currentPage + 1));
  return urlObj.toString();
}

export function hasNextPage(currentUrl: string, html?: string): boolean {
  if (!html) {
    return true; // optimistic if no HTML
  }

  const currentPage = detectCurrentSearchPage(currentUrl);
  const totalPages = detectTotalPages(html);

  if (totalPages === null) {
    return true; // unknown, assume yes
  }

  return currentPage < totalPages;
}
