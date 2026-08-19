import { isAbortError, toMessage } from '../../../../shared/errors/index.js';
import { clickEl } from '../../../../shared/dom/events.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { SELECTORS } from '../../constants.js';
import { findListingTable } from '../detector.js';
import { findRegionalTable, parseListingRows, parseRegionalRows } from '../parser.js';

const noop = () => {};

export async function waitForListingReady({ signal, timeout = 20000 } = {}) {
  return waitFor(() => {
    const table = findListingTable();
    if (!table) return null;
    const host = table.closest('.admin__data-grid-outer-wrap') || document;
    const mask = host.querySelector(SELECTORS.listingLoadingMask);
    if (mask && mask.offsetParent !== null) return null;
    const rows = table.querySelectorAll(SELECTORS.listingRow);
    if (rows.length) return table;
    return /0\s+records found/i.test(host.textContent || '') ? table : null;
  }, { signal, timeout, interval: 150, description: 'listado Global Shipping Rules listo' });
}

export async function collectAllRules({ signal, maxPages = 100, onWarn = noop } = {}) {
  await waitForListingReady({ signal });
  await trySetPageSize(200, signal, onWarn);
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

    const table = findListingTable();
    const host = table?.closest('.admin__data-grid-outer-wrap') || document;
    const next = host.querySelector(SELECTORS.pagerNext);
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

export async function collectAllRegionalRows({ signal, maxPages = 100, onWarn = noop } = {}) {
  await waitForRegionalReady({ signal });
  await goToFirstPage(() => findRegionalTable(), signal);
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

    const table = findRegionalTable();
    const root = document.querySelector(SELECTORS.regionalRoot);
    const host = table?.closest('.admin__data-grid-outer-wrap') || root;
    const next = host?.querySelector(SELECTORS.pagerNext);
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

async function trySetPageSize(size, signal, onWarn = noop) {
  const input = document.getElementById(SELECTORS.listingPageSizeInputId);
  if (!input || Number(input.value) === size) return;
  const menu = input.closest('.selectmenu');
  const option = Array.from(menu?.querySelectorAll('.selectmenu-item-action') || [])
    .find((button) => button.textContent?.trim() === String(size));
  if (!option) {
    onWarn(`No se encontro la opcion de ${size} rules por pagina; se recorrera el listado con el tamano actual.`);
    return;
  }
  const before = listingSnapshot();
  clickEl(option);
  try {
    await waitFor(() => Number(input.value) === size || listingSnapshot() !== before, {
      signal,
      timeout: 15000,
      interval: 150,
      description: `${size} rules por pagina`,
    });
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    onWarn(`No se pudo fijar ${size} rules por pagina (${toMessage(err)}); se recorrera el listado con el tamano actual.`);
    return;
  }
  await sleep(200, signal);
}

async function goToFirstPage(tableGetter, signal) {
  for (let safety = 0; safety < 100; safety += 1) {
    const table = tableGetter();
    const host = table?.closest('.admin__data-grid-outer-wrap') || document;
    const previous = host.querySelector(SELECTORS.pagerPrevious);
    if (isPagerDisabled(previous)) return;
    const current = host.querySelector(SELECTORS.pagerCurrent)?.value || '';
    clickEl(previous);
    await waitFor(() => {
      const nextTable = tableGetter();
      const nextHost = nextTable?.closest('.admin__data-grid-outer-wrap') || document;
      const nextValue = nextHost.querySelector(SELECTORS.pagerCurrent)?.value || '';
      return nextValue !== current ? nextValue : null;
    }, { signal, timeout: 15000, interval: 150, description: 'volver a primera pagina' });
  }
  throw new Error('No se pudo volver a la primera pagina');
}

function listingSnapshot() {
  return parseListingRows().map((rule) => rule.id).join('|');
}

function regionalSnapshot() {
  return JSON.stringify(parseRegionalRows());
}
