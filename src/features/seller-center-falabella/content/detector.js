import { SELECTORS, TEXTS } from '../constants.js';

/**
 * Devuelve los <lightning-accordion-section> que son "Detalle Orden", en orden
 * de DOM (== orden visual == índice). Se filtra por el título del summary y la
 * presencia del input de número de orden para no confundir con otros acordeones
 * de la página de Soporte.
 */
export function getDetalleSections(root = document) {
  return Array.from(root.querySelectorAll(SELECTORS.section)).filter((sec) => {
    const title = sec.querySelector(SELECTORS.summaryContent);
    const titleOk = title && title.textContent.trim().toLowerCase().startsWith(TEXTS.SECTION_TITLE.toLowerCase());
    return titleOk && sec.querySelector(SELECTORS.inputOrderNumber);
  });
}

/**
 * True si en este frame está visible el formulario de "Detalle Orden". Se aceptan
 * dos señales: el componente LWC propio, o la combinación de los 3 inputs por
 * `name` (robusto ante cambios de nombre del custom element).
 */
export function isSupportSellerPage() {
  if (document.querySelector(SELECTORS.supportComponent)) return true;
  const hasInputs =
    document.querySelector(SELECTORS.inputOrderNumber) &&
    document.querySelector(SELECTORS.inputGuia) &&
    document.querySelector(SELECTORS.inputCantidad);
  return Boolean(hasInputs && getDetalleSections().length > 0);
}

export function diagnose() {
  const sections = getDetalleSections();
  const selectors = {};
  for (const [key, sel] of Object.entries(SELECTORS)) {
    let present = false;
    try { present = Boolean(document.querySelector(sel)); } catch { /* selector contextual */ }
    selectors[key] = { selector: sel, present };
  }
  return {
    detected: isSupportSellerPage(),
    sectionCount: sections.length,
    url: location.href,
    title: document.title,
    isTopFrame: window === window.top,
    selectors,
  };
}
