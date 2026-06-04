// Navegación dentro de la SPA (hash routing). Cambiar `location.hash` dispara el
// router de Vue sin recargar la página, así que el flujo async sobrevive. Se
// espera al DOM destino vía un predicado `ready`.

import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { detectPage } from '../detector.js';

function normHash(h) {
  return String(h || '').replace(/\/+$/, '');
}

/**
 * Navega a `hash` y espera a que el DOM destino esté listo.
 * @param {string} hash  ej. '#/ordenes/2665647'
 * @param {object} opts
 * @param {() => any} [opts.ready]  predicado truthy cuando la pantalla cargó
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.timeout=15000]
 * @param {number} [opts.settle=300]  pausa post-render
 */
export async function gotoRoute(hash, { ready, signal, timeout = 15000, settle = 300 } = {}) {
  if (normHash(location.hash) !== normHash(hash)) {
    location.hash = hash;
  }
  if (ready) {
    await waitFor(ready, { signal, timeout, interval: 120, description: `ruta ${hash}` });
  }
  await sleep(settle, signal).catch(() => {});
}

/** Predicado: estamos en una pantalla de cierto PAGE_TYPE. */
export function onPageType(type) {
  return () => (detectPage().type === type ? true : null);
}
