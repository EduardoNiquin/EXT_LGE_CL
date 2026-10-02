// Lectura PURA de "Export Files Listing" (lg_order_export/export/index): sin
// DOM ni chrome.*, testeable tal cual.
//
// Los archivos vienen embebidos en el HTML como JSON escapado (data provider de
// un UI grid), un objeto por archivo:
//
//   {"id":"517903","type":"order","status":"success","file_path":"order_...csv",
//    "user_id":"7524","notified":"1","id_link":"1790888322.02",
//    "export_time":"2026-10-01 21:59:16","start_time":"2026-10-01 20:58:42",
//    "actions":{"view":{"href":"https:\/\/shop.lg.com\/obsadm\/lg_order_export\/export_file\/download\/id\/517903\/key\/..\/","label":"Download"},
//               "delete":{"href":"...\/export_file\/delete\/id\/517903\/key\/..\/","label":"Delete","confirm":{...},"post":true}}}
//
// Se des-escapa `\/`, se ubica el comienzo de cada objeto (`{"id":"<n>"`), se
// recorta el objeto contando llaves (respetando strings) y se parsea con
// JSON.parse: no depende del orden de las demas claves.

import { EXPORT_STATUS_FALLO, EXPORT_STATUS_OK, EXPORT_TIPO_ORDEN } from './constants.js';

// Comienzo de un item: el id como string o numero.
const INICIO_ITEM_RE = /\{\s*"id"\s*:\s*"?\d+"?\s*,/g;

/** Desde `inicio` (una `{`), el indice justo despues de su `}`; -1 si no cierra. */
function finDeObjeto(texto, inicio) {
  let nivel = 0;
  let enString = false;
  for (let i = inicio; i < texto.length; i += 1) {
    const c = texto[i];
    if (enString) {
      if (c === '\\') i += 1;
      else if (c === '"') enString = false;
    } else if (c === '"') {
      enString = true;
    } else if (c === '{') {
      nivel += 1;
    } else if (c === '}') {
      nivel -= 1;
      if (nivel === 0) return i + 1;
    }
  }
  return -1;
}

function texto(valor) {
  return valor == null ? '' : String(valor);
}

/** Objeto crudo -> item normalizado (null si no tiene la forma de un archivo). */
function normalizarItem(crudo) {
  const id = Number(crudo?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (crudo.type == null && crudo.status == null) return null;
  const acciones = crudo.actions && typeof crudo.actions === 'object' ? crudo.actions : {};
  return {
    id,
    type: texto(crudo.type).trim().toLowerCase(),
    status: texto(crudo.status).trim().toLowerCase(),
    file_path: texto(crudo.file_path),
    export_time: texto(crudo.export_time),
    start_time: texto(crudo.start_time),
    downloadUrl: texto(acciones.view?.href),
    deleteUrl: texto(acciones.delete?.href),
  };
}

function parsearEn(plano) {
  const porId = new Map();
  INICIO_ITEM_RE.lastIndex = 0;
  let match;
  while ((match = INICIO_ITEM_RE.exec(plano)) !== null) {
    const inicio = match.index;
    const fin = finDeObjeto(plano, inicio);
    if (fin === -1) continue;
    let crudo = null;
    try { crudo = JSON.parse(plano.slice(inicio, fin)); } catch { /* objeto que no es JSON valido */ }
    const item = normalizarItem(crudo);
    // Un mismo archivo puede aparecer dos veces (config + data): manda el primero completo.
    if (item && !porId.has(item.id)) porId.set(item.id, item);
    if (item) INICIO_ITEM_RE.lastIndex = fin;
  }
  return [...porId.values()].sort((a, b) => a.id - b.id);
}

/**
 * Archivos de la lista de exports, del id mas viejo al mas nuevo.
 * @param {string} html
 * @returns {Array<{id:number, type:string, status:string, file_path:string,
 *   export_time:string, start_time:string, downloadUrl:string, deleteUrl:string}>}
 */
export function parseExportItems(html) {
  const plano = String(html || '').replace(/\\\//g, '/');
  const items = parsearEn(plano);
  if (items.length || !plano.includes('\\"id\\"')) return items;
  // JSON dentro de un string JSON: las comillas tambien vienen escapadas.
  return parsearEn(plano.replace(/\\"/g, '"'));
}

/** El mayor `id` de la lista (0 si no hay ninguno). */
export function maxIdDe(items) {
  return (Array.isArray(items) ? items : []).reduce((max, item) => Math.max(max, Number(item?.id) || 0), 0);
}

/**
 * El archivo de ESTE ciclo: el primer item de tipo `order` con `id > maxId`
 * (la foto de la lista se saca justo antes de encolar, asi que el primero
 * nuevo es el nuestro). Puede venir aun pendiente: lo decide `estadoDe`.
 * @returns {object|null}
 */
export function pickNuevo(items, maxId) {
  const tope = Number(maxId) || 0;
  const nuevos = (Array.isArray(items) ? items : [])
    .filter((item) => item && item.id > tope && item.type === EXPORT_TIPO_ORDEN)
    .sort((a, b) => a.id - b.id);
  return nuevos[0] || null;
}

/** 'listo' | 'fallo' | 'pendiente' segun el `status` del item. */
export function estadoDe(item) {
  const status = texto(item?.status).toLowerCase();
  if (status === EXPORT_STATUS_OK) return 'listo';
  if (EXPORT_STATUS_FALLO.includes(status)) return 'fallo';
  return 'pendiente';
}
