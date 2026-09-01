import { LISTING_URL_RE, ORDER_VIEW_URL_RE, PAGE_TYPE, SELECTORS, TEXTS } from '../constants.js';

export function detectPage() {
  const url = location.href;
  const title = document.querySelector(SELECTORS.pageTitle)?.textContent?.trim() || '';

  // El detalle se evalua primero: su URL tambien empieza con /sales/order/.
  const detail = url.match(ORDER_VIEW_URL_RE);
  if (detail || document.querySelector(SELECTORS.orderInfoTable)) {
    return { type: PAGE_TYPE.ORDER_VIEW, entityId: detail?.[1] || '', url, title };
  }
  if (LISTING_URL_RE.test(url) || title === TEXTS.PAGE_TITLE_LISTING) {
    return { type: PAGE_TYPE.LISTING, url, title };
  }
  return { type: PAGE_TYPE.OTHER, url, title };
}

export function findOrdersTable() {
  return Array.from(document.querySelectorAll(SELECTORS.gridTable)).find((table) => {
    const headers = table.querySelector('thead')?.textContent || '';
    return headers.includes('Purchase Date') && headers.includes('Purchase Point');
  }) || document.querySelector(SELECTORS.gridTable);
}

export function diagnose() {
  const page = detectPage();
  return {
    page,
    isTopFrame: window === window.top,
    ordersTable: Boolean(findOrdersTable()),
    rows: document.querySelectorAll(SELECTORS.gridRow).length,
    filtersOpen: Boolean(document.querySelector(SELECTORS.filtersWrapActive)),
    notes: document.querySelectorAll(SELECTORS.noteItem).length,
  };
}
