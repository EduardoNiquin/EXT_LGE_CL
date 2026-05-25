import { SELECTORS } from '../constants.js';

const REQUIRED = ['searchForm', 'searchPanel', 'tabView', 'gridStg'];

export function isMarketingInfoMappingPage() {
  return REQUIRED.every((key) => Boolean(document.querySelector(SELECTORS[key])));
}

export function diagnose() {
  const found = {};
  for (const [key, sel] of Object.entries(SELECTORS)) {
    found[key] = { selector: sel, present: Boolean(document.querySelector(sel)) };
  }

  const missing = REQUIRED.filter((k) => !found[k].present);

  const iframes = Array.from(document.querySelectorAll('iframe')).map((f) => ({
    id:   f.id || null,
    name: f.name || null,
    src:  f.getAttribute('src') || '(sin src)',
  }));

  return {
    detected:   missing.length === 0,
    required:   REQUIRED,
    missing,
    selectors:  found,
    url:        location.href,
    title:      document.title,
    isTopFrame: window === window.top,
    iframeCount: iframes.length,
    iframes,
  };
}
