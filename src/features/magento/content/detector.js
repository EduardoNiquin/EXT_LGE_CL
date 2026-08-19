import { DETAIL_URL_RE, LISTING_URL_RE, PAGE_TYPE, SELECTORS } from '../constants.js';

export function detectPage() {
  const url = location.href;
  const title = document.querySelector(SELECTORS.pageTitle)?.textContent?.trim() || '';
  const detailMatch = url.match(DETAIL_URL_RE);

  if (detailMatch) {
    return { type: PAGE_TYPE.DETAIL, ruleId: detailMatch[1], url, title };
  }
  if (LISTING_URL_RE.test(url)) {
    return { type: PAGE_TYPE.LISTING, url, title };
  }
  return { type: PAGE_TYPE.OTHER, url, title };
}

export function findListingTable() {
  return Array.from(document.querySelectorAll(SELECTORS.listingTable)).find((table) => {
    const headers = table.querySelector('thead')?.textContent || '';
    return headers.includes('Shipping Rule Name (FE)');
  }) || null;
}

export function diagnose() {
  const page = detectPage();
  return {
    page,
    isTopFrame: window === window.top,
    listingTable: Boolean(findListingTable()),
    detailReady: Boolean(document.querySelector(SELECTORS.detailReady)),
    regionalRoot: Boolean(document.querySelector(SELECTORS.regionalRoot)),
  };
}
