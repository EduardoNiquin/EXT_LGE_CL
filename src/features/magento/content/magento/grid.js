import { clickEl } from '../../../../shared/dom/events.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { SELECTORS } from '../../constants.js';
import { findListingTable } from '../detector.js';
import { findRegionalTable, parseListingRows, parseRegionalRows } from '../parser.js';

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

export async function collectAllRules({ signal, maxPages = 100 } = {}) {
  await waitForListingReady({ signal });
  await trySetPageSize(200, signal);
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
    if (!next || next.disabled) return output;
    const before = listingSnapshot();
    clickEl(next);
    await waitFor(() => {
      const current = listingSnapshot();
      return current && current !== before ? current : null;
    }, { signal, timeout: 15000, interval: 150, description: 'siguiente pagina de rules' });
    await sleep(200, signal);
  }

  throw new Error(`Se alcanzo el limite de ${maxPages} paginas del listado`);
}

export async function collectAllRegionalRows({ signal, maxPages = 100 } = {}) {
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
    if (!next || next.disabled) return output;
    const before = regionalSnapshot();
    clickEl(next);
    await waitFor(() => {
      const current = regionalSnapshot();
      return current && current !== before ? current : null;
    }, { signal, timeout: 15000, interval: 150, description: 'siguiente pagina regional' });
    await sleep(200, signal);
  }

  throw new Error(`Se alcanzo el limite de ${maxPages} paginas regionales`);
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

async function trySetPageSize(size, signal) {
  const input = document.getElementById(SELECTORS.listingPageSizeInputId);
  if (!input || Number(input.value) === size) return;
  const menu = input.closest('.selectmenu');
  const option = Array.from(menu?.querySelectorAll('.selectmenu-item-action') || [])
    .find((button) => button.textContent?.trim() === String(size));
  if (!option) return;
  const before = listingSnapshot();
  clickEl(option);
  await waitFor(() => Number(input.value) === size || listingSnapshot() !== before, {
    signal,
    timeout: 15000,
    interval: 150,
    description: `${size} rules por pagina`,
  });
  await sleep(200, signal);
}

async function goToFirstPage(tableGetter, signal) {
  for (let safety = 0; safety < 100; safety += 1) {
    const table = tableGetter();
    const host = table?.closest('.admin__data-grid-outer-wrap') || document;
    const previous = host.querySelector(SELECTORS.pagerPrevious);
    if (!previous || previous.disabled) return;
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
