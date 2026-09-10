import {
  EDIT_URL_RE,
  LISTING_URL_RE,
  NEW_URL_RE,
  PAGE_TYPE,
  SELECTORS,
} from '../constants.js';

export function detectPage() {
  const url = location.href;
  const title = document.querySelector(SELECTORS.pageTitle)?.textContent?.trim() || '';

  const edit = url.match(EDIT_URL_RE);
  if (edit) return { type: PAGE_TYPE.EDIT, packageId: edit[1], url, title };
  if (NEW_URL_RE.test(url)) return { type: PAGE_TYPE.NEW, packageId: '', url, title };
  if (LISTING_URL_RE.test(url)) return { type: PAGE_TYPE.LISTING, packageId: '', url, title };
  return { type: PAGE_TYPE.OTHER, packageId: '', url, title };
}

/** Website activo segun el selector de scope del listado ("Select Website" si no hay ninguno). */
export function currentWebsiteLabel() {
  return document.querySelector(SELECTORS.websiteButton)?.textContent?.trim() || '';
}

export function diagnose() {
  const page = detectPage();
  return {
    page,
    isTopFrame: window === window.top,
    website: currentWebsiteLabel(),
    addButton: Boolean(document.querySelector(SELECTORS.addButton)),
    gridRows: document.querySelectorAll(SELECTORS.gridRow).length,
    parentForm: Boolean(document.querySelector(SELECTORS.storeSelect)),
    addOfferButton: Boolean(document.querySelector(SELECTORS.addOfferButton)),
    saveAndContinue: Boolean(document.querySelector(SELECTORS.saveAndContinue)),
    save: Boolean(document.querySelector(SELECTORS.save)),
    offerModalOpen: Boolean(document.querySelector(SELECTORS.offerModal)),
  };
}
