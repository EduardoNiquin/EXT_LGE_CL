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

/** data-row-key de una fila (lo comparte con sus celdas en ambas áreas). */
function rowKeyOf(row) {
  if (row.dataset && row.dataset.rowKey != null) return row.dataset.rowKey;
  const cell = row.querySelector('td[data-row-key]');
  return cell ? cell.getAttribute('data-row-key') : null;
}

/**
 * data-row-key de la fila que matchea el SKU, o null. Requiere que las columnas
 * del SKU (Sales Model Code / Product ID) estén renderizadas — TUI Grid virtualiza
 * columnas por scroll horizontal, así que hay que leerlo antes de scrollear.
 */
export function getRowKeyForSku(sku) {
  const scope = gridScope();
  for (const row of scope.querySelectorAll(SELECTORS.gridRow)) {
    if (rowMatchesSku(row, sku)) return rowKeyOf(row);
  }
  return null;
}

/**
 * Lee el contenido de la columna "Spec Assign" (specAssignmentCode) por data-row-key.
 * La celda sólo existe en el DOM si la columna está renderizada (ver
 * `scrollGridX`), porque TUI Grid virtualiza columnas horizontalmente. Devuelve el
 * texto (ej "Assigned") o null si vacía / no renderizada.
 */
export function readSpecByRowKey(rowKey) {
  if (rowKey == null) return null;
  const scope = gridScope();
  const key = String(rowKey);
  for (const c of scope.querySelectorAll(SELECTORS.specCell)) {
    if (c.getAttribute('data-row-key') === key) {
      const content = c.querySelector(SELECTORS.cellContent) || c;
      return (content.textContent || '').trim() || null;
    }
  }
  return null;
}

/**
 * Lee "Spec Assign" relocalizando la fila por SKU (atajo para debug / cuando la
 * columna ya está renderizada). Para el flujo real usar
 * `getRowKeyForSku` + `scrollGridX` + `readSpecByRowKey` (la columna vive lejos a
 * la derecha y no está en el DOM hasta scrollear).
 */
export function readSpecAssign(sku) {
  return readSpecByRowKey(getRowKeyForSku(sku));
}

/**
 * Desplaza el grid horizontalmente para materializar columnas virtualizadas.
 * `x < 0` va al extremo derecho (última columna), `x = 0` vuelve a la izquierda.
 * TUI Grid usa scroll nativo en `.tui-grid-body-area` y re-renderiza al recibir el
 * evento `scroll`. Devuelve false si no encontró el área de datos.
 */
export function scrollGridX(x) {
  const el = gridScope().querySelector(SELECTORS.gridBodyArea);
  if (!el) return false;
  const max = Math.max(0, el.scrollWidth - el.clientWidth);
  el.scrollLeft = x < 0 ? max : Math.min(x, max);
  el.dispatchEvent(new Event('scroll', { bubbles: true }));
  return true;
}

/** ¿Está visible una capa de estado (offsetParent / display)? */
function isLayerVisible(layer) {
  const style = layer.style || {};
  if (style.display === 'none') return false;
  if (layer.offsetParent === null && style.display !== 'block') return false;
  return true;
}

/** ¿Está visible la capa de estado vacío con el texto "No data."? */
function isNoDataVisible(scope) {
  const layer = scope.querySelector(SELECTORS.stateLayer);
  if (!layer || !isLayerVisible(layer)) return false;
  const textEl = layer.querySelector(SELECTORS.stateText) || layer;
  return /no data/i.test(textEl.textContent || '');
}

/**
 * ¿El grid está cargando (fetch en vuelo)? TUI Grid muestra la capa de estado con
 * un spinner (`.tui-grid-layer-state-loading`, a veces sin texto). Detectar la
 * carga permite distinguir el "No data." viejo del SKU anterior del resultado
 * fresco: hasta que no arranca la carga no se confía en un "No data.".
 */
export function isGridLoading() {
  const scope = gridScope();
  const layer = scope.querySelector(SELECTORS.stateLayer);
  if (!layer || !isLayerVisible(layer)) return false;
  if (layer.querySelector(SELECTORS.stateLoading)) return true;
  const textEl = layer.querySelector(SELECTORS.stateText) || layer;
  return /loading|cargando/i.test(textEl.textContent || '');
}

/**
 * Resuelve el resultado de la búsqueda del SKU en la grilla:
 *   'found'     → hay una fila que matchea el SKU (existe en PIM)
 *   'not-found' → la capa "No data." está visible y ninguna fila matchea
 *   'pending'   → todavía cargando / estado no concluyente
 *
 * Matchear la fila por el SKU evita leer resultados de la búsqueda anterior; la
 * capa "No data." sólo aparece cuando la grilla quedó vacía. El "Spec Assign" NO
 * se lee acá (su columna está virtualizada fuera del DOM); ver `flows/search.js`.
 */
export function resolveResult(sku) {
  const scope = gridScope();
  const rows = scope.querySelectorAll(SELECTORS.gridRow);
  for (const row of rows) {
    if (rowMatchesSku(row, sku)) return { result: 'found' };
  }
  if (isNoDataVisible(scope)) return { result: 'not-found' };
  return { result: 'pending' };
}
