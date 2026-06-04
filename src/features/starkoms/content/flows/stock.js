// Flujo de stock: chequear el stock de un producto (toast), verificar que el
// producto exista (#/productos) y asignar stock en el inventario.

import { PAGE_TYPE, ROUTES, SELECTORS, TEXTS } from '../../constants.js';
import { gotoRoute, onPageType } from './navigate.js';
import { detectPage } from '../detector.js';
import { findWarehouseRow, parseProductsSearchRows, parseWarehouseRows } from '../parser.js';
import { dismissToast, parseToast, stockForBodega, waitToast } from '../vuetify/toast.js';
import { findButtonByText } from '../vuetify/buttons.js';
import { selectByLabel, selectedValue, findSelectByLabel } from '../vuetify/select.js';
import { clickEl, setInputValue } from '../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../shared/dom/wait.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('starkoms');

/**
 * Chequea el stock de un producto en la bodega configurada haciendo click en su
 * botón SKU (abre un toast con la tabla Bodega/Stock). Devuelve { stock, rows }.
 * `stock` es null si la bodega no aparece (se interpreta como sin stock).
 */
export async function checkStock(skuButton, bodega, { signal } = {}) {
  clickEl(skuButton);
  await waitToast({ signal }).catch(() => {});
  await sleep(250, signal).catch(() => {});
  const rows = parseToast();
  const stock = stockForBodega(rows, bodega);
  await dismissToast({ signal });
  return { stock, rows };
}

/**
 * Verifica que el producto exista en Starkoms buscándolo en #/productos.
 * Devuelve true si hay resultados. (Si no existe → hay que crearlo a mano.)
 */
export async function verifyExists(sku, { signal } = {}) {
  await gotoRoute(ROUTES.products(), {
    ready: () => (onPageType(PAGE_TYPE.PRODUCTS)() && findButtonByText(TEXTS.SEARCH) ? true : null),
    signal,
  });

  await searchSku(sku, { signal });

  // Exigir que ALGUNA fila mencione el SKU (la lista por defecto no cuenta:
  // antes el `|| rows.length>0` daba falso positivo).
  const skuLc = String(sku).toLowerCase();
  await waitFor(() => (parseProductsSearchRows().some((t) => t.toLowerCase().includes(skuLc)) ? true : null),
    { signal, timeout: 8000, interval: 200, description: 'resultados de búsqueda de producto' }).catch(() => {});

  await sleep(300, signal).catch(() => {});
  const rows = parseProductsSearchRows();
  const exists = rows.some((t) => t.toLowerCase().includes(skuLc));
  log.info(`verifyExists("${sku}") → ${exists} (${rows.length} fila(s))`);
  return exists;
}

/** Predicado: estamos en el form Actualizar Stock con el input de cantidad. */
function stockEditReady() {
  if (detectPage().type !== PAGE_TYPE.STOCK_EDIT) return null;
  return document.querySelector(SELECTORS.numberInput) ? true : null;
}

/** Visible (descarta inputs ocultos). */
function isVisible(el) {
  return Boolean(el && el.offsetParent !== null);
}

/**
 * Ubica el input del buscador. Preferimos el `<input>` asociado al
 * `<label>Buscar</label>` (más preciso); si no, subimos desde el botón "Buscar"
 * hasta el primer ancestro que contiene un input de texto visible (evita agarrar
 * un input de otra sección, como el filtro por categoría o un search global).
 */
function findSearchInput(buscar) {
  // 1) Subir desde el botón hasta el ancestro que contenga un input de texto
  //    visible. Es lo más confiable: queda acotado al buscador de ESTA pantalla
  //    (evita un "Buscar" global del navbar que esté antes en el DOM).
  let cont = buscar?.parentElement;
  while (cont) {
    const input = Array.from(cont.querySelectorAll('input[type="text"]')).find(isVisible);
    if (input) return input;
    cont = cont.parentElement;
  }
  // 2) Respaldo: el <input> asociado al <label>Buscar</label> visible.
  const lbl = Array.from(document.querySelectorAll('label'))
    .find((l) => l.textContent.trim().toLowerCase() === TEXTS.SEARCH.toLowerCase());
  if (lbl) {
    const id = lbl.getAttribute('for');
    const byId = id ? document.getElementById(id) : null;
    if (byId && byId.matches('input') && isVisible(byId)) return byId;
    const near = lbl.closest('.v-input')?.querySelector('input[type="text"]');
    if (isVisible(near)) return near;
  }
  return null;
}

/** Firma de la primera fila del grid (para detectar el refresh tras buscar). */
function firstRowSignature() {
  const tr = document.querySelector('table tbody tr');
  return tr ? (tr.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
}

/** Dispara la secuencia de teclas Enter sobre un elemento. */
function pressEnter(el) {
  for (const type of ['keydown', 'keypress', 'keyup']) {
    el.dispatchEvent(new KeyboardEvent(type, {
      bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
    }));
  }
}

const nativeInputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

function setNativeValue(input, value) {
  if (nativeInputSetter) nativeInputSetter.call(input, value); else input.value = value;
}

/**
 * Tipea texto carácter por carácter, emitiendo `InputEvent` reales por pulsación.
 * Necesario para inputs cuyo filtro/búsqueda se dispara por watcher de tecleo
 * (el set directo del value no lo activa, p.ej. el buscador del inventario).
 */
async function typeText(input, text, { signal } = {}) {
  input.focus();
  setNativeValue(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  let acc = '';
  for (const ch of String(text)) {
    acc += ch;
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch }));
    input.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: ch }));
    setNativeValue(input, acc);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
    await sleep(25, signal).catch(() => {});
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Busca un SKU en el buscador de la pantalla actual. Setea el valor con el
 * setter nativo (robusto ante el tracking de value de los frameworks) + eventos
 * input/change, dispara Enter (varios buscadores Vuetify filtran con
 * `@keyup.enter`) y además clickea "Buscar". Espera a que el grid cambie.
 */
async function searchSku(sku, { signal } = {}) {
  log.info('searchSku: inicio', { url: location.href, sku });
  const buscar = findButtonByText(TEXTS.SEARCH);
  if (!buscar) throw new Error('No se encontró el botón "Buscar"');
  log.info('searchSku: botón Buscar', { text: (buscar.textContent || '').trim(), class: buscar.className });

  const input = findSearchInput(buscar);
  if (!input) throw new Error('No se encontró el input de búsqueda');
  const labelFor = document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim();
  log.info('searchSku: input encontrado', { id: input.id, type: input.type, label: labelFor, valueAntes: input.value });

  const before = firstRowSignature();

  // Tipeo carácter por carácter (dispara watchers por pulsación) + Enter + click.
  await typeText(input, sku, { signal });
  log.info('searchSku: tras tipear', { valueDespues: input.value, esperado: String(sku) });
  await sleep(200, signal).catch(() => {});
  pressEnter(input);
  clickEl(buscar);
  log.info('searchSku: Enter + click Buscar disparados');

  // Esperar a que el grid se refresque (cambie la primera fila) o aparezca el SKU.
  const changed = await waitFor(() => {
    if (firstRowSignature() !== before) return 'snapshot';
    const hit = Array.from(document.querySelectorAll('table tbody tr'))
      .some((tr) => (tr.textContent || '').toLowerCase().includes(String(sku).toLowerCase()));
    return hit ? 'sku' : null;
  }, { signal, timeout: 8000, interval: 150, description: 'refresh del grid tras buscar' }).catch(() => null);
  await sleep(400, signal).catch(() => {});
  log.info('searchSku: tras buscar', {
    url: location.href,
    motivoRefresh: changed || 'timeout',
    valueFinal: input.value,
    filas: document.querySelectorAll('table tbody tr').length,
    primeraFila: firstRowSignature(),
  });
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Link del ojo (Acciones) del producto en el listado de inventario. Tolera el
 * link directo a la página del producto (`.../<SKU>`) o al stock de una bodega
 * (`.../<SKU>/<id>`); si el href no matchea, cae a la fila que contiene el SKU.
 */
function findProductEyeLink(sku) {
  const skuLc = String(sku).toLowerCase();
  const anchors = Array.from(document.querySelectorAll(SELECTORS.inventoryEyeLink));
  const re = new RegExp(`#/inventario/stock/productos/${escapeRe(skuLc)}(?:/\\d+)?/?$`, 'i');
  const byHref = anchors.find((a) => re.test(decodeURIComponent(a.getAttribute('href') || '').toLowerCase()));
  if (byHref) return byHref;

  // Fallback: la fila de la tabla que menciona el SKU → su link de Acciones.
  const row = Array.from(document.querySelectorAll('table tbody tr'))
    .find((tr) => (tr.textContent || '').toLowerCase().includes(skuLc));
  return row?.querySelector(SELECTORS.inventoryEyeLink) || null;
}

/** Resumen del estado del listado de inventario, para diagnóstico al fallar. */
function inventoryDiag(sku) {
  const rows = document.querySelectorAll('table tbody tr').length;
  const hrefs = Array.from(document.querySelectorAll(SELECTORS.inventoryEyeLink))
    .map((a) => a.getAttribute('href')).slice(0, 4);
  const skuRows = Array.from(document.querySelectorAll('table tbody tr'))
    .filter((tr) => (tr.textContent || '').toLowerCase().includes(String(sku).toLowerCase())).length;
  return `filas:${rows}, filas con SKU:${skuRows}, links:[${hrefs.join(' | ') || '—'}]`;
}

/**
 * Asigna stock a un producto en la bodega configurada, replicando el flujo
 * manual (el deep-link directo NO carga las bodegas):
 *   1. Listado de inventario (#/inventario/stock/productos) + buscar el SKU.
 *   2. Click en el ojo del producto en resultados → página del producto.
 *   3. Click en el ojo de la bodega (Acciones → .../<sku>/<bodegaId>) → form.
 *   4. Setea Cantidad y asegura "Bodega TO"; click "Guardar" (salvo dryRun).
 * Devuelve { ok, reason? }.
 */
export async function remediateStock(sku, bodega, value, { signal, dryRun = false } = {}) {
  // 1) Listado de inventario + búsqueda del SKU.
  await gotoRoute(ROUTES.inventoryList(), {
    ready: () => (onPageType(PAGE_TYPE.INVENTORY_LIST)() && findButtonByText(TEXTS.SEARCH) ? true : null),
    signal,
  });
  // Esperar a que el grid termine la carga inicial (componente montado) antes de tipear.
  await waitFor(() => (document.querySelectorAll('table tbody tr').length > 0 ? true : null),
    { signal, timeout: 8000, interval: 150, description: 'carga inicial del grid de inventario' }).catch(() => {});
  await searchSku(sku, { signal });

  // 2) Ojo del producto en resultados → página del producto (carga las bodegas).
  const prodLink = await waitFor(() => findProductEyeLink(sku), {
    signal, timeout: 8000, interval: 150, description: 'producto en el inventario',
  }).catch(() => null);
  if (!prodLink) {
    return { ok: false, reason: `Producto ${sku} no aparece en el inventario (${inventoryDiag(sku)})` };
  }
  log.info('remediateStock: click ojo producto', { href: prodLink.getAttribute('href'), url: location.href });
  clickEl(prodLink);

  // 3) Esperar las bodegas del producto y abrir la configurada.
  await waitFor(() => (onPageType(PAGE_TYPE.INVENTORY_PRODUCT)() && parseWarehouseRows(sku).length > 0 ? true : null), {
    signal, timeout: 10000, interval: 150, description: 'bodegas del producto',
  }).catch(() => {});
  const rows = parseWarehouseRows(sku);
  log.info('remediateStock: bodegas del producto', {
    url: location.href, total: rows.length, ids: rows.map((r) => r.bodegaId),
    bodegas: rows.map((r) => r.rowText.slice(0, 40)),
  });
  const wh = findWarehouseRow(sku, bodega) || (rows.length === 1 ? rows[0] : null);
  if (!wh) {
    return {
      ok: false,
      reason: `Bodega "${bodega}" no encontrada (${rows.length} bodega(s); ids: ${rows.map((r) => r.bodegaId).join(', ') || '—'})`,
    };
  }

  // Abrir la edición de esa bodega (link de Acciones → .../<sku>/<bodegaId>).
  log.info('remediateStock: click ojo bodega', { href: wh.linkEl.getAttribute('href'), bodegaId: wh.bodegaId });
  clickEl(wh.linkEl);
  await waitFor(stockEditReady, { signal, timeout: 12000, interval: 150, description: 'form Actualizar Stock' });
  await sleep(300, signal).catch(() => {});
  log.info('remediateStock: form Actualizar Stock', { url: location.href });

  // 3) Cantidad + Bodega TO.
  const input = await waitForElement(SELECTORS.numberInput, { signal, timeout: 5000, description: 'input Cantidad' });
  setInputValue(input, String(value));
  log.info('remediateStock: cantidad seteada', { value: input.value });

  // La bodega TO suele venir preseleccionada (navegamos por su id). Si no
  // coincide, la elegimos.
  try {
    const sel = findSelectByLabel(TEXTS.BODEGA_TO_LABEL);
    if (sel && selectedValue(sel).trim().toLowerCase() !== String(bodega).trim().toLowerCase()) {
      await selectByLabel({ labelText: TEXTS.BODEGA_TO_LABEL, optionText: bodega, signal });
    }
  } catch (err) {
    log.warn(`no se pudo confirmar Bodega TO: ${err?.message || err}`);
  }

  if (dryRun) {
    log.info(`[simulación] stock ${value} para ${sku} en ${bodega} (no se guarda)`);
    return { ok: true, dryRun: true };
  }

  const guardar = findButtonByText(TEXTS.SAVE);
  if (!guardar) return { ok: false, reason: 'No se encontró el botón Guardar del form de stock' };
  clickEl(guardar);
  await sleep(1200, signal).catch(() => {});
  log.info(`stock ${value} asignado a ${sku} en ${bodega}`);
  return { ok: true };
}
