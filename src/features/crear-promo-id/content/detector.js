import { GP1_ORIGIN, PAGE_PATH, SELECTORS } from '../constants.js';

/**
 * Este frame es GP1 > Promotion Management (suelta o dentro de main.lg).
 * Ojo: la pantalla trae un iframe oculto ("Text Resize Monitor") con la MISMA
 * URL; sin el chequeo del boton NEW ese frame tambien respondia y arrancaba una
 * segunda corrida en paralelo.
 */
export function isPromotionPage() {
  return isPromotionUrl() && Boolean(document.querySelector(SELECTORS.newBtn));
}

/** Solo la URL: en document_idle RUI todavia no armo el boton NEW. */
export function isPromotionUrl() {
  return location.origin === GP1_ORIGIN && location.pathname === PAGE_PATH;
}

export function diagnose() {
  const present = Object.fromEntries(
    Object.entries(SELECTORS)
      .filter(([, sel]) => typeof sel === 'string')
      .map(([key, sel]) => [key, Boolean(document.querySelector(sel))]),
  );
  return {
    detected: isPromotionPage(),
    url: location.href,
    isTopFrame: window === window.top,
    present,
  };
}
