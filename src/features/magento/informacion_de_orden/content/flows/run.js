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
  CLAIM_SETTLE_MS,
  CLAIM_WATCHDOG_MS,
  CSV_MIME,
  DOWNLOAD_FOLDER,
  FINISH_REASON,
  HEARTBEAT_MS,
  HEARTBEAT_STALE_MS,
  LONG_RUN_WARN_ORDERS,
  MAX_ORDERS,
  MAX_PAGES,
  MAX_RANGE_DAYS,
  ORDERS_PER_MINUTE,
  ORDER_STATUS,
  ORDER_VIEW_PATH,
  PAGE_SIZE,
  RESULT_FLUSH_MAX_MS,
  RESULT_FLUSH_MIN_MS,
  RESULT_FLUSH_PER_RECORD_MS,
  RESULT_VERSION,
  RUN_PHASE,
  SOURCE_MODE,
  clampConcurrency,
  clampPartSize,
  expandSections,
  partFileName,
  runStamp,
} from '../../constants.js';
import { addTiming, describeSummary, formatDuration, summarizeRun } from '../../stats.js';
import {
  appendLog,
  getRun,
  resultPartKey,
  setResultIndex,
  updateRun,
  writeResultPart,
} from '../../state.js';
import {
  buildMatrix,
  buildRecord,
  makeMissingRecord,
  matrixToCsv,
  mergeColumns,
  recordColumnKeys,
} from '../../csv.js';
import { adminBaseFrom, isAdminPage } from '../detector.js';
import { fetchGridPage } from '../client.js';
import { fetchOrderDetail } from '../order-page.js';
import { ExtError, isAbortError, toMessage } from '../../../../../shared/errors/index.js';
import { logger } from '../../../../../shared/utils/logger.js';
import { resolveGridEndpoint } from '../endpoint.js';
import { sleep } from '../../../../../shared/dom/wait.js';
import { requestDownload } from '../../../../../shared/downloads/index.js';
import { slimGridItem, stripHtml } from '../../grid-parse.js';
import { splitDateRange } from '../../grid-request.js';

const log = logger('magento/informacion-de-orden');

let running = false;
let activeCtrl = null;
let activeToken = null; // el token con el que ESTE frame reclamo el run
let released = false; // true si otro frame lo reclamo despues y este cedio
let claimWatchdog = null;

// ---------------------------------------------------------------------------
// API publica (la usa content/index.js)
// ---------------------------------------------------------------------------

/**
 * @param {object|null} [latest]  el run tal como llego por storage.onChanged
 *   (ahorra una lectura); sin el se lee de storage.
 */
export async function tickIfActive(latest = null) {
  if (running) {
    // Otro frame pudo reclamar la corrida DESPUES que este (dos pestanas del
    // admin leyendo `claimed:false` a la vez). El que escribio ultimo gana;
    // este suelta en silencio, sin marcar el run como cancelado.
    const current = latest || await getRun();
    if (current?.active && activeToken && current.claimed && current.claimed !== activeToken) {
      log.warn('otro frame reclamo la corrida; este frame la suelta');
      releaseActiveRun();
    }
    return;
  }
  const run = latest || await getRun();
  if (!run || !run.active) return;

  // Solo el frame que esta en el admin trabaja. Si ninguno lo esta, el top
  // agenda un watchdog para reportarlo en vez de dejar el run colgado.
  if (!isAdminPage()) {
    if (window === window.top) scheduleClaimWatchdog();
    return;
  }
  if (run.claimed) return;

  running = true;
  released = false;
  cancelClaimWatchdog();
  const ctrl = new AbortController();
  activeCtrl = ctrl;
  const token = makeClaimToken();
  let heartbeat = null;
  try {
    // Reclamo verificable: se escribe el token, se deja pasar un instante y se
    // relee. Si otro frame escribio el suyo entre medio, gana el y este sale.
    // `activeToken` recien se fija al confirmar: mientras se espera, el token
    // del otro frame llega por storage.onChanged y NO debe hacer soltar (si no,
    // los dos sueltan y el run queda reclamado sin nadie corriendo).
    await updateRun((current) => ({ ...current, claimed: token, heartbeatAt: Date.now() }));
    await sleep(CLAIM_SETTLE_MS, ctrl.signal);
    const check = await getRun();
    if (!check?.active) return;
    if (check.claimed !== token) {
      log.info('la corrida la reclamo otro frame');
      return;
    }
    activeToken = token;
    // Desde que pestana corre: con varias del admin abiertas no hay otra forma
    // de saber cual no hay que cerrar ni navegar.
    await patch({ claimedFrom: location.href });
    await appendLog({ level: 'info', message: `Corriendo desde ${location.href}` });
    // Latido: es lo que le dice a un content script recien arrancado (otra
    // pestana, o esta recargada) que la corrida sigue viva en algun lado.
    heartbeat = setInterval(() => {
      patch({ heartbeatAt: Date.now() }).catch(() => { /* logueado en storage */ });
    }, HEARTBEAT_MS);
    await runCapture({ run, signal: ctrl.signal });
    if (released) return;
    // Cancelar aborta el signal y los workers salen en silencio: sin este
    // chequeo la corrida detenida quedaria marcada como terminada.
    await finalize(ctrl.signal.aborted ? FINISH_REASON.CANCELLED : FINISH_REASON.DONE);
  } catch (err) {
    if (released) {
      log.info('corrida cedida a otro frame');
    } else if (isAbortError(err, ctrl.signal)) {
      log.info('captura detenida');
      await finalize(FINISH_REASON.CANCELLED);
    } else {
      log.error('la captura fallo', err);
      await finalize(FINISH_REASON.ERROR, toMessage(err));
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    activeCtrl = null;
    activeToken = null;
    running = false;
  }
}

function makeClaimToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Suelta la corrida porque la reclamo otro frame: aborta sin finalizar. */
function releaseActiveRun() {
  released = true;
  try {
    activeCtrl?.abort();
  } catch {
    /* no-op */
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
 *
 * Pero un content script que arranca no sabe si el run reclamado es de ESTA
 * pestana (que se recargo) o de otra que sigue viva: lo decide el latido. Si
 * esta fresco, se vuelve a mirar cuando ya deberia haberse renovado; recien
 * si sigue viejo se da por interrumpido.
 */
export async function reconcileOnInit() {
  const run = await getRun();
  if (!run?.active || !run.claimed) return;
  if (heartbeatStale(run)) {
    await finalizeInterrupted();
    return;
  }
  setTimeout(async () => {
    try {
      const again = await getRun();
      if (again?.active && again.claimed && heartbeatStale(again)) await finalizeInterrupted();
    } catch (err) {
      log.warn('no se pudo revisar el latido de la corrida', { error: toMessage(err) });
    }
  }, HEARTBEAT_STALE_MS);
}

function heartbeatStale(run) {
  return Date.now() - (Number(run.heartbeatAt) || 0) > HEARTBEAT_STALE_MS;
}

async function finalizeInterrupted() {
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

  const collector = createCollector({
    signal,
    partSize: clampPartSize(config.partSize),
    // Copia de respaldo: cada parte que se cierra se baja como CSV. En una
    // corrida de horas es lo que hace que lo capturado no dependa de que la
    // pestana siga viva hasta el final.
    autoDownload: !!config.autoDownload,
    allColumns: !!config.allColumns,
    stamp: runStamp(run.startedAt),
  });
  // Las que el grid no devolvio se anotan ya: salen en el CSV marcadas.
  targets.forEach((target, index) => {
    if (target.missing) collector.setSlot(index, makeMissingRecord(target.incrementId, target.missing));
  });

  const pending = targets.filter((target) => !target.missing).length;
  // `fetchStartedAt` es desde donde se mide el ritmo: el descubrimiento no
  // cuenta, que son otras peticiones y otro costo.
  await patch({ phase: RUN_PHASE.FETCHING, total: targets.length, fetchStartedAt: Date.now() });
  await appendLog({
    level: 'info',
    message: `Entrando a ${pending} ficha(s) de orden; ${concurrency} a la vez.`,
  });

  await runPool(targets.length, concurrency, (index) => captureTarget({
    target: targets[index], index, collector, sections, signal,
  }), signal);

  await patch({ phase: RUN_PHASE.BUILDING });
  await collector.flush(true);
  const written = collector.describe();
  await patch({ parts: written.parts, savedRecords: written.total });
  await appendLog({
    level: 'info',
    message: `${written.total} fila(s) en ${written.parts} archivo(s) CSV de hasta ${written.partSize}.`,
  });
  if (config.autoDownload && written.downloaded) {
    await appendLog({
      level: 'info',
      message: `${written.downloaded} archivo(s) ya guardados en Descargas/${DOWNLOAD_FOLDER}/${written.stamp}/.`,
    });
  }
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
    await bumpProgress({ ok: 1, timing: detail.timing });
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
    await collector.flush();
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
    // Recortadas ya: sin tope de ordenes, el descubrimiento puede juntar decenas
    // de miles de filas en memoria antes de entrar a la primera ficha.
    block.pages[0] = data.items.map(slimGridItem);
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
    // Freno de emergencia, no un tope de uso: 200.000 fichas es un filtro que
    // devolvio cualquier cosa, no un rango que alguien quiso exportar.
    await appendLog({
      level: 'warn',
      message: `Son ${totalRecords} ordenes, mas que el freno de ${MAX_ORDERS}: se capturan las primeras ${MAX_ORDERS}.`,
    });
  } else if (totalRecords >= LONG_RUN_WARN_ORDERS) {
    await appendLog({
      level: 'warn',
      message: `${totalRecords} ordenes a ~${ORDERS_PER_MINUTE} fichas/min: unas ${formatDuration((totalRecords / ORDERS_PER_MINUTE) * 60000)}. No cierres ni navegues esta pestana hasta que termine.`,
    });
  }

  await runPool(rest.length, concurrency, async (index) => {
    const { block, page } = rest[index];
    try {
      const data = await fetchGridPage({ endpoint, query: queryOf(block, page), signal });
      block.pages[page - 1] = data.items.map(slimGridItem);
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
        ? toTarget(slimGridItem(match))
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
 * Junta los registros y los vuelca a storage POR PARTES de `partSize` ordenes,
 * una clave por parte. Cada parte es tambien un archivo CSV.
 *
 * Por que en partes: un volcado reescribe entero lo que abarca (chrome.storage
 * no sabe de "agregar"), asi que con todo el resultado en una sola clave el
 * costo crece con la corrida y un rango amplio termina cayendo por memoria --al
 * serializar, y despues en el popup al leerlo y matrizarlo--. Con partes el
 * volcado cuesta siempre lo mismo (como maximo `partSize` registros) y la parte
 * que se completa se escribe una ultima vez y SE SUELTA de memoria.
 *
 * Los slots mantienen el orden del listado aunque los workers terminen
 * desordenados: `pending` esta indexado por el numero de orden dentro de la
 * corrida, y la parte abierta es la ventana [partStart, partStart+partSize).
 * Como el pool reparte los indices en orden, cuando la ventana esta completa ya
 * no puede llegarle nada mas y se puede cerrar.
 *
 * La union de columnas se acumula aca (no al exportar): todas las partes tienen
 * que salir con el mismo encabezado para poder unirse en un solo archivo.
 *
 * Con `autoDownload`, cada parte que se cierra se baja tambien como CSV (via el
 * service worker: un content script no ve `chrome.downloads`).
 */
function createCollector({ signal, partSize, autoDownload = false, allColumns = false, stamp = '' }) {
  const pending = new Map(); // indice global -> registro todavia en memoria
  const closed = []; // partes ya completas y escritas, en orden
  let columns = [];
  let partStart = 0; // indice global con el que empieza la parte abierta
  let snapshot = { parts: [], total: 0 };
  let lastFlush = 0;
  let dirty = false;
  let openStored = 0; // registros de la parte abierta ya escritos
  let queue = Promise.resolve(); // los volcados van de a uno (ver flush)
  const downloaded = new Set(); // partes ya intentadas (una sola vez cada una)
  let saved = 0; // y de esas, las que quedaron escritas en disco

  /** Los registros de la parte abierta, en el orden del listado. */
  function openRecords() {
    const records = [];
    for (let index = partStart; index < partStart + partSize; index += 1) {
      const record = pending.get(index);
      if (record) records.push(record);
    }
    return records;
  }

  /** La ventana abierta ya tiene todos sus registros: nada mas puede caer ahi. */
  function isComplete() {
    for (let index = partStart; index < partStart + partSize; index += 1) {
      if (!pending.has(index)) return false;
    }
    return true;
  }

  function describePart(records) {
    const index = closed.length;
    return {
      index,
      key: resultPartKey(index),
      count: records.length,
      first: records[0]?.incrementId || '',
      last: records[records.length - 1]?.incrementId || '',
    };
  }

  const totalOf = (parts) => parts.reduce((sum, part) => sum + part.count, 0);

  /**
   * Baja la parte que se acaba de cerrar, si se pidio la copia de respaldo. Una
   * descarga fallida NO corta la corrida: los registros siguen en storage y se
   * pueden bajar al final.
   *
   * El archivo sale con las columnas conocidas al cerrar ESA parte: si una orden
   * posterior trae una columna nueva, los archivos ya bajados no la tienen. El
   * "Descargar todo unido" del final si sale homogeneo, porque ahi la union ya
   * es la de toda la corrida.
   */
  async function autoDownloadPart(part, records) {
    if (!autoDownload || !records.length || downloaded.has(part.index)) return;
    downloaded.add(part.index);
    const filename = partFileName(stamp, part.index);
    try {
      const text = matrixToCsv(buildMatrix(records, { allColumns, columns }));
      const result = await requestDownload({ filename, text, mime: CSV_MIME });
      if (result.ok) saved += 1;
      await appendLog(result.ok
        ? { level: 'info', message: `Archivo guardado: ${filename} (${records.length} fila(s)).` }
        : {
          level: 'error',
          message: `No se pudo guardar ${filename}: ${result.error}. Los datos siguen en la extension.`,
        });
    } catch (err) {
      log.warn('no se pudo bajar la parte', { filename, error: toMessage(err) });
      await appendLog({
        level: 'error',
        message: `No se pudo guardar ${filename}: ${toMessage(err)}. Los datos siguen en la extension.`,
      });
    }
  }

  async function writeOpenPart(force) {
    const complete = isComplete();
    if (!dirty && !force && !complete) return;
    const now = Date.now();
    // Una parte completa se cierra en cuanto lo esta: es lo que libera su
    // memoria, asi que no espera el intervalo.
    if (!force && !complete && now - lastFlush < flushIntervalFor(openStored)) return;
    lastFlush = now;
    dirty = false;

    const records = openRecords();
    const part = describePart(records);
    const parts = records.length ? [...closed, part] : [...closed];
    try {
      if (records.length) await writeResultPart(part.index, records);
      await setResultIndex({
        version: RESULT_VERSION,
        generatedAt: now,
        partSize,
        columns,
        parts,
        total: totalOf(parts),
      });
      snapshot = { parts, total: totalOf(parts) };
      openStored = records.length;
      // Se baja cuando la parte queda cerrada: completa, o al terminar la
      // corrida (`force`), que es cuando se cierra la ultima a medio llenar.
      if (complete || force) await autoDownloadPart(part, records);
      if (complete) {
        closed.push(part);
        for (let index = partStart; index < partStart + partSize; index += 1) pending.delete(index);
        partStart += partSize;
        openStored = 0;
      }
    } catch (err) {
      if (isAbortError(err, signal)) throw err;
      dirty = true; // que el proximo volcado lo reintente
      log.warn('no se pudo guardar el resultado', { error: toMessage(err) });
      await appendLog({
        level: 'error',
        message: `No se pudo guardar el resultado (${toMessage(err)}). Prueba con menos ordenes por archivo.`,
      });
    }
  }

  return {
    setSlot(index, record) {
      pending.set(index, record);
      columns = mergeColumns(columns, recordColumnKeys(record));
      dirty = true;
    },
    /** Lo que quedo escrito, para el registro de la corrida. */
    describe() {
      return {
        parts: snapshot.parts.length,
        total: snapshot.total,
        partSize,
        stamp,
        downloaded: saved,
      };
    },
    /**
     * Los volcados van de a UNO: cada carril llama a flush al terminar su ficha,
     * y dos volcados simultaneos veian la MISMA ventana abierta (con `partStart`
     * todavia sin avanzar), asi que la escribian dos veces y cada uno la anotaba
     * como una parte nueva. El que espera vuelve a mirar el estado, que para
     * entonces ya puede estar volcado.
     */
    flush(force = false) {
      const task = queue.catch(() => {}).then(() => writeOpenPart(force));
      queue = task.catch(() => {}); // la cola no arrastra el error; el llamador si lo ve
      return task;
    },
  };
}

/**
 * Cada cuanto volcar la parte abierta, segun cuantos registros ya tiene escritos:
 * reescribirla cuesta proporcional a su tamano. El tope lo pone `partSize`, asi
 * que el intervalo no se dispara como cuando el resultado era una sola clave.
 */
export function flushIntervalFor(records) {
  const scaled = RESULT_FLUSH_MIN_MS + Math.max(0, records) * RESULT_FLUSH_PER_RECORD_MS;
  return Math.min(RESULT_FLUSH_MAX_MS, scaled);
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

function patch(fields) {
  return updateRun((run) => ({ ...run, ...fields }));
}

function bumpProgress({ ok = 0, notFound = 0, error = 0, timing = null }) {
  return updateRun((run) => ({
    ...run,
    doneCount: (run.doneCount || 0) + 1,
    okCount: (run.okCount || 0) + ok,
    notFoundCount: (run.notFoundCount || 0) + notFound,
    errorCount: (run.errorCount || 0) + error,
    stats: timing ? addTiming(run.stats, timing) : run.stats,
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

  // Donde se fue el tiempo, para que la proxima corrida no se configure a ciegas.
  const summary = summarizeRun(run);
  if (summary) {
    await appendLog({
      level: 'info',
      message: `${summary.done} ficha(s) en ${formatDuration(summary.elapsedMs)}: ${describeSummary(summary)}.`,
    });
  }
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
