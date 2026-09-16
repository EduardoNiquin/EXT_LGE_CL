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
  MAX_RANGE_DAYS,
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
import { ExtError, isAbortError, toMessage } from '../../../../../shared/errors/index.js';
import { logger } from '../../../../../shared/utils/logger.js';
import { resolveGridEndpoint } from '../endpoint.js';
import { stripHtml } from '../../grid-parse.js';
import { splitDateRange } from '../../grid-request.js';

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
  // Magento corta el filtro en 1 mes: un rango mas largo se pide en varias
  // ventanas y se junta aca. Es la unica forma de cubrir, por ejemplo, 100 dias.
  const dateRanges = splitDateRange(config.from, config.to);
  if (!dateRanges.length) throw new ExtError('El rango de fechas no es valido.', { code: 'IO_INVALID_RANGE' });

  await patch({ phase: RUN_PHASE.ENDPOINT });
  const { endpoint, via } = await resolveGridEndpoint({ signal });
  await patch({ endpoint });
  await appendLog({ level: 'info', message: `Key del grid resuelta (${via}).` });

  await patch({ phase: RUN_PHASE.DISCOVERING });
  if (dateRanges.length > 1) {
    await appendLog({
      level: 'info',
      message: `El rango se consultara en ${dateRanges.length} bloques de hasta ${MAX_RANGE_DAYS + 1} dias.`,
    });
  }
  const targets = config.mode === SOURCE_MODE.LIST
    ? await discoverFromList({ config, dateRanges, endpoint, concurrency, signal })
    : await discoverFromRanges({ dateRanges, endpoint, concurrency, signal });

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

  await runPool(targets.length, concurrency, (index) => captureTarget({
    target: targets[index], index, collector, sections, signal,
  }), signal);

  await patch({ phase: RUN_PHASE.BUILDING });
  await collector.flush(true);
}

/**
 * Entra a la ficha de una orden y arma su registro. No lanza: una ficha caida
 * sale marcada con su motivo y el recorrido sigue.
 */
async function captureTarget({ target, index, collector, sections, signal }) {
  if (signal.aborted) return;
  if (target.missing) {
    await bumpProgress({ notFound: 1 });
    return;
  }
  try {
    const detail = await fetchOrderDetail({ href: target.viewHref, sections, signal });
    collector.setSlot(index, buildRecord({ item: target.item, detail, viewHref: target.viewHref }));
    await bumpProgress({ ok: 1 });
    await collector.flush();
  } catch (err) {
    if (isAbortError(err, signal)) return;
    const reason = toMessage(err);
    // La orden sale con lo que el grid ya sabia de ella y con el motivo del fallo.
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

/**
 * Reparte `total` tareas entre `concurrency` carriles, tomandolas en orden. El
 * paralelismo no tiene tope propio: lo fija el usuario en el popup.
 *
 * Si un worker lanza, se deja de repartir y el error sube. Lo aprovechan las
 * fases donde un fallo es sistemico (sesion caducada, filtros rechazados); las
 * que toleran perder una pieza atrapan su propio error adentro del worker.
 */
async function runPool(total, concurrency, worker, signal) {
  if (total <= 0) return;
  const lanes = Math.max(1, Math.min(concurrency, total));
  let cursor = 0;
  let failure = null;

  await Promise.all(Array.from({ length: lanes }, async () => {
    while (!signal.aborted && !failure && cursor < total) {
      const index = cursor;
      cursor += 1;
      try {
        await worker(index);
      } catch (err) {
        if (isAbortError(err, signal)) return;
        failure = failure || err;
        return;
      }
    }
  }));

  if (failure) throw failure;
}

// ---------------------------------------------------------------------------
// Fase 1: de donde salen los enlaces
// ---------------------------------------------------------------------------

/**
 * Modo rango, en dos pasadas contra el mismo pool:
 *   1. la pagina 1 de CADA bloque: trae sus primeras ordenes y, sobre todo,
 *      cuantas hay, que es lo que decide cuantas paginas faltan;
 *   2. las paginas que faltan de todos los bloques juntas, asi un rango de un
 *      año no se pide bloque por bloque en fila india.
 */
async function discoverFromRanges({ dateRanges, endpoint, concurrency, signal }) {
  const multi = dateRanges.length > 1;
  const blocks = dateRanges.map((range) => ({ range, pages: [], totalRecords: 0 }));
  const queryOf = (block, page) => ({ from: block.range.from, to: block.range.to, page, pageSize: PAGE_SIZE });

  // Que falle la pagina 1 no es "ese bloque no trajo nada": es la sesion caida o
  // los filtros rechazados. El error sube y corta la corrida.
  await runPool(blocks.length, concurrency, async (index) => {
    const block = blocks[index];
    const data = await fetchGridPage({ endpoint, query: queryOf(block, 1), signal });
    block.totalRecords = data.totalRecords || 0;
    block.pages[0] = data.items;
    if (multi) {
      await appendLog({
        level: 'info',
        message: `Bloque ${index + 1}/${blocks.length} (${block.range.from} a ${block.range.to}): ${block.totalRecords} orden(es).`,
      });
    }
  }, signal);
  if (signal.aborted) return [];

  const totalRecords = blocks.reduce((sum, block) => sum + block.totalRecords, 0);
  await patch({ totalRecords });
  if (!totalRecords) return [];

  const rest = pendingPages(blocks);
  await appendLog({
    level: 'info',
    message: `${totalRecords} orden(es) en el rango (${blocks.length + rest.length} pagina(s) del listado).`,
  });
  if (totalRecords > MAX_ORDERS) {
    await appendLog({
      level: 'warn',
      message: `Se capturan las primeras ${MAX_ORDERS} ordenes de ${totalRecords}.`,
    });
  }

  await runPool(rest.length, concurrency, async (index) => {
    const { block, page } = rest[index];
    try {
      const data = await fetchGridPage({ endpoint, query: queryOf(block, page), signal });
      block.pages[page - 1] = data.items;
    } catch (err) {
      if (isAbortError(err, signal)) return;
      // Perder una pagina del listado es perder esas ordenes, pero no la
      // corrida: se avisa y se sigue con el resto.
      const where = multi ? ` (${block.range.from} a ${block.range.to})` : '';
      log.warn('pagina del listado fallida', { page, range: block.range, error: toMessage(err) });
      await appendLog({ level: 'error', message: `Pagina ${page} del listado${where}: ${toMessage(err)}` });
    }
  }, signal);

  return collectTargets(blocks);
}

/**
 * Las paginas 2..N de cada bloque, ya recortadas al tope de la corrida: pedir
 * paginas cuyas ordenes se van a descartar es gastar peticiones de gusto.
 */
function pendingPages(blocks) {
  const rest = [];
  let budget = MAX_ORDERS;
  for (const block of blocks) {
    const take = Math.min(block.totalRecords, Math.max(budget, 0));
    budget -= take;
    const pages = Math.min(Math.ceil(take / PAGE_SIZE), MAX_PAGES);
    for (let page = 2; page <= pages; page += 1) rest.push({ block, page });
  }
  return rest;
}

/** Items del grid -> ordenes a capturar, en orden de bloque y pagina, sin repetidas. */
function collectTargets(blocks) {
  const targets = [];
  const seen = new Set();
  for (const block of blocks) {
    for (const items of block.pages) {
      for (const item of items || []) {
        const target = toTarget(item);
        if (!target) continue;
        // Los bloques no se superponen, pero el listado se reordena si entran
        // ordenes mientras se pagina: sin esto la misma orden saldria dos veces.
        const key = target.entityId || target.incrementId;
        if (key) {
          if (seen.has(key)) continue;
          seen.add(key);
        }
        targets.push(target);
        if (targets.length >= MAX_ORDERS) return targets;
      }
    }
  }
  return targets;
}

/** Modo lista: la orden se busca bloque por bloque hasta dar con ella. */
export async function findOrderInRanges({ dateRanges, endpoint, incrementId, signal }) {
  for (const range of dateRanges) {
    if (signal?.aborted) return null;
    const data = await fetchGridPage({
      endpoint,
      query: { ...range, incrementId, page: 1 },
      signal,
    });
    // El filtro `increment_id` de Magento es "contiene": la fila se casa exacto
    // aca, o una orden que solo comparte prefijo pasaria por la buscada.
    const match = data.items.find((item) => stripHtml(item.increment_id) === String(incrementId));
    if (match) return match;
  }
  return null;
}

/** Modo lista: una busqueda por numero de orden, repartidas en el pool. */
async function discoverFromList({ config, dateRanges, endpoint, concurrency, signal }) {
  const numbers = (Array.isArray(config.orderNumbers) ? config.orderNumbers : []).slice(0, MAX_ORDERS);
  await patch({ totalRecords: numbers.length });
  if (!numbers.length) return [];

  const targets = new Array(numbers.length);
  await runPool(numbers.length, concurrency, async (index) => {
    const incrementId = numbers[index];
    try {
      const match = await findOrderInRanges({ endpoint, dateRanges, incrementId, signal });
      targets[index] = match
        ? toTarget(match)
        : { incrementId, missing: { status: ORDER_STATUS.NOT_FOUND } };
      if (!match && !signal.aborted) {
        await appendLog({ level: 'warn', message: `Orden ${incrementId}: no esta en el rango indicado.` });
      }
    } catch (err) {
      if (isAbortError(err, signal)) return;
      const reason = toMessage(err);
      targets[index] = { incrementId, missing: { status: ORDER_STATUS.ERROR, error: reason } };
      await appendLog({ level: 'error', message: `Orden ${incrementId}: ${reason}` });
    }
  }, signal);

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
    return { incrementId, entityId, missing: { status: ORDER_STATUS.ERROR, error: 'La orden no trae enlace a su ficha.' } };
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
