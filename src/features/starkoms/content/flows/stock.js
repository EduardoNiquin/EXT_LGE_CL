// Flujo de stock: chequear el stock de un producto (toast), verificar que el
// producto exista (#/productos) y asignar stock en el inventario.

import { PAGE_TYPE, ROUTES, SELECTORS, TEXTS } from '../../constants.js';
import { gotoRoute, onPageType } from './navigate.js';
import { detectPage } from '../detector.js';
import { firstTable } from '../vuetify/datatable.js';
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

  const buscar = findButtonByText(TEXTS.SEARCH);
  const card = buscar?.closest('.v-card, .container, .d-flex') || document;
  const input = card.querySelector('input[type="text"]') || document.querySelector('input[type="text"]');
  if (!input || !buscar) throw new Error('No se encontró el buscador de #/productos');

  setInputValue(input, sku);
  clickEl(buscar);

  await waitFor(() => {
    const table = firstTable();
    if (!table) return null;
    const rows = parseProductsSearchRows();
    // Resultado positivo: alguna fila menciona el SKU.
    if (rows.some((t) => t.toLowerCase().includes(String(sku).toLowerCase()))) return 'found';
    return null;
  }, { signal, timeout: 8000, interval: 200, description: 'resultados de búsqueda de producto' }).catch(() => {});

  await sleep(300, signal).catch(() => {});
  const rows = parseProductsSearchRows();
  const exists = rows.some((t) => t.toLowerCase().includes(String(sku).toLowerCase())) || rows.length > 0;
  log.info(`verifyExists("${sku}") → ${exists} (${rows.length} fila(s))`);
  return exists;
}

/** Predicado: estamos en el form Actualizar Stock con el input de cantidad. */
function stockEditReady() {
  if (detectPage().type !== PAGE_TYPE.STOCK_EDIT) return null;
  return document.querySelector(SELECTORS.numberInput) ? true : null;
}

/**
 * Asigna stock a un producto en la bodega configurada.
 *   1. Navega al detalle de inventario del SKU.
 *   2. Ubica la fila de la bodega y abre su edición.
 *   3. Setea Cantidad y asegura "Bodega TO"; click "Guardar" (salvo dryRun).
 * Devuelve { ok, reason? }.
 */
export async function remediateStock(sku, bodega, value, { signal, dryRun = false } = {}) {
  // 1) Detalle de inventario del producto (lista de bodegas).
  await gotoRoute(ROUTES.inventoryProduct(sku), {
    ready: () => (onPageType(PAGE_TYPE.INVENTORY_PRODUCT)()
      && (parseWarehouseRows(sku).length > 0 || firstTable()) ? true : null),
    signal,
  });
  await sleep(300, signal).catch(() => {});

  const wh = findWarehouseRow(sku, bodega);
  if (!wh) {
    const found = parseWarehouseRows(sku).length;
    return { ok: false, reason: `Bodega "${bodega}" no encontrada en inventario (${found} bodega(s) listada(s))` };
  }

  // 2) Abrir la edición de esa bodega (link de Acciones → .../<sku>/<bodegaId>).
  clickEl(wh.linkEl);
  await waitFor(stockEditReady, { signal, timeout: 12000, interval: 150, description: 'form Actualizar Stock' });
  await sleep(300, signal).catch(() => {});

  // 3) Cantidad + Bodega TO.
  const input = await waitForElement(SELECTORS.numberInput, { signal, timeout: 5000, description: 'input Cantidad' });
  setInputValue(input, String(value));

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
