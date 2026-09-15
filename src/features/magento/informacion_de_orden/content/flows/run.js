// Motor de la captura de ordenes. Dos fases:
//
//   1. DESCUBRIR — el grid dice que ordenes hay en el rango (o resuelve las que
//      pidio el usuario) y, sobre todo, da el ENLACE de cada una, que es lo
//      unico que no se puede deducir: la URL lleva el `entity_id` interno y la
//      key de la sesion.
//   2. CAPTURAR — se entra a la ficha de cada orden y se lee lo que hay ahi.
//      Es el paso que importa: los datos del cliente sin enmascarar, las
//      direcciones completas, los items, los totales y el historial.
//
// Patron storage-driven async continuo (el de pim/starkoms), NO el tick-por-
// reload del resto de Magento: se pide el HTML por fetch y NO se navega, asi que
// el flujo vive entero en un documento y sobrevive al cierre del popup.
//
// Cancelacion: el popup pone active=false -> content/index.js llama
// abortActiveRun() -> el AbortController corta entre peticiones.
//
// Read-only: solo se piden paginas. No se toca ningun boton ni se navega.

import {
  CLAIM_WATCHDOG_MS,
  FINISH_REASON,
  MAX_ORDERS,
  MAX_PAGES,
  ORDER_STATUS,
  ORDER_VIEW_PATH,
  PAGE_SIZE,
  RUN_PHASE,
  SOURCE_MODE,
  clampConcurrency,
  expandSections,
} from '../../constants.js';
import { appendLog, getRun, setResult, updateRun } from '../../state.js';
import { buildRecord, makeMissingRecord } from '../../csv.js';
import { adminBaseFrom, isAdminPage } from '../detector.js';
import { fetchGridPage } from '../client.js';
import { fetchOrderDetail } from '../order-page.js';
import { isAbortError, toMessage } from '../../../../../shared/errors/index.js';
import { logger } from '../../../../../shared/utils/logger.js';
import { resolveGridEndpoint } from '../endpoint.js';
import { stripHtml } from '../../grid-parse.js';

const log = logger('magento/informacion-de-orden');

const FLUSH_INTERVAL_MS = 1500;

let running = false;
let activeCtrl = null;
let claimWatchdog = null;

// ---------------------------------------------------------------------------
// API publica (la usa content/index.js)
// ---------------------------------------------------------------------------

export async function tickIfActive() {
  if (running) return;
  const run = await getRun();
  if (!run || !run.active) return;

  // Solo el frame que esta en el admin trabaja. Si ninguno lo esta, el top
  // agenda un watchdog para reportarlo en vez de dejar el run colgado.
  if (!isAdminPage()) {
    if (window === window.top) scheduleClaimWatchdog();
    return;
  }
  if (run.claimed) return;

  running = true;
  cancelClaimWatchdog();
  const ctrl = new AbortController();
  activeCtrl = ctrl;
  try {
    await updateRun((current) => ({ ...current, claimed: true }));
    await runCapture({ run, signal: ctrl.signal });
    // Cancelar aborta el signal y los workers salen en silencio: sin este
    // chequeo la corrida detenida quedaria marcada como terminada.
    await finalize(ctrl.signal.aborted ? FINISH_REASON.CANCELLED : FINISH_REASON.DONE);
  } catch (err) {
    if (isAbortError(err, ctrl.signal)) {
      log.info('captura detenida');
      await finalize(FINISH_REASON.CANCELLED);
    } else {
      log.error('la captura fallo', err);
      await finalize(FINISH_REASON.ERROR, toMessage(err));
    }
  } finally {
    activeCtrl = null;
    running = false;
  }
}

export function abortActiveRun() {
  if (activeCtrl) {
    log.info('abort solicitado (run desactivado en storage)');
    try {
      activeCtrl.abort();
    } catch {
      /* no-op */
    }
  }
  cancelClaimWatchdog();
}

/**
 * Un reload mata el flujo async y los registros que todavia no se volcaron.
 * Lo capturado hasta el ultimo volcado sigue en storage.
 */
export async function reconcileOnInit() {
  const run = await getRun();
  if (!run?.active || !run.claimed) return;
  log.warn('la captura quedo interrumpida por una recarga');
  await finalize(
    FINISH_REASON.ERROR,
    'La pagina se recargo a mitad de la captura. Se conserva lo que alcanzo a guardarse.',
  );
}

// ---------------------------------------------------------------------------
// Recorrido
// ---------------------------------------------------------------------------

async function runCapture({ run, signal }) {
  const config = run.config || {};
  const sections = expandSections(config.sections);
  const concurrency = clampConcurrency(config.concurrency);

  await patch({ phase: RUN_PHASE.ENDPOINT });
  const { endpoint, via } = await resolveGridEndpoint({ signal });
  await patch({ endpoint });
  await appendLog({ level: 'info', message: `Key del grid resuelta (${via}).` });

  await patch({ phase: RUN_PHASE.DISCOVERING });
  const targets = config.mode === SOURCE_MODE.LIST
    ? await discoverFromList({ config, endpoint, concurrency, signal })
    : await discoverFromRange({ config, endpoint, concurrency, signal });

  if (!targets.length) {
    await appendLog({ level: 'warn', message: 'No hay ordenes que capturar.' });
    return;
  }

  const collector = createCollector({ signal });
  // Las que el grid no devolvio se anotan ya: salen en el CSV marcadas.
  targets.forEach((target, index) => {
    if (target.missing) collector.setSlot(index, makeMissingRecord(target.incrementId, target.missing));
  });

  const pending = targets.filter((target) => !target.missing).length;
  await patch({ phase: RUN_PHASE.FETCHING, total: targets.length });
  await appendLog({
    level: 'info',
    message: `Entrando a ${pending} ficha(s) de orden; ${concurrency} a la vez.`,
  });

  let cursor = 0;
  const queue = { next: () => (signal.aborted || cursor >= targets.length ? -1 : cursor++) };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () => detailWorker({
      queue, targets, collector, sections, signal,
    })),
  );

  await patch({ phase: RUN_PHASE.BUILDING });
  await collector.flush(true);
}

/** Entra a la ficha de una orden y arma su registro. */
async function detailWorker({ queue, targets, collector, sections, signal }) {
  for (let index = queue.next(); index !== -1; index = queue.next()) {
    if (signal.aborted) return;
    const target = targets[index];
    if (target.missing) {
      await bumpProgress({ notFound: 1 });
      continue;
    }
    try {
      const detail = await fetchOrderDetail({ href: target.viewHref, sections, signal });
      collector.setSlot(index, buildRecord({ item: target.item, detail, viewHref: target.viewHref }));
      await bumpProgress({ ok: 1 });
      await collector.flush();
    } catch (err) {
      if (isAbortError(err, signal)) return;
      const reason = toMessage(err);
      // Una ficha caida no tira el recorrido: la orden sale con lo que el grid
      // ya sabia de ella y con el motivo del fallo.
      collector.setSlot(index, makeMissingRecord(target.incrementId, {
        status: ORDER_STATUS.ERROR,
        error: reason,
        item: target.item,
        viewHref: target.viewHref,
      }));
      await bumpProgress({ error: 1 });
      await appendLog({ level: 'error', message: `Orden ${target.incrementId}: ${reason}` });
    }
  }
}

// ---------------------------------------------------------------------------
// Fase 1: de donde salen los enlaces
// ---------------------------------------------------------------------------

/** Modo rango: pagina 1 para saber cuantas hay, el resto del listado en paralelo. */
async function discoverFromRange({ config, endpoint, concurrency, signal }) {
  const query = { from: config.from, to: config.to, pageSize: PAGE_SIZE };
  const first = await fetchGridPage({ endpoint, query: { ...query, page: 1 }, signal });

  const totalRecords = first.totalRecords || 0;
  await patch({ totalRecords });
  if (!totalRecords) return [];

  const pages = Math.min(Math.ceil(totalRecords / PAGE_SIZE), MAX_PAGES);
  await appendLog({ level: 'info', message: `${totalRecords} orden(es) en el rango (${pages} pagina(s) del listado).` });

  const slots = [first.items];
  if (pages > 1) {
    let cursor = 2;
    const queue = { next: () => (signal.aborted || cursor > pages ? -1 : cursor++) };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, pages - 1) }, async () => {
        for (let page = queue.next(); page !== -1; page = queue.next()) {
          if (signal.aborted) return;
          try {
            const data = await fetchGridPage({ endpoint, query: { ...query, page }, signal });
            slots[page - 1] = data.items;
          } catch (err) {
            if (isAbortError(err, signal)) return;
            // Perder una pagina del listado es perder esas ordenes, pero no la
            // corrida: se avisa y se sigue con el resto.
            log.warn('pagina del listado fallida', { page, error: toMessage(err) });
            await appendLog({ level: 'error', message: `Pagina ${page} del listado: ${toMessage(err)}` });
          }
        }
      }),
    );
  }

  const targets = slots.flatMap((items) => (items || []).map(toTarget)).filter(Boolean);
  if (targets.length > MAX_ORDERS) {
    await appendLog({
      level: 'warn',
      message: `Se capturan las primeras ${MAX_ORDERS} ordenes de ${targets.length}.`,
    });
    return targets.slice(0, MAX_ORDERS);
  }
  return targets;
}

/** Modo lista: una consulta por numero de orden, repartidas en el pool. */
async function discoverFromList({ config, endpoint, concurrency, signal }) {
  const numbers = (Array.isArray(config.orderNumbers) ? config.orderNumbers : []).slice(0, MAX_ORDERS);
  await patch({ totalRecords: numbers.length });
  if (!numbers.length) return [];

  const targets = new Array(numbers.length);
  let cursor = 0;
  const queue = { next: () => (signal.aborted || cursor >= numbers.length ? -1 : cursor++) };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, numbers.length) }, async () => {
      for (let index = queue.next(); index !== -1; index = queue.next()) {
        if (signal.aborted) return;
        const incrementId = numbers[index];
        try {
          const data = await fetchGridPage({
            endpoint,
            query: { from: config.from, to: config.to, incrementId, page: 1 },
            signal,
          });
          // El filtro de Magento es "contiene": la fila se casa exacto aca.
          const match = data.items.find((item) => stripHtml(item.increment_id) === String(incrementId));
          targets[index] = match
            ? toTarget(match)
            : { incrementId, missing: { status: ORDER_STATUS.NOT_FOUND } };
          if (!match) {
            await appendLog({ level: 'warn', message: `Orden ${incrementId}: no esta en el rango indicado.` });
          }
        } catch (err) {
          if (isAbortError(err, signal)) return;
          const reason = toMessage(err);
          targets[index] = { incrementId, missing: { status: ORDER_STATUS.ERROR, error: reason } };
          await appendLog({ level: 'error', message: `Orden ${incrementId}: ${reason}` });
        }
      }
    }),
  );

  return targets.filter(Boolean);
}

/**
 * Item del grid -> orden a capturar. El enlace sale de `actions.view.href`, que
 * ya trae la key de la sesion; si faltara se arma con el entity_id y Magento
 * redirige a la URL con key.
 */
function toTarget(item) {
  const incrementId = stripHtml(item?.increment_id);
  const entityId = stripHtml(item?.entity_id);
  if (!incrementId && !entityId) return null;
  const href = item?.actions?.view?.href
    || (entityId ? `${adminBaseFrom() || ''}${ORDER_VIEW_PATH}${entityId}/` : '');
  if (!href) {
    return { incrementId, missing: { status: ORDER_STATUS.ERROR, error: 'La orden no trae enlace a su ficha.' } };
  }
  return { incrementId, entityId, viewHref: href, item };
}

// ---------------------------------------------------------------------------
// Acumulacion de registros
// ---------------------------------------------------------------------------

/**
 * Junta los registros en memoria y los vuelca a storage cada tanto: escribir
 * miles de filas en cada orden seria carisimo, y no volcar nunca perderia todo
 * si el usuario cierra la pestana. Los slots mantienen el orden del listado
 * aunque los workers terminen desordenados.
 */
function createCollector({ signal }) {
  const slots = [];
  let lastFlush = 0;
  let pending = false;

  const flatten = () => slots.filter(Boolean);

  return {
    setSlot(index, record) {
      slots[index] = record;
      pending = true;
    },
    async flush(force = false) {
      if (!pending && !force) return;
      const now = Date.now();
      if (!force && now - lastFlush < FLUSH_INTERVAL_MS) return;
      lastFlush = now;
      pending = false;
      try {
        await setResult({ generatedAt: now, records: flatten() });
      } catch (err) {
        if (isAbortError(err, signal)) throw err;
        log.warn('no se pudo guardar el resultado', { error: toMessage(err) });
        await appendLog({
          level: 'error',
          message: `No se pudo guardar el resultado (${toMessage(err)}). Prueba con menos ordenes por corrida.`,
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

function patch(fields) {
  return updateRun((run) => ({ ...run, ...fields }));
}

function bumpProgress({ ok = 0, notFound = 0, error = 0 }) {
  return updateRun((run) => ({
    ...run,
    doneCount: (run.doneCount || 0) + 1,
    okCount: (run.okCount || 0) + ok,
    notFoundCount: (run.notFoundCount || 0) + notFound,
    errorCount: (run.errorCount || 0) + error,
  }));
}

async function finalize(reason, error = '') {
  const run = await updateRun((current) => ({
    ...current,
    active: false,
    claimed: false,
    phase: RUN_PHASE.DONE,
    finishedAt: Date.now(),
    finishReason: reason,
    error: error || current.error || '',
  }));
  if (!run) return;
  const message = error
    ? `Captura terminada con error: ${error}`
    : `Captura terminada (${run.okCount || 0} ficha(s) leidas).`;
  await appendLog({ level: error ? 'error' : 'info', message });
}

// ---------------------------------------------------------------------------
// Watchdog de reclamo
// ---------------------------------------------------------------------------

function scheduleClaimWatchdog() {
  if (claimWatchdog) return;
  claimWatchdog = setTimeout(async () => {
    claimWatchdog = null;
    const run = await getRun();
    if (!run?.active || run.claimed) return;
    log.warn('ningun frame del admin reclamo la captura');
    await finalize(
      FINISH_REASON.NOT_DETECTED,
      'La pestana no esta en el admin de Magento. Abrela en /obsadm y vuelve a iniciar.',
    );
  }, CLAIM_WATCHDOG_MS);
}

function cancelClaimWatchdog() {
  if (!claimWatchdog) return;
  clearTimeout(claimWatchdog);
  claimWatchdog = null;
}
