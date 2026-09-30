// Catalogo de rules (lo que el popup muestra para elegir) y filtros. Todo puro:
// recibe los items crudos del grid y devuelve datos, sin DOM ni red.

import { extractGridData } from '../informacion_de_orden/grid-parse.js';
import { GRID_NAMESPACE, GRID_PAGE_SIZE } from './constants.js';

/** Parametros de una pagina del grid de rules, ordenado por ID ascendente. */
export function buildRulesGridUrl(endpoint, page = 1, pageSize = GRID_PAGE_SIZE) {
  const params = new URLSearchParams();
  params.set('namespace', GRID_NAMESPACE);
  params.set('search', '');
  params.set('filters[placeholder]', 'true');
  params.set('paging[pageSize]', String(pageSize));
  params.set('paging[current]', String(page));
  params.set('sorting[field]', 'entity_id');
  params.set('sorting[direction]', 'asc');
  params.set('isAjax', 'true');
  const base = String(endpoint || '').replace(/\?.*$/, '');
  return `${base}?${params.toString()}`;
}

/** Items crudos del HTML que devuelve `mui/index/render` (null si no vienen). */
export function parseRulesGrid(html) {
  return extractGridData(html);
}

/** `is_active` llega como "0"/"1" (o numero/booleano segun la version). */
export function toActive(value) {
  if (typeof value === 'boolean') return value;
  return String(value ?? '').trim() === '1' || String(value ?? '').trim().toLowerCase() === 'true';
}

/** Deja de una fila del grid solo lo que se muestra, se filtra y se exporta. */
export function slimRule(item) {
  const source = item || {};
  const text = (value) => String(value ?? '').trim();
  return {
    id: text(source.entity_id),
    nameFe: text(source.name_fe),
    nameBe: text(source.name_be),
    isActive: toActive(source.is_active),
    website: text(source.website_id),
    carrier: text(source.carrier_id),
    description: text(source.description),
    shippingCode: text(source.shipping_code),
    startDate: text(source.start_date),
    endDate: text(source.end_date),
    priority: text(source.priority),
    deliveryFee: text(source.delivery_fee),
    updatedAt: text(source.updated_at),
    editHref: text(source.actions?.edit?.href),
  };
}

/** Estado legible. */
export function activeLabel(isActive) {
  if (isActive === true) return 'Activa';
  if (isActive === false) return 'Inactiva';
  return '';
}

/**
 * Terminos de busqueda: se separan por salto de linea, coma o punto y coma, asi
 * se puede pegar una lista de IDs o de nombres sacada de una planilla. Un
 * termino que no trae separadores se toma entero ("Rule 66" no se parte).
 */
export function parseTerms(text) {
  return String(text || '')
    .split(/[\n\r,;\t]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Coincide si ALGUN termino calza. Un termino solo numerico calza con el ID
 * exacto o como numero completo dentro del texto ("66" trae las "[Rule 66]" pero
 * no la #1466 ni la "[Rule 660]"); cualquier otro busca por contenido en
 * nombres, codigo, carrier y descripcion, sin tildes ni mayusculas.
 */
export function matchesTerms(rule, terms) {
  if (!terms.length) return true;
  const haystack = normalize([
    rule.nameFe, rule.nameBe, rule.shippingCode, rule.carrier, rule.description,
  ].join(' | '));
  return terms.some((term) => {
    if (/^\d+$/.test(term)) {
      return rule.id === term || new RegExp(`(^|\\D)${term}(\\D|$)`).test(haystack);
    }
    return haystack.includes(normalize(term));
  });
}

/**
 * @param {Array} rules  salida de `slimRule`
 * @param {object} filters
 * @param {string} [filters.text]     terminos (ver parseTerms)
 * @param {'all'|'active'|'inactive'} [filters.status]
 * @param {string} [filters.carrier]  '' = todos
 */
export function filterRules(rules, { text = '', status = 'all', carrier = '' } = {}) {
  const terms = parseTerms(text);
  return (Array.isArray(rules) ? rules : []).filter((rule) => {
    if (status === 'active' && !rule.isActive) return false;
    if (status === 'inactive' && rule.isActive) return false;
    if (carrier && rule.carrier !== carrier) return false;
    return matchesTerms(rule, terms);
  });
}

/** Terminos numericos (IDs) que no aparecen en el catalogo: se avisan en la UI. */
export function missingIds(rules, text) {
  const ids = new Set((rules || []).map((rule) => rule.id));
  return parseTerms(text).filter((term) => /^\d+$/.test(term) && !ids.has(term));
}

export function uniqueCarriers(rules) {
  return Array.from(new Set((rules || []).map((rule) => rule.carrier).filter(Boolean))).sort();
}

export const __test = { normalize };
