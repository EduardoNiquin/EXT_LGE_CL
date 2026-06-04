// Flujo de la grilla de órdenes: filtrar por "On Hold", recolectar las
// "On Hold (Fuera de Stock)" y abrir el detalle de una orden.

import { PAGE_TYPE, ROUTES, TEXTS } from '../../constants.js';
import { firstTable, tableRows } from '../vuetify/datatable.js';
import { selectByLabel } from '../vuetify/select.js';
import { collectFueraDeStock, parseOrderProducts } from '../parser.js';
import { gotoRoute, onPageType } from './navigate.js';
import { detectPage } from '../detector.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('starkoms');

/** Espera a que la grilla de órdenes tenga filas. */
function ordersGridReady() {
  if (detectPage().type !== PAGE_TYPE.ORDERS_LIST) return null;
  const table = firstTable();
  return table && tableRows(table).length > 0 ? true : null;
}

/**
 * Asegura estar en #/ordenes y aplica el filtro "Filtro por estado" = "On Hold".
 * Devuelve la lista de órdenes "On Hold (Fuera de Stock)" detectadas.
 */
export async function ensureOrdersFiltered({ signal } = {}) {
  await gotoRoute(ROUTES.orders(), { ready: ordersGridReady, signal });

  // Snapshot de la primera fila para detectar el refresh tras filtrar.
  const beforeFirst = firstTable()?.querySelector('tbody tr')?.textContent ?? '';

  await selectByLabel({ labelText: TEXTS.STATUS_FILTER_LABEL, optionText: TEXTS.STATE_ON_HOLD, signal });

  // La grilla recarga vía AJAX. Esperamos a que cambie el snapshot o aparezcan
  // filas "On Hold"; si no, seguimos igual tras un breve settle.
  await waitFor(() => {
    const table = firstTable();
    if (!table) return null;
    const rows = tableRows(table);
    if (rows.length === 0) return true; // filtro dejó la grilla vacía
    const firstChanged = (rows[0]?.textContent ?? '') !== beforeFirst;
    const anyOnHold = rows.some((tr) => /on hold/i.test(tr.textContent || ''));
    return firstChanged || anyOnHold ? true : null;
  }, { signal, timeout: 12000, interval: 200, description: 'refresh de grilla tras filtrar' }).catch(() => {});

  await sleep(400, signal).catch(() => {});

  const list = collectFueraDeStock();
  log.info(`órdenes On Hold (Fuera de Stock): ${list.length}`);
  return list;
}

/** Abre el detalle de una orden por su número y devuelve sus productos. */
export async function openOrder(orderNumber, { signal } = {}) {
  await gotoRoute(ROUTES.orderDetail(orderNumber), {
    ready: () => (onPageType(PAGE_TYPE.ORDER_DETAIL)() && parseOrderProducts().length > 0 ? true : null),
    signal,
  });
  return parseOrderProducts();
}
