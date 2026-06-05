import {
  ORDER_VIEW_URL_RE,
  ORDERS_LISTING_URL_RE,
  PAGE_TYPE,
  SELECTORS,
  TEXTS,
} from '../constants.js';

/**
 * Identifica la página actual de Magento:
 *   - order-view → detalle de una orden (/sales/order/view/order_id/N)
 *   - listing    → grid de órdenes (/sales/order/index)
 *   - other      → ninguna de las anteriores
 */
export function detectPage() {
  const url = location.href;
  const titleText = document.querySelector(SELECTORS.pageTitle)?.textContent?.trim() || '';

  const viewMatch = url.match(ORDER_VIEW_URL_RE);
  if (viewMatch || document.querySelector(SELECTORS.orderInfoTable)) {
    return {
      type:    PAGE_TYPE.ORDER_VIEW,
      orderId: viewMatch ? Number(viewMatch[1]) : null,
      url,
      title:   titleText,
    };
  }

  if (
    titleText === TEXTS.PAGE_TITLE_LISTING ||
    (ORDERS_LISTING_URL_RE.test(url) && document.querySelector(SELECTORS.searchInput))
  ) {
    return { type: PAGE_TYPE.LISTING, url, title: titleText };
  }

  return { type: PAGE_TYPE.OTHER, url, title: titleText };
}

export function isOrderViewPage() {
  return detectPage().type === PAGE_TYPE.ORDER_VIEW;
}

export function isListingPage() {
  return detectPage().type === PAGE_TYPE.LISTING;
}

export function diagnose() {
  const page = detectPage();
  const selectors = {};
  for (const [key, sel] of Object.entries(SELECTORS)) {
    selectors[key] = { selector: sel, present: Boolean(document.querySelector(sel)) };
  }
  return {
    page,
    isTopFrame: window === window.top,
    selectors,
  };
}
