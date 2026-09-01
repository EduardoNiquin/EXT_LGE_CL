// Driver del grid de ordenes: dejar puestos los filtros que Magento exige y
// recorrer el listado completo pagina por pagina.
//
// El grid es un UI component Knockout: no basta con escribir en los inputs, hay
// que usar sus botones reales (Apply Filters / Reset) y esperar a que la tabla
// se repinte.

import { isAbortError, toMessage } from '../../../../shared/errors/index.js';
import { clickEl, setInputValue } from '../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../shared/dom/wait.js';
import {
  PAGE_SIZE,
  PURCHASE_POINT_LABEL,
  SELECTORS,
  STORE_VIEW_LABEL,
} from '../constants.js';
import { parseOrderRows } from './parser.js';

const noop = () => {};

// -----------------------------------------------------------------------------
// esperas
// -----------------------------------------------------------------------------

function loadingMaskVisible() {
  return Array.from(document.querySelectorAll(SELECTORS.loadingMask))
    .some((mask) => mask.offsetParent !== null && getComputedStyle(mask).display !== 'none');
}

export async function waitForGridReady({ signal, timeout = 25000 } = {}) {
  return waitFor(() => {
    if (loadingMaskVisible()) return null;
    const rows = document.querySelectorAll(SELECTORS.gridRow);
    if (rows.length) return rows;
    // Un grid con 0 filas es un resultado valido (rango sin ordenes), pero solo
    // si el contenedor ya monto: antes de eso "vacio" significa "cargando".
    if (document.querySelector(SELECTORS.gridWrap) && /records found/i.test(document.body.textContent || '')) return 'empty';
    return null;
  }, { signal, timeout, interval: 200, description: 'grid de ordenes listo' });
}

// -----------------------------------------------------------------------------
// filtros
// -----------------------------------------------------------------------------

async function openFiltersPanel(signal) {
  if (document.querySelector(SELECTORS.filtersWrapActive)) return;
  const expand = document.querySelector(SELECTORS.filtersToggle);
  if (!expand) return;
  clickEl(expand);
  await sleep(250, signal);
}

/**
 * Deja el grid con SOLO los dos filtros que la busqueda puntual necesita:
 * rango de Purchase Date y Purchase Point. Cualquier filtro heredado de una
 * consulta anterior hace fallar la busqueda, asi que primero se resetea todo.
 *
 * El grid es Knockout y restaura la ultima busqueda guardada al montar: se
 * espera a que este listo ANTES de tocar nada, o Magento pisa lo que se escriba.
 */
export async function applyPurchaseFilters({ from, to, signal, onWarn = noop } = {}) {
  await waitForElement(SELECTORS.gridWrap, { signal, timeout: 20000, description: 'grid de ordenes' });
  await waitForGridReady({ signal }).catch(() => { /* seguimos igual */ });

  await resetAllFilters(signal);
  await openFiltersPanel(signal);

  const fromEl = document.querySelector(SELECTORS.dateFrom);
  const toEl = document.querySelector(SELECTORS.dateTo);
  if (!fromEl || !toEl) {
    onWarn('No se encontraron los campos de Purchase Date; se buscara con el rango que tenga el grid.');
  } else {
    setInputValue(fromEl, from);
    setInputValue(toEl, to);
  }

  await ensureStoreView(signal, onWarn);

  const apply = document.querySelector(SELECTORS.filterApply);
  if (!apply) {
    onWarn('No se encontro el boton "Apply Filters".');
    return;
  }
  await clickAndSettle(apply, { signal, description: 'grid filtrado por Purchase Date' });

  // Si no quedo ningun chip de filtro, el grid sigue mostrando TODO el historial
  // y el recorrido se iria por miles de ordenes que no interesan. No es fatal
  // (el usuario puede tener el filtro puesto a mano), pero tiene que constar.
  if (!document.querySelector(SELECTORS.filtersCurrent)) {
    onWarn('El grid no muestra filtros activos despues de aplicar: revisa el rango de fechas y el Purchase Point.');
  }
}

async function resetAllFilters(signal) {
  await openFiltersPanel(signal);
  const hasActive = Boolean(document.querySelector(SELECTORS.filtersCurrent));
  const reset = document.querySelector(SELECTORS.filterReset);
  if (!hasActive || !reset) return;
  await clickAndSettle(reset, { signal, description: 'grid sin filtros' });
}

/**
 * Click en un boton del grid (Apply / Reset) + espera a que la tabla se repinte
 * de verdad. El chip de filtros aparece casi al instante, pero las FILAS pueden
 * quedar cientos de ms con el resultado viejo: recolectar ahi significa recorrer
 * el listado sin filtrar. Se espera a que arranque la carga (mask) o a que
 * cambie el contenido; si el resultado es identico al anterior (re-aplicar el
 * mismo filtro) alcanza con que el grid vuelva a quedar listo.
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
    // Ni mask ni cambio: el grid pudo responder lo mismo. Lo resuelve la espera
    // de abajo, que es la que decide si la tabla quedo utilizable.
  }
  await waitForGridReady({ signal });
  await sleep(250, signal);
}

/** Huella de lo que muestra la tabla: filas, primera fila y total reportado. */
function gridSnapshot() {
  const rows = document.querySelectorAll(SELECTORS.gridRow);
  const first = rows[0]?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 160) || '';
  return `${rows.length}|${first}|${readRecordsFound() ?? ''}`;
}

/**
 * El Purchase Point tiene que quedar en "Chile Default Store View": el reset
 * pudo haberlo deseleccionado y sin el la busqueda del grid falla.
 */
async function ensureStoreView(signal, onWarn = noop) {
  if (storeViewSelected()) return;

  const wrap = findPurchasePointMultiselect();
  if (!wrap) {
    onWarn(`No se encontro el filtro "${PURCHASE_POINT_LABEL}". Seleccionalo a mano si la busqueda falla.`);
    return;
  }

  if (!wrap.querySelector(`${SELECTORS.multiselectMenu}._active`)) {
    const toggle = wrap.querySelector(SELECTORS.multiselectToggle);
    if (toggle) {
      clickEl(toggle);
      await sleep(250, signal);
    }
  }

  const target = Array.from(wrap.querySelectorAll(SELECTORS.multiselectItem)).find((item) =>
    item.querySelector(SELECTORS.multiselectLabel)?.textContent?.trim() === STORE_VIEW_LABEL);
  if (!target) {
    onWarn(`No se encontro la opcion "${STORE_VIEW_LABEL}" en ${PURCHASE_POINT_LABEL}.`);
  } else {
    const checkbox = target.querySelector('input[type="checkbox"]');
    if (!checkbox || !checkbox.checked) {
      clickEl(target);
      await sleep(200, signal);
    }
  }

  const done = wrap.querySelector(SELECTORS.multiselectDone);
  if (done) {
    clickEl(done);
    await sleep(200, signal);
  }
}

function storeViewSelected() {
  return Array.from(document.querySelectorAll(SELECTORS.storeCrumb))
    .some((crumb) => crumb.textContent.includes(STORE_VIEW_LABEL));
}

function findPurchasePointMultiselect() {
  const label = Array.from(document.querySelectorAll(SELECTORS.formFieldLabel))
    .find((span) => span.textContent.trim() === PURCHASE_POINT_LABEL);
  if (!label) return null;
  const field = label.closest('.admin__form-field') || label.parentElement;
  return field ? field.querySelector(SELECTORS.multiselectWrap) : null;
}

// -----------------------------------------------------------------------------
// recorrido
// -----------------------------------------------------------------------------

/** Cantidad de ordenes que el grid dice tener con los filtros puestos. */
export function readRecordsFound() {
  const text = document.body.textContent || '';
  const match = text.match(/([\d.,]+)\s*records found/i);
  return match ? Number(match[1].replace(/\D+/g, '')) : null;
}

/**
 * Recorre todas las paginas del listado juntando las ordenes. Si una pagina no
 * avanza se devuelve lo recolectado con un aviso: perder el recorrido entero
 * por una pagina colgada es peor que quedarse corto.
 */
export async function collectAllOrders({ signal, maxPages = 200, limit = 0, onWarn = noop, onPage = noop } = {}) {
  await waitForGridReady({ signal });
  await trySetPageSize(PAGE_SIZE, signal, onWarn);
  await goToFirstPage(signal);

  const output = [];
  const seen = new Set();

  for (let page = 0; page < maxPages; page += 1) {
    await waitForGridReady({ signal });
    parseOrderRows().forEach((order) => {
      const key = order.entityId || order.viewHref;
      if (seen.has(key)) return;
      seen.add(key);
      output.push(order);
    });
    onPage(page + 1, output.length);

    if (limit > 0 && output.length >= limit) return output.slice(0, limit);

    const next = document.querySelector(SELECTORS.pagerNext);
    if (isPagerDisabled(next)) return output;

    const advanced = await advancePage(next, signal);
    if (!advanced.ok) {
      onWarn(`No se pudo avanzar mas alla de la pagina ${page + 1} (${advanced.reason}). Se continua con ${output.length} ordenes.`);
      return output;
    }
  }

  onWarn(`Se alcanzo el limite de ${maxPages} paginas. Se continua con ${output.length} ordenes.`);
  return output;
}

async function advancePage(next, signal) {
  const before = listingSnapshot();
  clickEl(next);
  try {
    await waitFor(() => {
      if (loadingMaskVisible()) return null;
      const current = listingSnapshot();
      return current && current !== before ? current : null;
    }, { signal, timeout: 20000, interval: 200, description: 'siguiente pagina de ordenes' });
    await sleep(250, signal);
    return { ok: true };
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    return { ok: false, reason: toMessage(err) };
  }
}

/**
 * Magento marca el pager de varias formas segun si el control es <button> o <a>;
 * mirar solo `.disabled` deja el recorrido girando hasta el tope de paginas.
 */
export function isPagerDisabled(el) {
  if (!el) return true;
  if (el.disabled) return true;
  if (el.hasAttribute?.('disabled')) return true;
  if (el.getAttribute?.('aria-disabled') === 'true') return true;
  return Boolean(el.classList?.contains('disabled') || el.classList?.contains('_disabled'));
}

async function trySetPageSize(size, signal, onWarn = noop) {
  const input = document.querySelector(SELECTORS.pageSizeInput);
  if (!input || Number(input.value) >= size) return;
  const menu = input.closest('.selectmenu');
  const option = pickPageSizeOption(Array.from(menu?.querySelectorAll(SELECTORS.pageSizeOption) || []), size);
  if (!option) {
    onWarn(`No se encontro la opcion de ${size} ordenes por pagina; se recorrera con el tamano actual.`);
    return;
  }
  const before = listingSnapshot();
  clickEl(option.el);
  try {
    await waitFor(() => (Number(input.value) === option.size && !loadingMaskVisible()) || listingSnapshot() !== before, {
      signal, timeout: 20000, interval: 200, description: `${option.size} ordenes por pagina`,
    });
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    onWarn(`No se pudo fijar ${option.size} ordenes por pagina (${toMessage(err)}); se recorrera con el tamano actual.`);
    return;
  }
  await sleep(300, signal);
}

/**
 * El tamano pedido si existe; si no, el mayor que ofrezca el grid. Traer 100 de
 * una vez sigue siendo mucho mejor que recorrer paginas de 20, y cada pagina de
 * mas es una vuelta completa contra el servidor.
 */
export function pickPageSizeOption(elements, size) {
  const options = (Array.isArray(elements) ? elements : [])
    .map((el) => ({ el, size: Number(String(el?.textContent || '').trim()) }))
    .filter((option) => Number.isFinite(option.size) && option.size > 0);
  if (!options.length) return null;
  return options.find((option) => option.size === size)
    || options.reduce((best, option) => (option.size > best.size ? option : best));
}

async function goToFirstPage(signal) {
  for (let safety = 0; safety < 200; safety += 1) {
    const previous = document.querySelector(SELECTORS.pagerPrevious);
    if (isPagerDisabled(previous)) return;
    const current = document.querySelector(SELECTORS.pagerCurrent)?.value || '';
    clickEl(previous);
    await waitFor(() => {
      const value = document.querySelector(SELECTORS.pagerCurrent)?.value || '';
      return value !== current ? value : null;
    }, { signal, timeout: 20000, interval: 200, description: 'volver a la primera pagina' });
  }
  throw new Error('No se pudo volver a la primera pagina del listado');
}

function listingSnapshot() {
  return parseOrderRows().map((order) => order.entityId).join('|');
}
