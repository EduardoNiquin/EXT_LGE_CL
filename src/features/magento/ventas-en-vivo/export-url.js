// Piezas puras de "Ventas en vivo": sin DOM ni chrome.*, testeables tal cual.
//
//   - de donde salen la URL del export (la config del boton Export del listado)
//     y la de "Export Files Listing" (el menu lateral del mismo HTML),
//   - como se arma la consulta (los mismos filtros que el grid),
//   - como se reconoce el encolado, el login del admin y un CSV de ordenes,
//   - el rango de dias en fecha de Chile.
//
// La lectura de la lista de exports vive en export-list.js.

import {
  ENCOLADO_RE,
  EXPORT_LIST_PATH_RE,
  EXPORT_LIST_URL_RE,
  EXPORT_URL_RE,
  GRID_NAMESPACE,
  LISTADO_ORDENES_RE,
  STORE_ID,
  ZONA_HORARIA,
} from './constants.js';
import { magentoInitPayloads } from '../informacion_de_orden/grid-parse.js';
import { toGridDate } from '../informacion_de_orden/grid-request.js';

// -----------------------------------------------------------------------------
// URL del export
// -----------------------------------------------------------------------------

/** Todos los strings de un objeto JSON (recorrido en profundidad). */
function stringsDe(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) stringsDe(value[key], out);
  }
  return out;
}

function casarExportUrl(texto) {
  const match = EXPORT_URL_RE.exec(String(texto || ''));
  return match ? match[0] : '';
}

/**
 * URL `.../mui/export/gridToCsv/key/<K>/` del HTML del listado de ordenes.
 *
 * Viene en la config del boton Export (`exportButton` -> `options` -> `cvs|csv`
 * -> `url`) dentro de un `<script type="text/x-magento-init">`. Primero se busca
 * en ese JSON; si no aparece (layout distinto, JSON roto), en el HTML crudo con
 * las barras des-escapadas (`\/`).
 *
 * @param {string} html
 * @returns {string} '' si no aparece
 */
export function extractExportUrl(html) {
  for (const payload of magentoInitPayloads(html)) {
    for (const texto of stringsDe(payload)) {
      const url = casarExportUrl(texto);
      if (url) return url;
    }
  }
  const plano = String(html || '').replace(/\\\//g, '/');
  return casarExportUrl(plano);
}

/**
 * URL de "Export Files Listing" (`.../lg_order_export/export/index/key/<K>/`).
 *
 * Viaja en el menu lateral de cualquier pagina del admin, incluido el listado de
 * ordenes: escapada dentro de JSON (`lg_order_export\/export\/index\/key\/..`)
 * o suelta en un `href`. Se des-escapa `\/` antes de buscar. Si solo aparece la
 * ruta sin host, se completa con el origen de `adminBase`.
 *
 * @param {string} html
 * @param {string} [adminBase]  'https://host/obsadm' (para un href relativo)
 * @returns {string} '' si no aparece
 */
export function extractExportListUrl(html, adminBase = '') {
  const plano = String(html || '').replace(/\\\//g, '/');
  const absoluta = mejorCandidata(plano, EXPORT_LIST_URL_RE);
  if (absoluta) return absoluta;
  const relativa = mejorCandidata(plano, EXPORT_LIST_PATH_RE);
  if (!relativa) return '';
  try {
    return new URL(relativa, String(adminBase || '')).href;
  } catch {
    return '';
  }
}

/** Todas las coincidencias de `re`; gana la primera que trae `/key/` (sin key el admin redirige al dashboard). */
function mejorCandidata(texto, re) {
  const todas = [...texto.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))].map((m) => m[0]);
  return todas.find((url) => /\/key\//i.test(url)) || todas[0] || '';
}

/**
 * URL lista para encolar el export de un rango.
 *
 * Es la que arma el boton Export real, con sus parametros y en su orden:
 * `filters[placeholder]`, `filters[store_id][]`, `filters[created_at][from|to]`
 * (formato del datepicker del grid), `search`, `namespace` y `selected=false`
 * (= "todas las filas del filtro"). La tienda es OBLIGATORIA: sin ella el
 * servidor contesta 500; vacia = `STORE_ID` (123, Chile).
 *
 * @param {string} exportUrl
 * @param {{ from: string, to: string, storeId?: string }} rango  fechas 'YYYY-MM-DD'
 */
export function buildExportUrl(exportUrl, { from, to, storeId = '' } = {}) {
  const base = String(exportUrl || '').replace(/[?#].*$/, '');
  const params = new URLSearchParams();
  params.set('filters[placeholder]', 'true');
  params.append('filters[store_id][]', String(storeId ?? '').trim() || STORE_ID);
  params.set('filters[created_at][from]', toGridDate(from));
  params.set('filters[created_at][to]', toGridDate(to));
  params.set('search', '');
  params.set('namespace', GRID_NAMESPACE);
  params.set('selected', 'false');
  return `${base}?${params.toString()}`;
}

/**
 * Primer mensaje de error del bloque de mensajes del admin ('' si no hay).
 * Sirve para explicar un encolado que no salio.
 */
export function mensajeErrorAdmin(html) {
  // Bloque de mensajes del admin: <div data-ui-id="messages-message-error">texto</div>
  const match = /<div[^>]*data-ui-id=["']messages-message-error["'][^>]*>([\s\S]*?)<\/div>/i.exec(String(html || ''));
  if (!match) return '';
  return match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * El export quedo encolado: el GET a gridToCsv termino (302 seguido) en el
 * listado de ordenes con el mensaje "Message is added to queue, wait to get
 * your file soon". Vale el texto solo, o la redireccion al listado sin un
 * mensaje de error del admin.
 *
 * @param {{ redirected?: boolean, url?: string }} res  respuesta final del fetch
 * @param {string} html
 */
export function isEncolado(res, html) {
  if (ENCOLADO_RE.test(String(html || ''))) return true;
  const redirigido = Boolean(res?.redirected) && LISTADO_ORDENES_RE.test(String(res?.url || ''));
  return redirigido && !mensajeErrorAdmin(html) && !isLoginPage(html);
}

/** Normaliza la base del admin ('https://host/obsadm', sin barra final). */
export function normalizarAdminBase(base, fallback) {
  const limpio = String(base || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/]+\/[^/]*obsadm$/i.test(limpio) ? limpio : fallback;
}

/** `form_key` del admin (para el POST que borra el archivo del export). '' si no esta. */
export function extractFormKey(html) {
  const texto = String(html || '');
  const match = /FORM_KEY\s*=\s*['"]([^'"]+)['"]/.exec(texto)
    || /name=["']form_key["'][^>]*value=["']([^"']+)["']/i.exec(texto)
    || /value=["']([^"']+)["'][^>]*name=["']form_key["']/i.exec(texto);
  return match ? match[1] : '';
}

// -----------------------------------------------------------------------------
// Que devolvio el admin
// -----------------------------------------------------------------------------

/**
 * La respuesta es el login del admin (sesion caducada). Tambien cubre la
 * respuesta AJAX de sesion vencida (`{"ajaxExpired":1,...}`).
 */
export function isLoginPage(html) {
  const texto = String(html || '');
  if (!texto) return false;
  return /id=["']login-form["']/i.test(texto)
    || /name=["']login\[username\]["']/i.test(texto)
    || /class=["'][^"']*\badmin__login\b/i.test(texto)
    || /["']?ajaxExpired["']?\s*:\s*["']?1/.test(texto);
}

/** Primera linea, sin BOM. */
function primeraLinea(texto) {
  const limpio = String(texto || '').replace(/^\uFEFF/, '');
  const fin = limpio.search(/\r?\n/);
  return fin === -1 ? limpio : limpio.slice(0, fin);
}

/** Celdas de la cabecera (separador `,` o `;`, con o sin comillas). */
export function cabeceraCsv(texto) {
  const linea = primeraLinea(texto);
  if (!linea.trim()) return [];
  const sep = (linea.match(/;/g) || []).length > (linea.match(/,/g) || []).length ? ';' : ',';
  return linea.split(sep).map((celda) => celda.trim().replace(/^"(.*)"$/, '$1').trim());
}

/** El texto es un CSV de ordenes: la cabecera trae una columna `ID`. */
export function looksLikeOrdersCsv(text) {
  const linea = primeraLinea(text).trim();
  if (!linea || linea.startsWith('<') || linea.startsWith('{')) return false;
  return cabeceraCsv(text).some((celda) => celda.toUpperCase() === 'ID');
}

/**
 * Filas de datos del CSV (sin la cabecera). Cuenta saltos de linea fuera de
 * comillas, asi una direccion con salto de linea no suma una fila de mas.
 */
export function contarFilasCsv(text) {
  const texto = String(text || '');
  let filas = 0;
  let enComillas = false;
  let lineaConContenido = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (c === '"') {
      enComillas = !enComillas;
      lineaConContenido = true;
    } else if (c === '\n' && !enComillas) {
      if (lineaConContenido) filas += 1;
      lineaConContenido = false;
    } else if (c !== '\r') {
      lineaConContenido = true;
    }
  }
  if (lineaConContenido) filas += 1;
  return Math.max(0, filas - 1);
}

// -----------------------------------------------------------------------------
// Fechas (hora de Chile)
// -----------------------------------------------------------------------------

/** 'YYYY-MM-DD' de un instante, en la zona dada (Intl, no toISOString). */
export function fechaEnZona(ahora, zona = ZONA_HORARIA) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ahora));
  const valor = (tipo) => partes.find((p) => p.type === tipo)?.value || '';
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

/** Suma `dias` a una fecha 'YYYY-MM-DD' (aritmetica de calendario, en UTC). */
export function sumarDias(ymd, dias) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * Rango de `dias` dias contados en Chile, ambos extremos incluidos, que
 * empieza hace `dias - 1` dias y termina MANANA.
 *
 * Termina manana y no hoy porque el filtro `created_at` del grid se interpreta
 * en la zona horaria de Magento, que es Europe/London (medido el 01-10-2026:
 * una orden de las 20:30 de Chile ya es del dia siguiente en Londres). Con
 * `to = hoy` las ordenes de la tarde-noche chilena quedaban fuera del export
 * hasta el dia siguiente. Un `to` en el futuro no trae nada de mas.
 *
 * @param {Date|number} hoy  instante de referencia
 * @param {number} dias      >= 1
 * @returns {{ from: string, to: string }}
 */
export function rangoDeDias(hoy, dias) {
  const n = Math.max(1, Math.round(Number(dias)) || 1);
  const hoyChile = fechaEnZona(hoy);
  return { from: sumarDias(hoyChile, -(n - 1)), to: sumarDias(hoyChile, 1) };
}
