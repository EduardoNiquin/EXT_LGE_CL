// Motor de ejecución storage-driven de "Verificar órdenes y stock".
//
// Patrón idéntico a colocar-tags/runner.js: el popup escribe el `run`; el
// content script (top frame en app.starkoms.com) lo reclama (claimed=true) y
// ejecuta TODO el batch como un único flujo async continuo. Starkoms es una SPA
// con hash routing, así que las navegaciones NO recargan la página y el flujo
// sobrevive entre rutas. Progreso/logs se publican en el mismo `run`.
//
// Cancelación: el popup pone active=false → index.js llama abortActiveRun() →
// AbortController aborta y el loop corta entre pasos.

import { STATUS, STEPS } from '../../constants.js';
import { appendLog, getRun, updateRun } from '../../state.js';
import { isStarkomsHost } from '../detector.js';
import { ensureOrdersFiltered, openOrder } from './orders.js';
import { checkStock, remediateStock, verifyExists } from './stock.js';
import { setOrderState } from './order-state.js';
import { SelectOptionNotFoundError } from '../vuetify/select.js';
import { logger } from '../../../../shared/utils/logger.js';
import { toMessage, isAbortError } from '../../../../shared/errors/index.js';

const log = logger('starkoms');

let running = false;
let activeCtrl = null;
let claimWatchdog = null;

// ---------------------------------------------------------------------------
// API pública (usada por content/index.js)
// ---------------------------------------------------------------------------

export async function tickIfActive() {
  if (running) return;
  const run = await getRun();
  if (!run || !run.active) return;

  if (!isStarkomsHost() || window !== window.top) {
    if (window === window.top) scheduleClaimWatchdog();
    return;
  }
  if (run.claimed) return;

  running = true;
  cancelClaimWatchdog();
  try {
    await updateRun((r) => ({ ...r, claimed: true }));
    const ctrl = new AbortController();
    activeCtrl = ctrl;
    await runBatch({ run, signal: ctrl.signal });
    await finalize(ctrl.signal.aborted ? 'cancelled' : 'done');
  } catch (err) {
    log.error('run falló', err);
    await finalize('error', toMessage(err));
  } finally {
    activeCtrl = null;
    running = false;
  }
}

export function abortActiveRun() {
  if (activeCtrl) {
    log.info('abort solicitado (run desactivado en storage)');
    try { activeCtrl.abort(); } catch { /* no-op */ }
  }
  cancelClaimWatchdog();
}

/**
 * Si quedó un run activo y reclamado al (re)cargar la página, el flujo murió por
 * un reload manual (F5). Lo marcamos interrumpido para no dejar un run zombie.
 */
export async function reconcileOnInit() {
  if (window !== window.top) return;
  const run = await getRun();
  if (run && run.active && run.claimed) {
    await appendLog({ level: 'warn', message: 'Run interrumpido: la pestaña se recargó durante el proceso.' });
    await updateRun((r) => ({
      ...r,
      active: false,
      finishedAt: Date.now(),
      finishReason: 'error',
      errorReason: 'Proceso interrumpido por recarga de la página.',
    }));
  }
}

// ---------------------------------------------------------------------------
// batch
// ---------------------------------------------------------------------------

async function runBatch({ run, signal }) {
  const { bodega, stockValue, verifyExistence, dryRun, limit } = run.config;

  await appendLog({ level: 'info', message: `Buscando órdenes On Hold (Fuera de Stock)…${dryRun ? ' [simulación]' : ''}` });

  let orders = await ensureOrdersFiltered({ signal });
  if (limit && limit > 0) orders = orders.slice(0, limit);

  await setItems(orders);
  await appendLog({ level: 'info', message: `${orders.length} orden(es) a procesar` });
  if (orders.length === 0) return;

  for (let i = 0; i < orders.length; i++) {
    if (signal.aborted) break;
    const order = orders[i];
    await setItem(i, { status: STATUS.RUNNING, step: STEPS.OPEN_ORDER });

    try {
      const products = await openOrder(order.orderNumber, { signal });
      await setItem(i, { step: STEPS.CHECK_STOCK, detail: `${products.length} producto(s)` });

      // 1) Chequear stock de cada producto (toast) — mientras estamos en el detalle.
      const needSku = [];
      for (const p of products) {
        if (signal.aborted) break;
        if (!p.skuButton) continue;
        const { stock } = await checkStock(p.skuButton, bodega, { signal });
        const has = stock != null && stock > 0;
        await pushProduct(i, { sku: p.sku, action: has ? 'has-stock' : 'needs-stock', stock });
        if (!has) needSku.push(p.sku);
      }

      // 2) Remediar los SKU sin stock.
      let missing = null;
      for (const sku of needSku) {
        if (signal.aborted) break;
        if (verifyExistence) {
          await setItem(i, { step: STEPS.VERIFY_EXISTS, detail: sku });
          const exists = await verifyExists(sku, { signal });
          if (!exists) {
            missing = sku;
            await pushProduct(i, { sku, action: 'not-found' });
            await appendLog({ level: 'warn', message: `#${order.orderNumber}: SKU ${sku} no existe en Starkoms (crear a mano)` });
            continue;
          }
        }
        await setItem(i, { step: STEPS.EDIT_STOCK, detail: sku });
        const res = await remediateStock(sku, bodega, stockValue, { signal, dryRun });
        if (!res.ok) {
          await pushProduct(i, { sku, action: 'error', reason: res.reason });
          throw new Error(`${sku}: ${res.reason}`);
        }
        await pushProduct(i, { sku, action: dryRun ? 'would-stock' : 'stocked' });
      }

      if (signal.aborted) break;

      // 3) Si algún producto no existe, no se puede destrabar la orden.
      if (missing) {
        await setItem(i, {
          status: STATUS.NOT_FOUND,
          step: STEPS.DONE,
          reason: `Producto ${missing} no existe en Starkoms; crear a mano antes de continuar`,
        });
        await appendLog({ level: 'warn', message: `#${order.orderNumber}: no se cambió el estado (falta producto ${missing})` });
        continue;
      }

      // 4) Cambiar el estado de la orden a "Ingresado".
      await setItem(i, { step: STEPS.CHANGE_STATE });
      const stRes = await setOrderState(order.orderNumber, { signal, dryRun });
      if (!stRes.ok) throw new Error(stRes.reason);

      await setItem(i, { status: STATUS.OK, step: STEPS.DONE });
      await appendLog({
        level: 'info',
        message: `#${order.orderNumber}: OK${dryRun ? ' [simulación]' : ''} (${needSku.length} SKU con stock asignado)`,
      });
    } catch (err) {
      if (isAbortError(err, signal)) {
        await setItem(i, { status: STATUS.SKIPPED, step: 'cancelled' });
        break;
      }
      const reason = err instanceof SelectOptionNotFoundError ? err.message : toMessage(err);
      log.error(`#${order.orderNumber} falló`, err);
      await setItem(i, { status: STATUS.ERROR, step: 'error', reason });
      await appendLog({ level: 'error', message: `#${order.orderNumber}: ${reason}` });
    }
  }
}

// ---------------------------------------------------------------------------
// helpers de estado
// ---------------------------------------------------------------------------

async function setItems(orders) {
  await updateRun((r) => ({
    ...r,
    total: orders.length,
    items: orders.map((o) => ({
      orderNumber: o.orderNumber,
      reference: o.reference,
      status: STATUS.PENDING,
      step: null,
      products: [],
    })),
  }));
}

async function setItem(index, patch) {
  await updateRun((r) => {
    if (!r || !Array.isArray(r.items)) return r;
    const items = r.items.slice();
    items[index] = { ...items[index], ...patch };
    return { ...r, items, currentIndex: index };
  });
}

async function pushProduct(index, product) {
  await updateRun((r) => {
    if (!r || !Array.isArray(r.items)) return r;
    const items = r.items.slice();
    const cur = items[index] || {};
    const products = Array.isArray(cur.products) ? cur.products.slice() : [];
    const existing = products.findIndex((p) => p.sku === product.sku);
    if (existing >= 0) products[existing] = { ...products[existing], ...product };
    else products.push(product);
    items[index] = { ...cur, products };
    return { ...r, items };
  });
}

async function finalize(reason, errorReason) {
  await updateRun((r) => {
    if (!r) return r;
    return {
      ...r,
      active: false,
      finishedAt: r.finishedAt || Date.now(),
      finishReason: r.finishReason || reason,
      errorReason: errorReason || r.errorReason || null,
    };
  });
  const r = await getRun();
  const fr = r?.finishReason || reason;
  await appendLog({ level: fr === 'error' ? 'error' : 'info', message: `Run finalizado (${fr})` });
}

// ---------------------------------------------------------------------------
// claim watchdog (cuando la pestaña activa no es Starkoms)
// ---------------------------------------------------------------------------

function scheduleClaimWatchdog() {
  if (claimWatchdog != null) return;
  claimWatchdog = setTimeout(async () => {
    claimWatchdog = null;
    const r = await getRun();
    if (r && r.active && !r.claimed) {
      await appendLog({
        level: 'error',
        message: 'No es una pestaña de Starkoms (app.starkoms.com). Abrí Starkoms logueado y reintentá.',
      });
      await updateRun((x) => ({
        ...x,
        active: false,
        finishedAt: Date.now(),
        finishReason: 'not-detected',
        errorReason: 'Pestaña Starkoms no detectada.',
      }));
    }
  }, 3000);
}

function cancelClaimWatchdog() {
  if (claimWatchdog != null) {
    clearTimeout(claimWatchdog);
    claimWatchdog = null;
  }
}
