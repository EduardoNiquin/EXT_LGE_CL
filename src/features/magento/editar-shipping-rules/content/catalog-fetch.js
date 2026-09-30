// Lee TODAS las rules por el endpoint del grid (`mui/index/render`), desde el
// content script: es el mismo origen que el admin, asi que la cookie de sesion
// viaja sola. Es un GET de solo lectura, el mismo que hace la grilla al paginar.
//
// Se prefiere al DOM del listado por dos cosas medidas en vivo: la grilla no
// pinta filas con la pestana en segundo plano, y recuerda la ultima pagina que
// se vio (quedo en la pagina 2 con 200 por pagina => "0 records found").

import { ExtError, isAbortError } from '../../../../shared/errors/index.js';
import { resolveGridEndpoint, resetEndpointCache } from '../../informacion_de_orden/content/endpoint.js';
import { buildRulesGridUrl, parseRulesGrid, slimRule } from '../catalog.js';
import { GRID_MAX_PAGES, GRID_PAGE_SIZE, LISTING_PATH, LISTING_URL_RE } from '../constants.js';
import { adminBaseFrom } from './detector.js';

async function fetchPage(endpoint, page, signal) {
  const response = await fetch(buildRulesGridUrl(endpoint, page, GRID_PAGE_SIZE), {
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html, */*' },
    signal,
  });
  if (!response.ok) {
    throw new ExtError(`El grid de shipping rules respondio ${response.status}.`, { code: 'ESR_GRID_HTTP' });
  }
  const data = parseRulesGrid(await response.text());
  if (!data) {
    throw new ExtError(
      'La respuesta del grid no trae rules. Puede haber caducado la sesion del admin: recarga Magento y vuelve a intentar.',
      { code: 'ESR_NO_DATA' },
    );
  }
  return data;
}

/**
 * @returns {Promise<{ rules: object[], totalRecords: number, adminBase: string, listingUrl: string }>}
 */
export async function fetchAllRules({ signal } = {}) {
  let { endpoint } = await resolveGridEndpoint({ signal });
  let first;
  try {
    first = await fetchPage(endpoint, 1, signal);
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    // La key cacheada pudo vencer: se resuelve de nuevo una vez.
    resetEndpointCache();
    ({ endpoint } = await resolveGridEndpoint({ signal, force: true }));
    first = await fetchPage(endpoint, 1, signal);
  }

  const items = [...first.items];
  const total = first.totalRecords;
  for (let page = 2; items.length < total && page <= GRID_MAX_PAGES; page += 1) {
    const next = await fetchPage(endpoint, page, signal);
    if (!next.items.length) break;
    items.push(...next.items);
  }

  const seen = new Set();
  const rules = items.map(slimRule).filter((rule) => {
    if (!rule.id || seen.has(rule.id)) return false;
    seen.add(rule.id);
    return true;
  });
  return {
    rules,
    totalRecords: total,
    adminBase: adminBaseFrom(),
    listingUrl: listingUrlFromPage(),
  };
}

/**
 * URL del listado CON su key: sin ella Magento redirige al dashboard. Si no se
 * esta en el listado, sale del menu lateral, que esta en todas las pantallas.
 */
export function listingUrlFromPage() {
  if (LISTING_URL_RE.test(location.href)) return location.href;
  const link = document.querySelector(`a[href*="${LISTING_PATH}"]`);
  if (link?.href) return link.href;
  const base = adminBaseFrom();
  return base ? `${base}${LISTING_PATH}` : '';
}
