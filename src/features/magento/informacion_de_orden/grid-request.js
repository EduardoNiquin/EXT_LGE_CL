// Armado de la consulta al grid de ordenes. Puro y testeable: no toca red ni DOM.
//
// Los tres filtros de LG son OBLIGATORIOS (docs/intrucciones.md seccion 4.4): sin
// rango de fechas, sin Purchase Point, o con un rango de mas de un mes, el
// servidor contesta 200 con un cuerpo `ORDER_FILTER_ERROR`. Por eso van siempre,
// aunque lo que se busque sea una sola orden.

import { GRID_NAMESPACE, LIST_PAGE_SIZE, PAGE_SIZE, STORE_ID } from './constants.js';

/**
 * Fecha del datepicker del grid: M/DD/YYYY, con el mes SIN cero a la izquierda.
 * Al reves el filtro no aplica.
 * @param {string} iso 'YYYY-MM-DD'
 */
export function toGridDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!match) return '';
  const [, year, month, day] = match;
  return `${Number(month)}/${day}/${year}`;
}

/**
 * Parametros de una consulta al grid.
 * @param {object} o
 * @param {string} o.from          'YYYY-MM-DD' (obligatorio)
 * @param {string} o.to            'YYYY-MM-DD' (obligatorio)
 * @param {string} [o.storeId]     Purchase Point (obligatorio; default Chile)
 * @param {string} [o.incrementId] numero de orden puntual (modo lista)
 * @param {number} [o.page]        pagina 1..N
 * @param {number} [o.pageSize]
 * @returns {URLSearchParams}
 */
export function buildGridParams({
  from,
  to,
  storeId = STORE_ID,
  incrementId = '',
  page = 1,
  pageSize = incrementId ? LIST_PAGE_SIZE : PAGE_SIZE,
} = {}) {
  const params = new URLSearchParams();
  params.set('namespace', GRID_NAMESPACE);
  params.set('search', '');
  params.set('filters[placeholder]', 'true');
  params.set('filters[created_at][from]', toGridDate(from));
  params.set('filters[created_at][to]', toGridDate(to));
  params.append('filters[store_id][]', String(storeId));
  if (incrementId) params.set('filters[increment_id]', String(incrementId).trim());
  params.set('paging[pageSize]', String(pageSize));
  params.set('paging[current]', String(page));
  params.set('sorting[field]', 'created_at');
  params.set('sorting[direction]', 'desc');
  params.set('isAjax', 'true');
  return params;
}

/** Endpoint + parametros, listo para `fetch`. */
export function buildGridUrl(endpoint, options) {
  const base = String(endpoint || '').replace(/\?.*$/, '');
  return `${base}${base.includes('?') ? '&' : '?'}${buildGridParams(options).toString()}`;
}

/** Dias que abarca un rango (ambos extremos ISO). NaN si alguno es invalido. */
export function rangeDays(from, to) {
  const start = Date.parse(`${from}T00:00:00`);
  const end = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end)) return NaN;
  return Math.round((end - start) / 86400000);
}
