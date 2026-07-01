import { SELECTORS } from '../constants.js';

/** Ámbito de lectura: la pestaña STG si existe, si no todo el documento. */
function gridScope() {
  return document.querySelector(SELECTORS.stgPane) || document;
}

/** Normaliza un SKU/celda para comparar (mayúsculas, sin espacios sobrantes). */
function norm(value) {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * ¿La fila corresponde al SKU buscado? El buscador retorna filas cuyo
 * `Sales Model Code` == SKU (ej "75QNED85BSG.AWH") y `SKU (Product ID)` empieza
 * por ese SKU (ej "75QNED85BSG.AWH.ESCL.CL.C").
 */
function rowMatchesSku(row, sku) {
  const target = norm(sku);
  const cells = row.querySelectorAll(SELECTORS.cellContent);
  for (const cell of cells) {
    const text = norm(cell.textContent);
    if (!text) continue;
    if (text === target) return true;
    if (text.startsWith(`${target}.`)) return true;
  }
  return false;
}

/** ¿Está visible la capa de estado vacío con el texto "No data."? */
function isNoDataVisible(scope) {
  const layer = scope.querySelector(SELECTORS.stateLayer);
  if (!layer) return false;
  const style = layer.style || {};
  if (style.display === 'none') return false;
  if (layer.offsetParent === null && style.display !== 'block') return false;
  const textEl = layer.querySelector(SELECTORS.stateText) || layer;
  return /no data/i.test(textEl.textContent || '');
}

/**
 * Resuelve el resultado de la búsqueda del SKU en la grilla:
 *   'found'     → hay una fila que matchea el SKU (existe en PIM)
 *   'not-found' → la capa "No data." está visible y ninguna fila matchea
 *   'pending'   → todavía cargando / estado no concluyente
 *
 * Matchear la fila por el SKU evita leer resultados de la búsqueda anterior; la
 * capa "No data." sólo aparece cuando la grilla quedó vacía.
 */
export function resolveResult(sku) {
  const scope = gridScope();
  const rows = scope.querySelectorAll(SELECTORS.gridRow);
  for (const row of rows) {
    if (rowMatchesSku(row, sku)) return 'found';
  }
  if (isNoDataVisible(scope)) return 'not-found';
  return 'pending';
}
