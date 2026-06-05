// State machine de la búsqueda de órdenes. Es mucho más simple que cupones:
// sólo navega. El popup escribe la búsqueda + navega la pestaña al listado; acá
// aplicamos el buscador fulltext, encontramos la fila y entramos a la orden.
//
//   LISTING  → setear #fulltext con el número, click Search, esperar el grid,
//              localizar la fila y abrir la orden (anchor o click en la celda).
//   ORDER-VIEW → si había una búsqueda activa, la damos por completada.
//
// El detalle de la orden se lee on-demand vía mensaje (content/index.js), no acá.

import { logger } from '../../../../shared/utils/logger.js';
import {
  DATE_WINDOW_DAYS, PAGE_TYPE, PURCHASE_POINT_LABEL, SEARCH_STATUS, SELECTORS, STORE_VIEW_LABEL,
} from '../../constants.js';
import { getSearch, setSearch } from '../../state.js';
import { detectPage } from '../detector.js';
import { setInputValue, clickEl } from '../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../shared/dom/wait.js';

const log = logger('orden-info');

let running = false;

export async function tickIfActive() {
  if (running) return;
  if (window !== window.top) return;

  running = true;
  try {
    const search = await getSearch();
    if (!search || !search.active) return;

    const page = detectPage();
    if (page.type === PAGE_TYPE.ORDER_VIEW) {
      await finalize(search, SEARCH_STATUS.DONE);
    } else if (page.type === PAGE_TYPE.LISTING) {
      await onListing(search);
    } else {
      log.debug('página fuera del flujo de búsqueda', { url: page.url });
    }
  } catch (err) {
    log.error('tick de búsqueda falló', err);
  } finally {
    running = false;
  }
}

async function onListing(search) {
  const orderNumber = String(search.orderNumber || '').trim();
  if (!orderNumber) {
    await fail(search, 'Número de orden vacío.');
    return;
  }

  try {
    await waitForElement(SELECTORS.searchInput, {
      timeout: 8000, description: 'buscador fulltext del grid',
    });

    // Esperar a que el grid (Knockout) termine de inicializar y restaurar su
    // estado guardado ANTES de tocar nada. Si escribimos el fulltext demasiado
    // pronto, Magento restaura la última búsqueda y pisa nuestro número.
    await waitForGridReady().catch(() => { /* seguimos igual */ });

    // 1) Dejar SÓLO los dos filtros requeridos por el grid: rango de Purchase
    //    Date (<= 1 mes) y Purchase Point. Cualquier otro filtro previo (otra
    //    orden, otra columna, etc.) hace fallar la búsqueda puntual → primero
    //    reseteamos todo y luego aplicamos sólo esos dos.
    search.status = SEARCH_STATUS.FILTERING;
    await setSearch(search);
    await resetAllFilters();
    await applyRequiredFilters();

    // 2) Buscador fulltext con el número de orden (KO ya está estable).
    const input = document.querySelector(SELECTORS.searchInput);
    if (input) setInputValue(input, orderNumber);
    search.status = SEARCH_STATUS.SEARCHING;
    await setSearch(search);
    clickSearch();
    await sleep(300);            // dar tiempo a que aparezca el mask de carga
    await waitForGridReady();
    await sleep(400);
  } catch (err) {
    await fail(search, `No se pudo aplicar la búsqueda: ${err?.message || String(err)}`);
    return;
  }

  const row = findRow(orderNumber);
  if (!row) {
    await finalize(search, SEARCH_STATUS.NOT_FOUND, `No se encontró la orden ${orderNumber} en el grid.`);
    return;
  }

  search.status = SEARCH_STATUS.OPENING;
  await setSearch(search);

  // Preferimos un anchor directo al detalle; si no, click en una celda de datos.
  const anchor = row.querySelector('a[href*="/sales/order/view/"]');
  if (anchor?.href) {
    window.location.href = anchor.href;
    return;
  }
  const cell = pickClickableCell(row, orderNumber);
  if (cell) {
    clickEl(cell);
    return;
  }
  clickEl(row);
}

// -----------------------------------------------------------------------------
// filtros requeridos
// -----------------------------------------------------------------------------

/** Abre el panel de filtros si está colapsado. */
async function openFiltersPanel() {
  if (document.querySelector(SELECTORS.filtersWrapActive)) return;
  const expand = document.querySelector(SELECTORS.filtersToggle);
  if (expand) {
    expand.click();
    await sleep(200);
  }
}

/**
 * Limpia TODOS los filtros activos del grid (excepto el buscador fulltext).
 * Garantiza que arrancamos desde cero: cualquier filtro de otra orden u otra
 * columna que haya quedado se elimina. Sólo tiene efecto si hay filtros activos.
 */
async function resetAllFilters() {
  await openFiltersPanel();

  // Si no hay chips de filtros activos, no hay nada que limpiar.
  const hasActiveFilters = !!document.querySelector(SELECTORS.filtersCurrent);
  const reset = document.querySelector(SELECTORS.filterReset);
  if (!hasActiveFilters || !reset) {
    log.debug('sin filtros activos que resetear');
    return;
  }

  reset.click();
  await sleep(300);              // dar tiempo a que aparezca el mask de carga
  await waitForGridReady().catch(() => { /* seguimos igual */ });
  await sleep(250);
}

async function applyRequiredFilters() {
  // El reset puede haber recargado el grid y colapsado el panel: reabrir.
  await openFiltersPanel();

  const { from, to } = dateWindow(DATE_WINDOW_DAYS);
  const fromEl = document.querySelector(SELECTORS.dateFrom);
  const toEl   = document.querySelector(SELECTORS.dateTo);
  if (fromEl) setInputValue(fromEl, from);
  if (toEl)   setInputValue(toEl, to);

  await ensureStoreView();

  const apply = document.querySelector(SELECTORS.filterApply);
  if (apply) {
    apply.click();
    await sleep(300);            // dar tiempo a que aparezca el mask de carga
    await waitForGridReady();
    await sleep(250);
  } else {
    log.warn('no se encontró el botón Apply Filters');
  }
}

/**
 * Asegura que el Purchase Point quede en "Chile Default Store View". Si ya está
 * seleccionado (hay un crumb), no hace nada. Si no, abre el multiselect y marca
 * la opción correspondiente (el reset de filtros pudo haberlo deseleccionado).
 */
async function ensureStoreView() {
  if (storeViewSelected()) return;

  const wrap = findPurchasePointMultiselect();
  if (!wrap) {
    log.warn(`No se encontró el multiselect "${PURCHASE_POINT_LABEL}". ` +
      'Si la búsqueda falla, seleccioná el Purchase Point manualmente.');
    return;
  }

  // Abrir el dropdown del multiselect.
  if (!wrap.querySelector(`${SELECTORS.multiselectMenu}._active`)) {
    const toggle = wrap.querySelector(SELECTORS.multiselectToggle);
    if (toggle) {
      toggle.click();
      await sleep(200);
    }
  }

  // Marcar la opción "Chile Default Store View" si no está tildada.
  const items = Array.from(wrap.querySelectorAll(SELECTORS.multiselectItem));
  const target = items.find((it) => {
    const span = it.querySelector(SELECTORS.multiselectLabel);
    return span && span.textContent.trim() === STORE_VIEW_LABEL;
  });
  if (target) {
    const cb = target.querySelector('input[type="checkbox"]');
    if (!cb || !cb.checked) {
      target.click();
      await sleep(150);
    }
  } else {
    log.warn(`No se encontró la opción "${STORE_VIEW_LABEL}" en el Purchase Point.`);
  }

  // Cerrar el dropdown ("Done").
  const done = wrap.querySelector(SELECTORS.multiselectDone);
  if (done) {
    done.click();
    await sleep(150);
  }
}

/** ¿Hay un crumb del Purchase Point con el store view esperado? */
function storeViewSelected() {
  return Array.from(document.querySelectorAll(SELECTORS.storeCrumb))
    .some((c) => c.textContent.includes(STORE_VIEW_LABEL));
}

/** Ubica el wrap del multiselect cuya etiqueta es "Purchase Point". */
function findPurchasePointMultiselect() {
  const label = Array.from(document.querySelectorAll(SELECTORS.formFieldLabel))
    .find((s) => s.textContent.trim() === PURCHASE_POINT_LABEL);
  if (!label) return null;
  // La etiqueta y el multiselect cuelgan del mismo contenedor de filtro.
  const field = label.closest('.admin__form-field') || label.parentElement;
  return field ? field.querySelector(SELECTORS.multiselectWrap) : null;
}

/** Rango [hoy - days, hoy] en formato jQuery UI "m/dd/yy" (mes sin pad, día pad). */
function dateWindow(days) {
  const today = new Date();
  const past = new Date(today);
  past.setDate(past.getDate() - days);
  return { from: formatGridDate(past), to: formatGridDate(today) };
}

function formatGridDate(d) {
  const month = d.getMonth() + 1;            // sin leading zero
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}/${day}/${d.getFullYear()}`;
}

function clickSearch() {
  const submit = document.querySelector(SELECTORS.searchSubmit);
  if (submit) submit.click();
  else log.warn('no se encontró el botón de búsqueda fulltext');
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function findRow(orderNumber) {
  const rows = Array.from(document.querySelectorAll(SELECTORS.gridRow));
  // Coincidencia por celda exacta primero, luego por contenido de fila.
  for (const tr of rows) {
    const cells = Array.from(tr.querySelectorAll('td'));
    if (cells.some((td) => td.textContent.trim() === orderNumber)) return tr;
  }
  return rows.find((tr) => tr.textContent.includes(orderNumber)) || null;
}

function pickClickableCell(row, orderNumber) {
  const cells = Array.from(row.querySelectorAll('td'));
  const exact = cells.find((td) => td.textContent.trim() === orderNumber);
  if (exact) return exact;
  return cells.find((td) =>
    !td.matches(SELECTORS.multicheckCell) && !td.matches(SELECTORS.actionsCell),
  ) || null;
}

function loadingMaskVisible() {
  const mask = document.querySelector(SELECTORS.loadingMask);
  if (!mask) return false;
  return mask.offsetParent !== null && getComputedStyle(mask).display !== 'none';
}

async function waitForGridReady({ timeout = 15000 } = {}) {
  return waitFor(() => {
    if (loadingMaskVisible()) return null;
    const rows = document.querySelectorAll(SELECTORS.gridRow);
    if (rows.length > 0) return rows;
    if (document.querySelector(SELECTORS.gridWrap)) return 'empty';
    return null;
  }, { timeout, interval: 150, description: 'grid de órdenes listo' });
}

async function finalize(search, status, error) {
  search.active = false;
  search.status = status;
  search.finishedAt = Date.now();
  if (error) search.error = error;
  await setSearch(search);
  log.info('búsqueda finalizada', { status, error });
}

async function fail(search, message) {
  await finalize(search, SEARCH_STATUS.ERROR, message);
}
