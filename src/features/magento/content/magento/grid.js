import { isAbortError, toMessage } from '../../../../shared/errors/index.js';
import { clickEl } from '../../../../shared/dom/events.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { BRIDGE, LISTING_PAGE_SIZE, REGIONAL_PAGE_SIZE, SELECTORS } from '../../constants.js';
import { askBridge } from '../bridge-client.js';
import { findListingTable } from '../detector.js';
import { findRegionalTable, parseListingRows, parseRegionalRows } from '../parser.js';

const noop = () => {};

export async function waitForListingReady({ signal, timeout = 20000 } = {}) {
  return waitFor(() => {
    const table = findListingTable();
    if (!table) return null;
    const host = table.closest(SELECTORS.gridWrap) || document;
    const mask = host.querySelector(SELECTORS.listingLoadingMask);
    if (mask && mask.offsetParent !== null) return null;
    const rows = table.querySelectorAll(SELECTORS.listingRow);
    if (rows.length) return table;
    return /0\s+records found/i.test(host.textContent || '') ? table : null;
  }, { signal, timeout, interval: 150, description: 'listado Global Shipping Rules listo' });
}

export async function collectAllRules({ signal, maxPages = 100, onWarn = noop } = {}) {
  await waitForListingReady({ signal });
  const sized = await trySetPageSize(LISTING_PAGE_SIZE, {
    host: listingHost(),
    inputId: SELECTORS.listingPageSizeInputId,
    snapshot: listingSnapshot,
    signal,
  });
  if (!sized.ok) onWarn(`No se pudo fijar ${LISTING_PAGE_SIZE} rules por pagina (${sized.reason}); se recorrera el listado con el tamano actual.`);
  await waitForListingReady({ signal });
  await goToFirstPage(() => findListingTable(), signal);

  const output = [];
  const seen = new Set();

  for (let page = 0; page < maxPages; page += 1) {
    await waitForListingReady({ signal });
    const rows = parseListingRows();
    rows.forEach((rule) => {
      if (!seen.has(rule.id)) {
        seen.add(rule.id);
        output.push(rule);
      }
    });

    const next = listingHost().querySelector(SELECTORS.pagerNext);
    if (isPagerDisabled(next)) return output;

    const advanced = await advancePage(next, listingSnapshot, {
      signal,
      description: 'siguiente pagina de rules',
    });
    // Preferimos entregar lo recolectado antes que perder el listado entero
    // porque una pagina se colgo: el aviso queda en el registro del proceso.
    if (!advanced.ok) {
      onWarn(`No se pudo avanzar mas alla de la pagina ${page + 1} del listado (${advanced.reason}). Se continua con ${output.length} rules.`);
      return output;
    }
  }

  onWarn(`Se alcanzo el limite de ${maxPages} paginas del listado. Se continua con ${output.length} rules.`);
  return output;
}

/**
 * Tarifas regionales de la rule abierta. Primero se intenta traerlas todas de
 * una (bridge del mundo MAIN o selector de tamano de pagina); recorrer el
 * paginador queda como respaldo, porque cada pagina cuesta una peticion y un
 * re-render, y eso se paga en CADA rule.
 */
export async function collectAllRegionalRows({ signal, maxPages = 100, onWarn = noop, onInfo = noop } = {}) {
  await waitForRegionalReady({ signal });
  await goToFirstPage(() => findRegionalTable(), signal);
  await loadAllRegionalRows({ signal, onInfo });

  const output = [];
  const seen = new Set();

  for (let page = 0; page < maxPages; page += 1) {
    await waitForRegionalReady({ signal });
    parseRegionalRows().forEach((row) => {
      const key = JSON.stringify(row);
      if (!seen.has(key)) {
        seen.add(key);
        output.push(row);
      }
    });

    const next = regionalHost()?.querySelector(SELECTORS.pagerNext);
    if (isPagerDisabled(next)) return output;

    const advanced = await advancePage(next, regionalSnapshot, {
      signal,
      description: 'siguiente pagina regional',
    });
    if (!advanced.ok) {
      onWarn(`No se pudo avanzar mas alla de la pagina ${page + 1} de tarifas regionales (${advanced.reason}). Se continua con ${output.length} tarifas.`);
      return output;
    }
  }

  onWarn(`Se alcanzo el limite de ${maxPages} paginas de tarifas regionales. Se continua con ${output.length} tarifas.`);
  return output;
}

/**
 * Deja la grilla regional con todas sus filas en una sola pagina. Nunca lanza
 * (salvo cancelacion): si ninguna via prende, el paginador de siempre recorre
 * la grilla igual que antes. `onInfo` reporta que via funciono, para poder
 * medir en vivo cuanto aporta cada una.
 */
export async function loadAllRegionalRows({ signal, onInfo = noop } = {}) {
  if (isPagerDisabled(regionalHost()?.querySelector(SELECTORS.pagerNext))) {
    onInfo({ via: 'single-page' });
    return true;
  }

  const answer = await askBridge(BRIDGE.OPS.EXPAND_REGIONAL, { size: REGIONAL_PAGE_SIZE }, { signal });
  if (answer.ok && answer.result?.applied) {
    const settled = await waitForRegionalRows(answer.result.totalRecords, signal);
    if (settled) {
      onInfo({ via: `bridge:${answer.result.via}`, totalRecords: answer.result.totalRecords });
      return true;
    }
  }

  const sized = await trySetPageSize(REGIONAL_PAGE_SIZE, {
    host: regionalHost(),
    snapshot: regionalSnapshot,
    signal,
  });
  if (sized.ok) {
    await waitForRegionalReady({ signal });
    onInfo({ via: 'page-size' });
    return true;
  }

  onInfo({ via: 'pager', reason: answer.ok ? answer.result?.reason || sized.reason : answer.reason });
  return false;
}

/**
 * Click en "siguiente" + espera a que el snapshot cambie. Devuelve el motivo en
 * vez de tirar, salvo cancelacion: el que llama decide si es fatal.
 */
async function advancePage(next, snapshot, { signal, description }) {
  const before = snapshot();
  clickEl(next);
  try {
    await waitFor(() => {
      const current = snapshot();
      return current && current !== before ? current : null;
    }, { signal, timeout: 15000, interval: 150, description });
    await sleep(200, signal);
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

async function waitForRegionalReady({ signal, timeout = 20000 } = {}) {
  return waitFor(() => {
    const root = document.querySelector(SELECTORS.regionalRoot);
    if (!root) return null;
    const mask = root.querySelector(SELECTORS.listingLoadingMask);
    if (mask && mask.offsetParent !== null) return null;
    return findRegionalTable() || null;
  }, { signal, timeout, interval: 150, description: 'tabla regional lista' });
}

/**
 * Espera a que la grilla regional muestre todo lo que dijo tener. Devuelve
 * false en vez de lanzar: es una via rapida, y si no cuaja se pagina.
 */
async function waitForRegionalRows(totalRecords, signal) {
  const target = Number(totalRecords);
  try {
    await waitFor(() => {
      const root = document.querySelector(SELECTORS.regionalRoot);
      const mask = root?.querySelector(SELECTORS.listingLoadingMask);
      if (mask && mask.offsetParent !== null) return null;
      const rows = parseRegionalRows().length;
      if (Number.isFinite(target) && target > 0) return rows >= target ? rows : null;
      return isPagerDisabled(regionalHost()?.querySelector(SELECTORS.pagerNext)) ? rows || true : null;
    }, { signal, timeout: 15000, interval: 150, description: 'tarifas regionales completas' });
    return true;
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    return false;
  }
}

/**
 * Fija el tamano de pagina de una grilla del admin. El listado tiene un id de UI
 * component conocido; la grilla regional no, asi que se ubica el selector dentro
 * de su propio contenedor (dos grillas en la misma pantalla comparten clases).
 */
export async function trySetPageSize(size, { host = document, inputId = '', snapshot = () => '', signal } = {}) {
  const menu = findPageSizeMenu(host, inputId);
  if (!menu) return { ok: false, reason: 'no se encontro el selector de tamano de pagina' };
  if (Number(menu.input?.value) >= size) return { ok: true, reason: 'ya estaba' };

  let options = readPageSizeOptions(menu.root);
  if (!options.length) {
    // Algunas versiones montan la lista recien al abrir el desplegable.
    const toggle = menu.root.querySelector(SELECTORS.pageSizeToggle);
    if (toggle) {
      clickEl(toggle);
      await sleep(150, signal);
      options = readPageSizeOptions(menu.root);
    }
  }

  const option = pickPageSizeOption(options, size);
  if (!option) return { ok: false, reason: `no hay opcion de ${size} por pagina` };

  const before = snapshot();
  clickEl(option.el);
  try {
    await waitFor(() => Number(menu.input?.value) === option.size || snapshot() !== before, {
      signal,
      timeout: 15000,
      interval: 150,
      description: `${option.size} filas por pagina`,
    });
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    return { ok: false, reason: toMessage(err) };
  }
  await sleep(200, signal);
  return { ok: true, size: option.size };
}

function findPageSizeMenu(host, inputId) {
  const byId = inputId ? document.getElementById(inputId) : null;
  const root = byId?.closest('.selectmenu') || host?.querySelector(SELECTORS.pageSizeMenu);
  if (!root) return null;
  return { root, input: byId || root.querySelector('input') };
}

function readPageSizeOptions(root) {
  return Array.from(root.querySelectorAll(SELECTORS.pageSizeOption))
    .map((el) => ({ el, size: Number(String(el.textContent || '').trim()) }))
    .filter((option) => Number.isFinite(option.size) && option.size > 0);
}

/**
 * El tamano pedido si existe; si no, el mayor disponible. Traer 100 de a una vez
 * sigue siendo mucho mejor que recorrer paginas de 20.
 */
export function pickPageSizeOption(options, size) {
  const list = Array.isArray(options) ? options.filter((option) => Number.isFinite(option?.size)) : [];
  if (!list.length) return null;
  return list.find((option) => option.size === size)
    || list.reduce((best, option) => (option.size > best.size ? option : best));
}

async function goToFirstPage(tableGetter, signal) {
  for (let safety = 0; safety < 100; safety += 1) {
    const table = tableGetter();
    const host = table?.closest(SELECTORS.gridWrap) || document;
    const previous = host.querySelector(SELECTORS.pagerPrevious);
    if (isPagerDisabled(previous)) return;
    const current = host.querySelector(SELECTORS.pagerCurrent)?.value || '';
    clickEl(previous);
    await waitFor(() => {
      const nextTable = tableGetter();
      const nextHost = nextTable?.closest(SELECTORS.gridWrap) || document;
      const nextValue = nextHost.querySelector(SELECTORS.pagerCurrent)?.value || '';
      return nextValue !== current ? nextValue : null;
    }, { signal, timeout: 15000, interval: 150, description: 'volver a primera pagina' });
  }
  throw new Error('No se pudo volver a la primera pagina');
}

function listingHost() {
  return findListingTable()?.closest(SELECTORS.gridWrap) || document;
}

function regionalHost() {
  const root = document.querySelector(SELECTORS.regionalRoot);
  return findRegionalTable()?.closest(SELECTORS.gridWrap) || root || null;
}

function listingSnapshot() {
  return parseListingRows().map((rule) => rule.id).join('|');
}

function regionalSnapshot() {
  return JSON.stringify(parseRegionalRows());
}
