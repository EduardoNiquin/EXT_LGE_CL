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
  LISTING_PAGE_SIZE,
  LISTING_RELATED_PRODUCT_COLUMN,
  MAX_LISTING_PAGES,
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

/**
 * Filas visibles del listado. Ademas del padre trae los hijos, que Magento ya
 * publica en la columna "Related Product" separados por coma: alcanza para
 * exportar el arbol completo sin entrar a una sola regla.
 *
 * @returns {Array<{id:string, mainProduct:string, relatedProducts:string[], deleteHref:string, row:Element}>}
 */
export function parseListingRows() {
  const table = document.querySelector(SELECTORS.gridTable);
  if (!table) return [];
  const headers = headerIndexMap(table);
  const idIndex = headers[LISTING_ID_COLUMN];
  const skuIndex = headers[LISTING_MAIN_PRODUCT_COLUMN];
  const relatedIndex = headers[LISTING_RELATED_PRODUCT_COLUMN];

  return Array.from(table.querySelectorAll(SELECTORS.gridRow)).map((row) => {
    const cells = Array.from(row.querySelectorAll('td'));
    const read = (index) => (index == null ? '' : cells[index]?.querySelector(SELECTORS.gridCell)?.textContent?.trim()
      || cells[index]?.textContent?.trim() || '');
    return {
      id: read(idIndex),
      mainProduct: read(skuIndex),
      relatedProducts: splitRelated(read(relatedIndex)),
      deleteHref: row.querySelector(SELECTORS.rowDeleteLink)?.getAttribute('href') || '',
      row,
    };
  });
}

/** "CL.A, CL.B" -> ["CL.A", "CL.B"]. Una regla sin ofertas devuelve []. */
export function splitRelated(value) {
  return String(value ?? '')
    .split(/[,\n;]/)
    .map((sku) => sku.trim())
    .filter(Boolean);
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

// -----------------------------------------------------------------------------
// borrado de un package rule existente (politica de duplicados "borrar")
// -----------------------------------------------------------------------------

/**
 * Borra el package rule de `sku`. Es la UNICA accion destructiva del modulo y
 * solo se llega aca con la politica de duplicados en "borrar" (o con un "si"
 * del usuario), nunca en modo simulacion.
 *
 * Salvaguardas, en este orden:
 *   1. Se filtra el listado por el SKU y se exige que la columna "Main Product"
 *      coincida EXACTO (`sameSku`): el filtro de Magento es "contiene", asi que
 *      sin esto se podria borrar la regla de otro producto.
 *   2. Si el filtro devuelve mas de una fila exacta, se aborta: no se adivina.
 *   3. Si se paso un `expectedId`, tiene que ser el de la fila.
 *
 * Borrar la regla **borra sus ofertas en cascada**, y Magento recarga el
 * listado: el que llama tiene que dar por muerto el tick en curso.
 *
 * @returns {Promise<{ deleted: boolean, id: string, reason?: string }>}
 */
export async function deleteExistingRule(sku, { signal, expectedId = '' } = {}) {
  const found = await findExistingRule(sku, { signal });
  if (!found.found) return { deleted: false, id: '', reason: 'ya no figura en el listado' };

  const matches = parseListingRows().filter((row) => sameSku(row.mainProduct, sku));
  if (matches.length !== 1) {
    return { deleted: false, id: found.id, reason: `el listado devolvio ${matches.length} filas exactas para ${sku}; no se borra nada` };
  }
  const [target] = matches;
  if (expectedId && String(target.id) !== String(expectedId)) {
    return { deleted: false, id: target.id, reason: `la fila cambio de package rule (${expectedId} -> ${target.id}); no se borra nada` };
  }

  const link = target.row.querySelector(SELECTORS.rowDeleteLink);
  if (!link) return { deleted: false, id: target.id, reason: 'la fila no expone el enlace "Delete"' };

  try { window.onbeforeunload = null; } catch { /* no-op */ }
  clickEl(link);

  // "Are you sure you want to delete selected item?" — sin aceptar no pasa nada.
  const modal = await waitFor(() => document.querySelector(SELECTORS.confirmModal), {
    signal, timeout: 8000, interval: 100, description: 'confirmacion de borrado',
  }).catch(() => null);
  if (!modal) return { deleted: false, id: target.id, reason: 'no aparecio la confirmacion de borrado' };

  const accept = Array.from(modal.querySelectorAll(SELECTORS.confirmAccept))
    .find((candidate) => /ok|aceptar|delete/i.test(candidate.textContent.trim()))
    || modal.querySelector(SELECTORS.confirmAccept);
  if (!accept) return { deleted: false, id: target.id, reason: 'la confirmacion no trae boton de aceptar' };

  clickEl(accept);
  // Magento recarga el listado; el mensaje de exito lo lee el tick siguiente.
  return { deleted: true, id: target.id };
}

// -----------------------------------------------------------------------------
// recorrido completo del listado (exportar los bundles existentes)
// -----------------------------------------------------------------------------

/** Magento marca el pager de 4 formas segun sea `<button>` o `<a>`. */
export function isPagerDisabled(el) {
  if (!el) return true;
  if (el.disabled) return true;
  if (el.hasAttribute?.('disabled')) return true;
  if (el.getAttribute?.('aria-disabled') === 'true') return true;
  return Boolean(el.classList?.contains('disabled') || el.classList?.contains('_disabled'));
}

/** El tamano pedido si existe; si no, el mayor disponible. */
export function pickPageSizeOption(options, size) {
  const list = Array.isArray(options) ? options.filter((option) => Number.isFinite(option?.size)) : [];
  if (!list.length) return null;
  return list.find((option) => option.size === size)
    || list.reduce((best, option) => (option.size > best.size ? option : best));
}

function gridHost() {
  return document.querySelector(SELECTORS.gridTable)?.closest(SELECTORS.gridOuterWrap) || document;
}

async function trySetPageSize(size, { signal } = {}) {
  const root = gridHost().querySelector(SELECTORS.pageSizeMenu);
  if (!root) return { ok: false, reason: 'no se encontro el selector de filas por pagina' };
  const input = root.querySelector('input');
  if (Number(input?.value) >= size) return { ok: true, reason: 'ya estaba' };

  const readOptions = () => Array.from(root.querySelectorAll(SELECTORS.pageSizeOption))
    .map((el) => ({ el, size: Number(String(el.textContent || '').trim()) }))
    .filter((option) => Number.isFinite(option.size) && option.size > 0);

  let options = readOptions();
  if (!options.length) {
    // Algunas versiones montan la lista recien al abrir el desplegable.
    const toggle = root.querySelector(SELECTORS.pageSizeToggle);
    if (toggle) {
      clickEl(toggle);
      await sleep(150, signal);
      options = readOptions();
    }
  }

  const option = pickPageSizeOption(options, size);
  if (!option) return { ok: false, reason: `no hay opcion de ${size} filas por pagina` };

  const before = gridSnapshot();
  clickEl(option.el);
  try {
    await waitFor(() => ((Number(input?.value) === option.size || gridSnapshot() !== before) ? true : null), {
      signal, timeout: 15000, interval: 150, description: `${option.size} filas por pagina`,
    });
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    return { ok: false, reason: 'el listado no se repinto al cambiar el tamano de pagina' };
  }
  await waitForGridReady({ signal });
  return { ok: true, size: option.size };
}

/**
 * Recorre TODAS las paginas del listado y devuelve las reglas con sus hijos.
 * Solo lectura: los unicos clics son el selector de tamano de pagina y el
 * paginador. Una pagina que no avanza NO pierde lo recolectado: se avisa por
 * `onWarn` y se devuelve lo que haya (mejor un CSV parcial que ninguno).
 *
 * @returns {Promise<Array<{id:string, mainProduct:string, relatedProducts:string[]}>>}
 */
export async function collectAllBundles({ signal, onWarn = () => {}, onProgress = () => {} } = {}) {
  await waitForGridReady({ signal });
  // Los filtros del listado persisten por usuario: heredar el de otra consulta
  // exportaria un subconjunto sin avisar.
  await clearFilters({ signal });

  const sized = await trySetPageSize(LISTING_PAGE_SIZE, { signal });
  if (!sized.ok) onWarn(`No se pudo fijar ${LISTING_PAGE_SIZE} filas por pagina (${sized.reason}); se recorre con el tamano actual.`);

  const output = [];
  const seen = new Set();

  for (let page = 0; page < MAX_LISTING_PAGES; page += 1) {
    await waitForGridReady({ signal });
    parseListingRows().forEach((row) => {
      const key = row.id || row.mainProduct;
      if (!key || seen.has(key)) return;
      seen.add(key);
      output.push({ id: row.id, mainProduct: row.mainProduct, relatedProducts: row.relatedProducts });
    });
    onProgress({ page: page + 1, rules: output.length, total: readRecordsFound() });

    const next = gridHost().querySelector(SELECTORS.pagerNext);
    if (isPagerDisabled(next)) return output;

    const before = gridSnapshot();
    clickEl(next);
    try {
      await waitFor(() => (gridSnapshot() !== before ? true : null), {
        signal, timeout: 15000, interval: 150, description: `pagina ${page + 2} del listado`,
      });
      await sleep(150, signal);
    } catch (err) {
      if (isAbortError(err, signal)) throw err;
      onWarn(`No se pudo avanzar mas alla de la pagina ${page + 1}. Se exporta con ${output.length} regla(s).`);
      return output;
    }
  }

  onWarn(`Se alcanzo el limite de ${MAX_LISTING_PAGES} paginas. Se exporta con ${output.length} regla(s).`);
  return output;
}
