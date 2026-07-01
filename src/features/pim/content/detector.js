import { SELECTORS } from '../constants.js';

/**
 * True si en este frame está visible la pantalla de PIM con el buscador por SKU
 * y la grilla de resultados (pestañas STG/PROD). Se exige la combinación del
 * input de SKU + el botón SEARCH + las pestañas del grid para no confundir con
 * otras pantallas.
 */
export function isPimPage() {
  return Boolean(
    document.querySelector(SELECTORS.productId) &&
    document.querySelector(SELECTORS.searchBtn) &&
    document.querySelector(SELECTORS.gridTabs),
  );
}

export function diagnose() {
  const selectors = {};
  for (const [key, sel] of Object.entries(SELECTORS)) {
    let present = false;
    try { present = Boolean(document.querySelector(sel)); } catch { /* selector contextual */ }
    selectors[key] = { selector: sel, present };
  }
  return {
    detected: isPimPage(),
    url: location.href,
    title: document.title,
    isTopFrame: window === window.top,
    selectors,
  };
}
