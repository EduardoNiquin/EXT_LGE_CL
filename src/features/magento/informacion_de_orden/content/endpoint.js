// Resolucion del endpoint del grid de ordenes.
//
// La URL lleva la *admin secret key*, que cambia por sesion y por ruta: no se
// puede fijar en codigo, hay que resolverla en runtime (docs/intrucciones.md
// seccion 4.2). Dos vias, en orden:
//
//   1. El documento actual, si la pestana ya esta en el listado de ordenes: el
//      `update_url` viaja en un <script type="text/x-magento-init">.
//   2. Un fetch al listado. Magento redirige a la URL con key y devuelve el
//      HTML, del que se saca igual.
//
// La key de `mui/index/render` es la misma para todos los grids del admin (el
// grid concreto se elige con el parametro `namespace`), asi que cualquier
// `update_url` que apunte ahi sirve.
//
// Se descarto pedirsela al bridge del mundo MAIN (uiRegistry): no aporta sobre
// parsear el HTML, que ademas funciona estando fuera del listado.

import { ENDPOINT_TIMEOUT_MS, ORDERS_LISTING_PATH } from '../constants.js';
import { ExtError } from '../../../../shared/errors/index.js';
import { adminBaseFrom } from './detector.js';
import { extractUpdateUrl } from '../grid-parse.js';

let cached = '';

/** Descarta la key guardada (util cuando el servidor empieza a rechazarla). */
export function resetEndpointCache() {
  cached = '';
}

export function cachedEndpoint() {
  return cached;
}

/**
 * @param {{ signal?: AbortSignal, force?: boolean }} [opts]
 * @returns {Promise<{ endpoint: string, via: 'cache'|'document'|'fetch' }>}
 */
export async function resolveGridEndpoint({ signal, force = false } = {}) {
  if (cached && !force) return { endpoint: cached, via: 'cache' };

  const fromDocument = extractUpdateUrl(document.documentElement?.outerHTML || '');
  if (fromDocument) {
    cached = fromDocument;
    return { endpoint: cached, via: 'document' };
  }

  const base = adminBaseFrom();
  if (!base) {
    throw new ExtError('La pestana no esta en el admin de Magento, no se puede resolver la key del grid.', {
      code: 'IO_NO_ADMIN',
    });
  }

  const html = await fetchText(`${base}${ORDERS_LISTING_PATH}`, signal);
  const fromListing = extractUpdateUrl(html);
  if (!fromListing) {
    throw new ExtError(
      'No se encontro la key del grid en el listado de ordenes. Revisa que la sesion del admin siga abierta.',
      { code: 'IO_NO_GRID_KEY' },
    );
  }
  cached = fromListing;
  return { endpoint: cached, via: 'fetch' };
}

async function fetchText(url, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENDPOINT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'text/html' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ExtError(`El admin respondio ${response.status} al pedir el listado de ordenes.`, {
        code: 'IO_LISTING_HTTP',
      });
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
