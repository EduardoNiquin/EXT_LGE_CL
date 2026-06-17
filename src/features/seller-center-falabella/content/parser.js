import { SELECTORS } from '../constants.js';
import { getDetalleSections } from './detector.js';

/** Lee el contenido actual de cada sección "Detalle Orden" (útil para debug). */
export function parseSections() {
  return getDetalleSections().map((sec, index) => {
    const summary = sec.querySelector(SELECTORS.summaryButton);
    return {
      index,
      expanded: summary?.getAttribute('aria-expanded') === 'true',
      ordernumber: sec.querySelector(SELECTORS.inputOrderNumber)?.value ?? '',
      guia:        sec.querySelector(SELECTORS.inputGuia)?.value ?? '',
      cantP:       sec.querySelector(SELECTORS.inputCantidad)?.value ?? '',
    };
  });
}
