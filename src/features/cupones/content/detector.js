import { EDIT_URL_RE, LISTING_URL_RE, PAGE_TYPE, SELECTORS, TEXTS } from '../constants.js';

/**
 * Identifica si la página actual es:
 *   - listing  → Cart Price Rules
 *   - edit     → edición de un cupón puntual
 *   - other    → ninguna de las anteriores
 */
export function detectPage() {
  const url = location.href;
  const titleText = document.querySelector(SELECTORS.pageTitle)?.textContent?.trim() || '';
  const editMatch = url.match(EDIT_URL_RE);

  if (editMatch) {
    return {
      type:   PAGE_TYPE.EDIT,
      editId: Number(editMatch[1]),
      url,
      title:  titleText,
    };
  }

  if (
    titleText === TEXTS.PAGE_TITLE_LISTING ||
    (LISTING_URL_RE.test(url) && document.querySelector(SELECTORS.gridTable))
  ) {
    return { type: PAGE_TYPE.LISTING, url, title: titleText };
  }

  return { type: PAGE_TYPE.OTHER, url, title: titleText };
}

export function isListingPage() {
  return detectPage().type === PAGE_TYPE.LISTING;
}

export function isEditPage() {
  return detectPage().type === PAGE_TYPE.EDIT;
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
