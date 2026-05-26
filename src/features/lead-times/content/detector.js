import { EDIT_URL_RE, PAGE_TYPE, SELECTORS, TEXTS } from '../constants.js';

/**
 * Identifica si estamos en Manage Address Level 2 (listing), Edit Address Level 2,
 * o ninguna de las dos. Se basa en URL + título de la página.
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

  if (titleText === TEXTS.PAGE_TITLE_LISTING) {
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

/** Diagnóstico amigable, expuesto en debug API. */
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
