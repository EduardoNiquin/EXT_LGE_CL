import { cmd, register } from '../../shared/debug/index.js';
import { DEFAULTS, SELECTORS } from './constants.js';
import { detectPage, diagnose } from './content/detector.js';
import { collectFueraDeStock, parseOrderProducts, parseOrdersGrid, parseWarehouseRows } from './content/parser.js';
import { clearRun, getLastConfig, getRun, setRun } from './state.js';
import { tickIfActive } from './content/flows/run.js';
import { openOrder } from './content/flows/orders.js';
import { checkStock, remediateStock, verifyExists } from './content/flows/stock.js';
import { setOrderState } from './content/flows/order-state.js';

register('starkoms', {
  diagnose: cmd(() => diagnose(), 'Diagnóstico de detección de pantalla y selectores'),
  page: cmd(() => detectPage(), 'Pantalla actual (tipo + params del hash)'),
  selectors: cmd(() => ({ ...SELECTORS }), 'Mapa de selectores que usa la feature'),
  parseOrders: cmd(() => ({ all: parseOrdersGrid(), fueraDeStock: collectFueraDeStock() }), 'Filas de la grilla de órdenes'),
  products: cmd(() => parseOrderProducts(), 'Productos del detalle de orden actual'),
  warehouses: cmd((sku) => parseWarehouseRows(sku), 'Bodegas del detalle de inventario (pasar sku)'),
  state: cmd(() => getRun(), 'Estado persistido del run actual'),
  config: cmd(() => getLastConfig(), 'Última config guardada del popup'),

  checkStock: cmd(async (bodega = DEFAULTS.bodega) => {
    const p = parseOrderProducts().find((x) => x.skuButton);
    if (!p) return { error: 'No hay producto con botón SKU en esta pantalla' };
    return checkStock(p.skuButton, bodega, {});
  }, 'Chequea stock del 1er producto del detalle (checkStock("Bodega ..."))'),

  verifyExists: cmd((sku) => verifyExists(sku, {}), 'Verifica existencia del SKU en #/productos'),

  remediate: cmd(
    ({ sku, bodega = DEFAULTS.bodega, value = DEFAULTS.stockValue, dryRun = true } = {}) =>
      remediateStock(sku, bodega, value, { dryRun }),
    'Asigna stock a un SKU ({sku,bodega?,value?,dryRun=true})',
  ),

  changeState: cmd(
    ({ orderNumber, dryRun = true } = {}) => setOrderState(orderNumber, { dryRun }),
    'Cambia estado de una orden a Ingresado ({orderNumber,dryRun=true})',
  ),

  runOne: cmd(async ({ orderNumber, bodega = DEFAULTS.bodega, value = DEFAULTS.stockValue, dryRun = true } = {}) => {
    if (!orderNumber) return { error: 'pasar { orderNumber }' };
    const products = await openOrder(orderNumber, {});
    const out = { orderNumber, products: [] };
    const needSku = [];
    for (const p of products) {
      if (!p.skuButton) continue;
      const { stock } = await checkStock(p.skuButton, bodega, {});
      const has = stock != null && stock > 0;
      out.products.push({ sku: p.sku, stock, has });
      if (!has) needSku.push(p.sku);
    }
    for (const sku of needSku) {
      const r = await remediateStock(sku, bodega, value, { dryRun });
      out.products.push({ sku, remediate: r });
    }
    out.state = await setOrderState(orderNumber, { dryRun });
    return out;
  }, 'Procesa UNA orden end-to-end ({orderNumber,bodega?,value?,dryRun=true}) — útil para probar'),

  stop: cmd(async () => {
    const r = await getRun();
    if (!r) return null;
    r.active = false;
    r.finishReason = 'cancelled-manual';
    await setRun(r);
    return r;
  }, 'Marca el run como inactivo'),
  reset: cmd(async () => { await clearRun(); return 'ok'; }, 'Borra el estado del run de storage'),
  tick: cmd(() => tickIfActive(), 'Fuerza un tick del runner en este frame'),
});
