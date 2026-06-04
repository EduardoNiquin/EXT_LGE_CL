import { SELECTORS, TEXTS } from '../constants.js';
import { cellAt, cellTextAt, colIndex, firstTable, headerIndexMap, tableRows } from './vuetify/datatable.js';

/** Normaliza un texto de estado/nombre para comparar (trim + colapsa espacios). */
function norm(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Grilla de órdenes (#/ordenes)
// ---------------------------------------------------------------------------

/**
 * Lee la grilla de órdenes. Devuelve [{ orderNumber, reference, estado }].
 * Tolera el quirk de celdas anidadas (<td><td>…</td></td>) leyendo por índice
 * de columna obtenido del thead.
 */
export function parseOrdersGrid() {
  const table = firstTable();
  if (!table) return [];
  const map = headerIndexMap(table);
  const iNum    = colIndex(map, '# de orden');
  const iRef    = colIndex(map, 'referencia');
  const iEstado = colIndex(map, 'estado');

  return tableRows(table).map((tr) => {
    const orderNumber = iNum >= 0 ? cellTextAt(tr, iNum).replace(/\D/g, '') : '';
    const refCell = iRef >= 0 ? cellAt(tr, iRef) : null;
    const reference = (refCell?.querySelector('a')?.textContent ?? refCell?.textContent ?? '').trim();
    const estadoCell = iEstado >= 0 ? cellAt(tr, iEstado) : null;
    const estado = norm(estadoCell?.querySelector('button')?.textContent ?? estadoCell?.textContent ?? '');
    return { orderNumber, reference, estado };
  }).filter((r) => r.orderNumber);
}

/** Sólo las órdenes con estado "On Hold (Fuera de Stock)". */
export function collectFueraDeStock() {
  const want = norm(TEXTS.STATE_FUERA_STOCK).toLowerCase();
  return parseOrdersGrid().filter((r) => norm(r.estado).toLowerCase() === want);
}

// ---------------------------------------------------------------------------
// Detalle de orden (#/ordenes/<n>) — tabla de productos
// ---------------------------------------------------------------------------

/** Busca la <table> cuyo thead contiene las columnas dadas (todas). */
function findTableWithHeaders(required) {
  const wanted = required.map((r) => r.toLowerCase());
  for (const table of document.querySelectorAll('table')) {
    const map = headerIndexMap(table);
    if (wanted.every((w) => colIndex(map, w) >= 0)) return table;
  }
  return null;
}

/**
 * Lee la tabla de productos del detalle de orden.
 * Devuelve [{ sku, stockDisponible, skuButton, rowEl }].
 */
export function parseOrderProducts() {
  const table = findTableWithHeaders(['sku']) || firstTable();
  if (!table) return [];
  const map = headerIndexMap(table);
  const iSku   = colIndex(map, 'sku');
  const iStock = colIndex(map, 'stock disponible');

  return tableRows(table).map((tr) => {
    const sku = iSku >= 0 ? cellTextAt(tr, iSku) : '';
    const stockDisponible = iStock >= 0 ? cellTextAt(tr, iStock) : '';
    const skuButton = tr.querySelector(SELECTORS.skuButton);
    return { sku, stockDisponible, skuButton, rowEl: tr };
  }).filter((r) => r.sku || r.skuButton);
}

// ---------------------------------------------------------------------------
// Inventario producto (#/inventario/stock/productos/<sku>) — bodegas
// ---------------------------------------------------------------------------

/**
 * Lee las filas de bodega del detalle de inventario de un producto. Cada fila
 * tiene un link de Acciones (ojo) con href `.../<sku>/<bodegaId>`. Como el DOM
 * de la tabla no es estable, se identifica por ese link y se toma el texto de
 * toda la fila para matchear la bodega configurada.
 * Devuelve [{ bodegaId, href, rowText, rowEl, linkEl }].
 */
export function parseWarehouseRows(sku) {
  const links = Array.from(document.querySelectorAll(SELECTORS.inventoryEyeLink));
  const out = [];
  for (const a of links) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/#\/inventario\/stock\/productos\/([^/]+)\/(\d+)\/?$/i);
    if (!m) continue;
    if (sku && decodeURIComponent(m[1]).toLowerCase() !== String(sku).toLowerCase()) continue;
    const rowEl = a.closest('tr') || a.parentElement;
    out.push({
      bodegaId: m[2],
      href,
      rowText: norm(rowEl?.textContent),
      rowEl,
      linkEl: a,
    });
  }
  return out;
}

/** Encuentra la fila de bodega que matchea el nombre configurado. */
export function findWarehouseRow(sku, bodega) {
  const rows = parseWarehouseRows(sku);
  const want = norm(bodega).toLowerCase();
  return rows.find((r) => r.rowText.toLowerCase().includes(want)) || null;
}

// ---------------------------------------------------------------------------
// Productos (#/productos) — verificación de existencia
// ---------------------------------------------------------------------------

/** Filas de resultados de la búsqueda de productos. Devuelve textos de fila. */
export function parseProductsSearchRows() {
  const table = firstTable();
  if (!table) return [];
  return tableRows(table).map((tr) => norm(tr.textContent)).filter(Boolean);
}
