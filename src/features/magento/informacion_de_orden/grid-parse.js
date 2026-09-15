// Lectura de lo que devuelve el admin. Todo puro: recibe texto, devuelve datos.
// Sin DOM a proposito, para que sea testeable sin jsdom (el proyecto no lo tiene)
// y para no construir un arbol de 185 KB por cada pagina del grid.
//
// Tres trampas documentadas (docs/intrucciones.md seccion 7) viven aca:
//   1. `ORDER_FILTER_ERROR` llega con HTTP 200 y Content-Type text/html.
//   2. El endpoint del grid devuelve HTML, no JSON: el JSON va embebido.
//   3. Varios campos traen HTML dentro y los importes vienen formateados.

import { FILTER_ERROR_PREFIX, GRID_ENDPOINT_RE } from './constants.js';

const SCRIPT_RE = /<script[^>]+type=["']text\/x-magento-init["'][^>]*>([\s\S]*?)<\/script>/gi;

// -----------------------------------------------------------------------------
// Errores de filtro (no son errores HTTP)
// -----------------------------------------------------------------------------

/** El cuerpo empieza con ORDER_FILTER_ERROR. */
export function isFilterError(text) {
  return String(text || '').trimStart().startsWith(FILTER_ERROR_PREFIX);
}

/** Mensaje del servidor, traducido a algo que se entienda en el registro. */
export function filterErrorMessage(text) {
  const raw = String(text || '').trimStart().slice(FILTER_ERROR_PREFIX.length).trim();
  const lower = raw.toLowerCase();
  if (lower.includes('purchase date')) {
    return 'Magento exige el rango de "Purchase Date" para filtrar el listado de ordenes.';
  }
  if (lower.includes('purchase point')) {
    return 'Magento exige el "Purchase Point" (store view) para filtrar el listado de ordenes.';
  }
  if (lower.includes('date range') || lower.includes('1 month')) {
    return 'El rango no puede superar 1 mes. Acota las fechas (el tope seguro son 28 dias).';
  }
  return raw || 'El grid rechazo los filtros.';
}

// -----------------------------------------------------------------------------
// Extraccion del JSON embebido
// -----------------------------------------------------------------------------

/** Todos los JSON de los bloques `x-magento-init` del HTML. */
function magentoInitPayloads(html) {
  const out = [];
  const source = String(html || '');
  SCRIPT_RE.lastIndex = 0;
  let match = SCRIPT_RE.exec(source);
  while (match) {
    try {
      out.push(JSON.parse(match[1]));
    } catch {
      /* un bloque ilegible no invalida al resto */
    }
    match = SCRIPT_RE.exec(source);
  }
  return out;
}

/** Recorre un objeto buscando los nodos que cumplan `test`. */
function dig(value, test, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (test(value)) found.push(value);
  for (const key of Object.keys(value)) dig(value[key], test, found);
  return found;
}

/**
 * Datos del grid embebidos en su HTML.
 * @param {string} html
 * @returns {{ items: object[], totalRecords: number }|null}
 */
export function extractGridData(html) {
  let best = null;
  for (const payload of magentoInitPayloads(html)) {
    const hits = dig(payload, (node) => Array.isArray(node.items) && node.totalRecords !== undefined);
    for (const hit of hits) {
      // Puede haber mas de un grid montado; nos quedamos con el que trae filas.
      if (!best || (hit.items.length && !best.items.length)) {
        best = { items: hit.items, totalRecords: Number(hit.totalRecords) || 0 };
      }
    }
  }
  return best;
}

/**
 * `update_url` del grid: `.../mui/index/render/key/<GRID_KEY>/`.
 * La key cambia por sesion, asi que siempre se resuelve en runtime.
 * @param {string} html
 * @returns {string} '' si no aparece
 */
export function extractUpdateUrl(html) {
  for (const payload of magentoInitPayloads(html)) {
    const hits = dig(payload, (node) => typeof node.update_url === 'string');
    for (const hit of hits) {
      if (GRID_ENDPOINT_RE.test(hit.update_url)) return hit.update_url;
    }
  }
  // Respaldo: el HTML crudo trae la URL con las barras escapadas (`\/`).
  const flat = String(html || '').replace(/\\\//g, '/');
  const match = GRID_ENDPOINT_RE.exec(flat);
  return match ? match[0] : '';
}

// -----------------------------------------------------------------------------
// Limpieza de valores
// -----------------------------------------------------------------------------

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
};

/** Quita etiquetas y entidades; los `<br>` se vuelven " / ". */
export function stripHtml(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  return String(value)
    .replace(/<br\s*\/?>/gi, ' / ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Importe listo para planilla: "$453,981.00" -> "453981.00", "453981.0000" igual.
 * Devuelve el texto limpio si no parece un numero.
 */
export function moneyValue(value) {
  const text = stripHtml(value);
  if (!text) return '';
  const cleaned = text.replace(/[^\d.,-]/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return text;
  // El grid usa formato en-US: la coma es separador de miles.
  const normalized = cleaned.replace(/,/g, '');
  return Number.isNaN(Number(normalized)) ? text : normalized;
}

/** Campos que llegan como string JSON (`additional_information`, `item_gerp_grid_data`). */
export function parseJsonField(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export const __test = { dig, magentoInitPayloads };
