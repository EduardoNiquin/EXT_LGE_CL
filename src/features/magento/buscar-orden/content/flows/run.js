// State machine de "Buscar orden". Cruza navegaciones full-page
// de Magento, asi que el estado vive en storage y cada carga (mas cada
// storage.onChanged) dispara un tick que decide el proximo paso.
//
// LISTING:
//   ├─ Si una orden quedo en READING sin que el detalle la leyera → interrumpida.
//   ├─ Si no hay items → aplicar filtros (fecha + purchase point) y recorrer
//   │  TODAS las paginas del listado armando la cola.
//   └─ Tomar la proxima PENDIENTE, marcarla READING y entrar a su detalle.
//
// ORDER-VIEW:
//   ├─ Casar la URL con la orden en READING, leer sus notas de transaccion y
//   │  evaluarlas contra lo que se busca.
//   └─ Saltar DIRECTO al detalle de la siguiente orden (volver al listado por
//      cada orden duplicaria las navegaciones y con miles de ordenes se nota).

import { isAbortError, toMessage } from '../../../../../shared/errors/index.js';
import { waitForElement } from '../../../../../shared/dom/wait.js';
import { logger } from '../../../../../shared/utils/logger.js';
import {
  FINISH_REASON,
  GATEWAY,
  MAX_DETAIL_REDIRECTS,
  ORDER_STATUS,
  PAGE_TYPE,
  RUN_PHASE,
  SELECTORS,
} from '../../constants.js';
import { buildCriteria, describeCriteria, evaluateOrder } from '../../match.js';
import { appendLog, getRun, setRun } from '../../state.js';
import { detectPage } from '../detector.js';
import { applyPurchaseFilters, collectAllOrders, readRecordsFound } from '../grid.js';
import { parseOrderTransactions, readOrderNumber } from '../parser.js';

const log = logger('magento/buscar-orden');
let running = false;
let activeController = null;

// Se levanta al pedir una navegacion y solo lo baja la carga del documento
// nuevo. Sin esto, la escritura en storage que precede al location.href dispara
// otro tick por storage.onChanged: el navegador todavia no cambio de pagina, ese
// tick ve la orden en READING y la marca como interrumpida.
let navigating = false;

export function abortActiveRun() {
  activeController?.abort();
}

function goTo(url) {
  navigating = true;
  // El admin cuelga onbeforeunload en algunos formularios y un confirm
  // "Changes have been made" dejaria el proceso esperando para siempre.
  try { window.onbeforeunload = null; } catch { /* no-op */ }
  window.location.href = url;
}

export async function tickIfActive() {
  if (running || navigating || window !== window.top) return;
  running = true;
  const controller = new AbortController();
  activeController = controller;

  try {
    const run = await getRun();
    if (!run?.active) return;
    const page = detectPage();

    if (page.type === PAGE_TYPE.LISTING) {
      await onListing(run, page, controller.signal);
    } else if (page.type === PAGE_TYPE.ORDER_VIEW) {
      await onOrderView(run, page, controller.signal);
    } else {
      log.debug('pagina fuera del flujo', { url: page.url });
    }
  } catch (err) {
    if (isAbortError(err, controller.signal)) {
      log.info('busqueda detenida');
    } else {
      log.error('tick fallo', err);
      await stopWithError(toMessage(err));
    }
  } finally {
    if (activeController === controller) activeController = null;
    running = false;
  }
}

// -----------------------------------------------------------------------------
// listado
// -----------------------------------------------------------------------------

async function onListing(initialRun, page, signal) {
  let run = initialRun;

  // La URL real del listado trae el token `key` de Magento; guardarla evita
  // volver a una generica que en algunos ambientes redirige al dashboard.
  if (run.listingUrl !== page.url) {
    run.listingUrl = page.url;
    await setRun(run);
  }

  const interrupted = run.items?.find((item) => item.status === ORDER_STATUS.READING);
  if (interrupted) {
    interrupted.status = ORDER_STATUS.ERROR;
    interrupted.error = 'La navegacion al detalle se interrumpio antes de leer la orden';
    await setRun(run);
    await appendLog({ level: 'error', message: `Orden ${labelOf(interrupted)}: lectura interrumpida` });
    run = await getRun();
    if (!run?.active) return;
  }

  if (!Array.isArray(run.items) || run.items.length === 0) {
    run = await discoverOrders(run, signal);
    if (!run) return;
  }

  await goToNextPending(run);
}

async function discoverOrders(initialRun, signal) {
  let run = initialRun;
  const { from, to } = gridDateRange(run.config);

  run.phase = RUN_PHASE.FILTERING;
  await setRun(run);
  await appendLog({ level: 'info', message: `Aplicando filtros: Purchase Date ${from} a ${to}` });
  await appendLog({ level: 'info', message: describeCriteria(buildCriteria(run.config)) });

  await applyPurchaseFilters({ from, to, signal, onWarn: warnToLog });

  run = await getRun();
  if (!run?.active) return null;
  run.phase = RUN_PHASE.DISCOVERING;
  await setRun(run);

  const total = readRecordsFound();
  if (total != null) {
    await appendLog({ level: 'info', message: `El grid reporta ${total} ordenes en el rango` });
  }

  const limit = Number(run.config?.maxOrders) > 0 ? Number(run.config.maxOrders) : 0;
  const orders = await collectAllOrders({
    signal,
    limit,
    onWarn: warnToLog,
    onPage: (pageNumber, collected) => {
      appendLog({ level: 'debug', message: `Pagina ${pageNumber} leida (${collected} ordenes)` })
        .catch(() => { /* el run pudo cerrarse */ });
    },
  });

  run = await getRun();
  if (!run?.active) return null;

  if (!orders.length) {
    await finalize(run, FINISH_REASON.DONE, 'No se encontraron ordenes en el rango de fechas indicado.');
    return null;
  }

  run.items = orders.map((order) => ({
    ...order,
    status: ORDER_STATUS.PENDING,
    error: '',
    matched: false,
    matchedIndexes: [],
    transactions: [],
  }));
  run.phase = RUN_PHASE.READING;
  run.currentIndex = -1;
  await setRun(run);
  await appendLog({ level: 'info', message: `${orders.length} ordenes por revisar` });
  return getRun();
}

/** Marca la proxima orden pendiente y navega a su detalle. Si no queda, cierra. */
async function goToNextPending(run) {
  const nextIndex = run.items.findIndex((item) => item.status === ORDER_STATUS.PENDING);
  if (nextIndex === -1) {
    await finalize(run, FINISH_REASON.DONE);
    return;
  }

  const item = run.items[nextIndex];
  item.status = ORDER_STATUS.READING;
  item.error = '';
  run.phase = RUN_PHASE.READING;
  run.currentIndex = nextIndex;
  await setRun(run);
  await appendLog({
    level: 'debug',
    message: `Revisando ${labelOf(item)} (${nextIndex + 1}/${run.items.length})`,
  });
  goTo(item.viewHref);
}

// -----------------------------------------------------------------------------
// detalle de la orden
// -----------------------------------------------------------------------------

async function onOrderView(run, page, signal) {
  const index = findActiveOrderIndex(run, page.entityId);
  if (index === -1) {
    // Puede ser una recarga manual del detalle. Volver al listado deja que
    // onListing retome; el tope corta el rebote listado/detalle infinito.
    const redirects = (run.detailRedirects || 0) + 1;
    log.warn('detalle sin orden activa', { entityId: page.entityId, redirects });
    if (redirects >= MAX_DETAIL_REDIRECTS) {
      await stopWithError(`No se pudo asociar el detalle ${page.entityId} con ninguna orden en revision despues de ${redirects} intentos`);
      return;
    }
    run.detailRedirects = redirects;
    await setRun(run);
    goTo(run.listingUrl);
    return;
  }

  try {
    // El tick corre poco despues del load: si el detalle todavia no monto, las
    // notas no existen y la orden se daria por "sin transacciones".
    await waitForElement(SELECTORS.orderInfoTable, {
      signal, timeout: 20000, description: 'detalle de la orden',
    });
    // Las notas sin pasarela son el historial de Magento ("esperando pago", el
    // JSON de estado): no son datos de transaccion, ensucian las columnas del
    // CSV y multiplican por dos lo que hay que guardar en storage.
    const transactions = parseOrderTransactions().filter((tx) => tx.gateway !== GATEWAY.UNKNOWN);
    const criteria = buildCriteria(run.config);
    const { matched, matchedIndexes } = evaluateOrder(transactions, criteria);

    const latest = await getRun();
    if (!latest?.active) return;
    const latestIndex = findActiveOrderIndex(latest, page.entityId);
    if (latestIndex === -1) return;

    const item = latest.items[latestIndex];
    item.transactions = transactions;
    item.matched = matched;
    item.matchedIndexes = matchedIndexes;
    item.status = ORDER_STATUS.OK;
    item.capturedAt = Date.now();
    if (!item.incrementId) item.incrementId = readOrderNumber();
    latest.detailRedirects = 0;
    if (matched) latest.matches = (latest.matches || 0) + 1;
    await setRun(latest);

    if (matched) {
      await appendLog({ level: 'info', message: `COINCIDENCIA en ${labelOf(item)} (${matchedIndexes.length} transaccion(es))` });
    }

    const stopNow = matched && Boolean(latest.config?.stopOnFirstMatch);
    if (stopNow) {
      await appendLog({ level: 'info', message: 'Se detiene en la primera coincidencia: la pestana queda en esa orden' });
    }
    const fresh = await getRun();
    if (!fresh?.active) return;
    if (stopNow) {
      await finalize(fresh, FINISH_REASON.FIRST_MATCH);
      return;
    }
    await continueAfterOrder(fresh);
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    const latest = await getRun();
    if (!latest?.active) return;
    const latestIndex = findActiveOrderIndex(latest, page.entityId);
    if (latestIndex === -1) return;
    const item = latest.items[latestIndex];
    item.status = ORDER_STATUS.ERROR;
    item.error = toMessage(err);
    latest.detailRedirects = 0;
    await setRun(latest);
    await appendLog({ level: 'error', message: `${labelOf(item)}: ${item.error}` });
    await continueAfterOrder(await getRun());
  }
}

/**
 * Desde el detalle se salta DIRECTO al detalle siguiente: volver al listado por
 * cada orden duplica las navegaciones (y con miles de ordenes se nota mucho).
 */
async function continueAfterOrder(run) {
  if (!run?.active) return;

  const processed = run.items.filter((item) =>
    item.status === ORDER_STATUS.OK || item.status === ORDER_STATUS.ERROR).length;
  const max = Number(run.config?.maxOrders) > 0 ? Number(run.config.maxOrders) : 0;
  if (max && processed >= max) {
    await finalize(run, FINISH_REASON.LIMIT);
    return;
  }

  await goToNextPending(run);
}

// -----------------------------------------------------------------------------
// cierre
// -----------------------------------------------------------------------------

async function finalize(run, reason, message) {
  run.active = false;
  run.phase = RUN_PHASE.DONE;
  run.finishedAt = Date.now();
  run.finishReason = reason;
  await setRun(run);

  const items = run.items || [];
  const ok = items.filter((item) => item.status === ORDER_STATUS.OK).length;
  const errors = items.filter((item) => item.status === ORDER_STATUS.ERROR).length;
  const matches = items.filter((item) => item.matched).length;
  await appendLog({
    level: errors ? 'warn' : 'info',
    message: message || `Busqueda terminada: ${matches} coincidencia(s) en ${ok} orden(es) revisada(s), ${errors} con error`,
  });
}

async function stopWithError(message) {
  try {
    const run = await getRun();
    if (!run?.active) return;
    run.active = false;
    run.finishedAt = Date.now();
    run.finishReason = FINISH_REASON.ERROR;
    run.error = message;
    await setRun(run);
    await appendLog({ level: 'error', message: `Busqueda detenida: ${message}` });
  } catch (storageError) {
    log.error('no se pudo guardar el error del run', storageError);
  }
}

function warnToLog(message) {
  log.warn(message);
  appendLog({ level: 'warn', message }).catch(() => { /* el run pudo cerrarse */ });
}

/**
 * Casa el detalle abierto con la orden que se estaba leyendo. Magento pone el
 * entity_id en la URL (no el numero de orden de la columna ID), asi que se
 * compara contra el entity_id que salio del propio link "View".
 */
export function findActiveOrderIndex(run, entityId) {
  const items = run?.items || [];
  const target = String(entityId ?? '');
  const byId = items.findIndex((item) =>
    item.status === ORDER_STATUS.READING && String(item.entityId) === target);
  if (byId !== -1) return byId;

  // Solo puede haber una orden en READING a la vez: si la URL no casa (redirect
  // de Magento, id normalizado, etc.) igual sabemos cual estabamos leyendo.
  const reading = items.reduce(
    (acc, item, index) => (item.status === ORDER_STATUS.READING ? [...acc, index] : acc),
    [],
  );
  if (reading.length !== 1) return -1;
  log.warn('detalle casado por descarte', { entityId: target, item: items[reading[0]]?.entityId });
  return reading[0];
}

/** ISO (yyyy-mm-dd del <input type="date">) → formato del datepicker (m/dd/yyyy). */
export function gridDateRange(config) {
  return { from: toGridDate(config?.from), to: toGridDate(config?.to) };
}

function toGridDate(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const [, year, month, day] = match;
  return `${Number(month)}/${day}/${year}`;
}

function labelOf(item) {
  return `#${item.incrementId || item.entityId || 'sin id'}`;
}
