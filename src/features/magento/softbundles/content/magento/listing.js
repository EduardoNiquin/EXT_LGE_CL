// Listado de package rules: elegir el website, revisar si un SKU ya tiene
// regla y entrar a "Add New Package".
//
// El grid es un UI component Knockout que restaura la ultima busqueda guardada
// al montar, asi que se espera a que este listo ANTES de tocar los filtros.

import { isAbortError } from '../../../../../shared/errors/index.js';
import { clickEl, setInputValue } from '../../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../../shared/dom/wait.js';
import {
  LISTING_ID_COLUMN,
  LISTING_MAIN_PRODUCT_COLUMN,
  SELECTORS,
  TIMEOUTS,
} from '../../constants.js';
import { sameSku } from '../../parse-input.js';

function loadingMaskVisible() {
  return Array.from(document.querySelectorAll(SELECTORS.loadingMask))
    .some((mask) => mask.offsetParent !== null && getComputedStyle(mask).display !== 'none');
}

/** Huella de lo que muestra la tabla: filas, primera fila y total reportado. */
function gridSnapshot() {
  const rows = document.querySelectorAll(SELECTORS.gridRow);
  const first = rows[0]?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 160) || '';
  return `${rows.length}|${first}|${readRecordsFound() ?? ''}`;
}

export function readRecordsFound() {
  const match = (document.body.textContent || '').match(/([\d.,]+)\s*records found/i);
  return match ? Number(match[1].replace(/\D+/g, '')) : null;
}

export async function waitForGridReady({ signal, timeout = TIMEOUTS.GRID } = {}) {
  return waitFor(() => {
    if (loadingMaskVisible()) return null;
    if (document.querySelectorAll(SELECTORS.gridRow).length) return 'rows';
    // Cero filas es un resultado valido (ningun rule para ese SKU), pero solo si
    // el grid ya monto: antes de eso "vacio" significa "cargando".
    if (document.querySelector(SELECTORS.gridWrap) && /records found/i.test(document.body.textContent || '')) return 'empty';
    return null;
  }, { signal, timeout, interval: 200, description: 'listado de package rules' });
}

// -----------------------------------------------------------------------------
// website
// -----------------------------------------------------------------------------

export function currentWebsite() {
  return document.querySelector(SELECTORS.websiteButton)?.textContent?.trim() || '';
}

/**
 * Deja el listado con el website pedido. El boton "Add New Package" arma su URL
 * con el id del website, asi que sin elegirlo no se puede crear nada.
 *
 * Cambiar de scope dispara una navegacion completa (con un confirm de por
 * medio): devuelve `{ navigating: true }` para que el runner suelte el tick.
 */
export async function ensureWebsite(label, { signal } = {}) {
  if (currentWebsite() === label) return { navigating: false };

  const button = document.querySelector(SELECTORS.websiteButton);
  if (!button) return { navigating: false, missing: true };
  clickEl(button);
  await sleep(200, signal);

  const link = Array.from(document.querySelectorAll(SELECTORS.websiteLink))
    .find((anchor) => anchor.textContent.trim() === label);
  if (!link) {
    return { navigating: false, missing: true, available: Array.from(document.querySelectorAll(SELECTORS.websiteLink)).map((a) => a.textContent.trim()) };
  }

  try { window.onbeforeunload = null; } catch { /* no-op */ }
  link.click();

  // Magento pregunta "Please confirm scope switching" antes de cambiar.
  try {
    const modal = await waitFor(() => document.querySelector(SELECTORS.confirmModal), {
      signal, timeout: 3000, interval: 100, description: 'confirmacion de cambio de website',
    });
    const accept = Array.from(modal.querySelectorAll(SELECTORS.confirmAccept))
      .find((candidate) => /ok|aceptar/i.test(candidate.textContent.trim()))
      || modal.querySelector(SELECTORS.confirmAccept);
    if (accept) clickEl(accept);
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    // Sin confirmacion: algunas versiones cambian de scope directo.
  }

  return { navigating: true };
}

// -----------------------------------------------------------------------------
// filtros / revision de duplicados
// -----------------------------------------------------------------------------

async function openFiltersPanel(signal) {
  if (document.querySelector(SELECTORS.filtersWrapOpen)) return;
  const expand = document.querySelector(SELECTORS.filtersToggle);
  if (!expand) return;
  clickEl(expand);
  await sleep(250, signal);
}

/**
 * Click en un boton del grid + espera a que la tabla se repinte de verdad. El
 * chip del filtro aparece antes que las filas nuevas: leer ahi devuelve el
 * resultado de la consulta anterior.
 */
async function clickAndSettle(button, { signal, description, settleMs = 3000 }) {
  const before = gridSnapshot();
  clickEl(button);
  try {
    await waitFor(() => (loadingMaskVisible() || gridSnapshot() !== before) || null, {
      signal, timeout: settleMs, interval: 100, description,
    });
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    // Ni mask ni cambio: el grid pudo devolver lo mismo. Lo decide la espera de
    // abajo, que es la que dice si la tabla quedo utilizable.
  }
  await waitForGridReady({ signal });
  await sleep(200, signal);
}

/** Quita los filtros activos ("Clear all"). */
export async function clearFilters({ signal } = {}) {
  if (!document.querySelector(SELECTORS.filtersCurrent)) return;
  const clear = document.querySelector(SELECTORS.filterClearAll);
  if (!clear) return;
  await clickAndSettle(clear, { signal, description: 'listado sin filtros' });
}

/**
 * Busca en el listado si el SKU ya tiene un package rule.
 * El filtro de Magento es "contiene", asi que la coincidencia se confirma
 * comparando la columna "Main Product" fila por fila.
 *
 * @returns {Promise<{ found: boolean, id: string, sku: string }>}
 */
export async function findExistingRule(sku, { signal } = {}) {
  await waitForGridReady({ signal });
  await clearFilters({ signal });
  await openFiltersPanel(signal);

  const input = document.querySelector(SELECTORS.filterProductSku);
  if (!input) throw new Error('No se encontro el filtro "Main Product" del listado.');
  setInputValue(input, sku);

  const apply = document.querySelector(SELECTORS.filterApply);
  if (!apply) throw new Error('No se encontro el boton "Apply Filters" del listado.');
  await clickAndSettle(apply, { signal, description: `listado filtrado por ${sku}` });

  const match = parseListingRows().find((row) => sameSku(row.mainProduct, sku));
  return { found: Boolean(match), id: match?.id || '', sku: match?.mainProduct || '' };
}

// -----------------------------------------------------------------------------
// lectura del grid
// -----------------------------------------------------------------------------

/** Indice de cada columna del grid por su encabezado. */
function headerIndexMap(table) {
  const map = {};
  Array.from(table.querySelectorAll('thead th')).forEach((th, index) => {
    const label = th.textContent.replace(/\s+/g, ' ').trim();
    if (label && !(label in map)) map[label] = index;
  });
  return map;
}

/** Filas visibles del listado, con las dos columnas que importan. */
export function parseListingRows() {
  const table = document.querySelector(SELECTORS.gridTable);
  if (!table) return [];
  const headers = headerIndexMap(table);
  const idIndex = headers[LISTING_ID_COLUMN];
  const skuIndex = headers[LISTING_MAIN_PRODUCT_COLUMN];

  return Array.from(table.querySelectorAll(SELECTORS.gridRow)).map((row) => {
    const cells = Array.from(row.querySelectorAll('td'));
    const read = (index) => (index == null ? '' : cells[index]?.querySelector(SELECTORS.gridCell)?.textContent?.trim()
      || cells[index]?.textContent?.trim() || '');
    return { id: read(idIndex), mainProduct: read(skuIndex) };
  });
}

// -----------------------------------------------------------------------------
// creacion
// -----------------------------------------------------------------------------

/**
 * Pulsa "Add New Package". Es un click real y no una URL armada a mano porque
 * la de Magento lleva su token `key` y el id del website.
 */
export async function clickAddPackage({ signal } = {}) {
  const button = await waitForElement(SELECTORS.addButton, {
    signal, timeout: TIMEOUTS.PAGE, description: 'boton "Add New Package"',
  });
  try { window.onbeforeunload = null; } catch { /* no-op */ }
  button.click();
  return true;
}
