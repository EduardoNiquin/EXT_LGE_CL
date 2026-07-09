// Motor de ejecución storage-driven de "Buscar número de órden en caso".
//
// Patrón idéntico a los demás flujos de la feature: el popup escribe el `run`
// (con la lista de órdenes a buscar) y el frame que detecta el listado de casos
// lo reclama (claimed=true) y ejecuta el recorrido como un flujo async continuo.
// La página es una SPA Salesforce: el listado y la paginación se actualizan sin
// recargas, así que el proceso sobrevive al cierre del popup.
//
// CONTROLES (stop != pause):
//   - Detener: el popup pone active=false → index.js llama abortActiveRun() → el
//     AbortController corta el loop (cancelación, no reanudable).
//   - Pausar:  el popup pone paused=true (active sigue true). El runner queda a
//     la espera en waitWhilePaused() entre casos/páginas, sin abortar. Al poner
//     paused=false, continúa donde estaba.

import { SEARCH_FINISH } from '../../constants.js';
import {
  appendSearchLog, getSearchRun, updateSearchRun,
} from '../../state.js';
import {
  getCaseCards, getPagination, isCasesPage, readCardMeta,
} from './detector.js';
import {
  closeCaseModal, ensureFirstPage, goToNextPage, openCaseModal,
  readModalCaseNumber, waitForModalOrders,
} from './dom.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { logger } from '../../../../shared/utils/logger.js';
import { isDevMode } from '../../../../shared/dev-mode/index.js';
import { toMessage, isAbortError } from '../../../../shared/errors/index.js';

const log = logger('seller-center-falabella');

let running = false;
let activeCtrl = null;
let claimWatchdog = null;

// ---------------------------------------------------------------------------
// API pública (usada por content/index.js)
// ---------------------------------------------------------------------------

export async function tickIfActive() {
  if (running) return;
  const run = await getSearchRun();
  if (!run || !run.active) return;

  if (!isCasesPage()) {
    if (window === window.top) scheduleClaimWatchdog();
    return;
  }
  if (run.claimed) return;

  running = true;
  cancelClaimWatchdog();
  try {
    await updateSearchRun((r) => ({ ...r, claimed: true }));
    const ctrl = new AbortController();
    activeCtrl = ctrl;
    const reason = await runSearch({ signal: ctrl.signal });
    await finalize(ctrl.signal.aborted ? SEARCH_FINISH.CANCELLED : (reason || SEARCH_FINISH.EXHAUSTED));
  } catch (err) {
    if (isAbortError(err)) {
      await finalize(SEARCH_FINISH.CANCELLED);
    } else {
      log.error('búsqueda falló', err);
      await finalize(SEARCH_FINISH.ERROR, toMessage(err));
    }
  } finally {
    activeCtrl = null;
    running = false;
  }
}

export function abortActiveRun() {
  if (activeCtrl) {
    log.info('abort de búsqueda solicitado (run desactivado en storage)');
    try { activeCtrl.abort(); } catch { /* no-op */ }
  }
  cancelClaimWatchdog();
}

/** Si quedó un run activo+reclamado al (re)cargar, murió por recarga: lo marcamos. */
export async function reconcileOnInit() {
  if (window !== window.top) return;
  const run = await getSearchRun();
  if (run && run.active && run.claimed) {
    await appendSearchLog({ level: 'warn', message: 'Búsqueda interrumpida: la pestaña se recargó durante el proceso.' });
    await updateSearchRun((r) => ({
      ...r,
      active: false,
      finishedAt: Date.now(),
      finishReason: SEARCH_FINISH.ERROR,
      errorReason: 'Proceso interrumpido por recarga de la página.',
    }));
  }
}

// ---------------------------------------------------------------------------
// recorrido
// ---------------------------------------------------------------------------

async function runSearch({ signal }) {
  const run = await getSearchRun();
  const targets = new Set(run.targets || []);
  if (targets.size === 0) {
    await appendSearchLog({ level: 'warn', message: 'No hay órdenes para buscar.' });
    return SEARCH_FINISH.EXHAUSTED;
  }

  await waitFor(() => isCasesPage(), {
    timeout: 10000,
    description: 'el listado de casos',
    signal,
  });

  if (run.fromFirstPage) {
    await appendSearchLog({ level: 'info', message: 'Volviendo a la página 1…' });
    await ensureFirstPage({ signal }).catch((err) => {
      if (isAbortError(err, signal)) throw err;
      log.warn('no se pudo volver a la página 1', err);
    });
  }

  // Ids de casos ya escaneados (evita reprocesar si la paginación repite cards).
  const scannedIds = new Set();

  while (true) {
    if (signal.aborted) return undefined;
    await waitWhilePaused(signal);
    if (signal.aborted) return undefined;

    const pag = getPagination();
    await syncPageMeta(pag);

    const allFound = await scanCurrentPage({ targets, scannedIds, page: pag?.activePage ?? null, signal });
    if (allFound) return SEARCH_FINISH.ALL_FOUND;

    if (signal.aborted) return undefined;
    await waitWhilePaused(signal);
    if (signal.aborted) return undefined;

    const advanced = await goToNextPage({ signal });
    if (!advanced) return SEARCH_FINISH.EXHAUSTED; // sin más páginas
  }
}

/** Escanea las cards de la página actual. Devuelve true si ya se encontró todo. */
async function scanCurrentPage({ targets, scannedIds, page, signal }) {
  const cardCount = getCaseCards().length;

  for (let i = 0; i < cardCount; i++) {
    if (signal.aborted) return false;
    await waitWhilePaused(signal);
    if (signal.aborted) return false;

    // Re-consultar por índice: abrir/cerrar el modal puede re-renderizar cards.
    const card = getCaseCards()[i];
    if (!card) continue;
    const meta = readCardMeta(card);
    if (!meta.button) continue;
    if (meta.caseId && scannedIds.has(meta.caseId)) continue;

    try {
      const modal = await openCaseModal(meta.button, { signal });
      // Esperar activamente a que la tabla "Órdenes" (lightning-datatable) cargue
      // el número de orden, en vez de un sleep fijo (que cerraba el modal vacío).
      const orders = await waitForModalOrders(modal, { signal });
      const caseNumber = meta.caseNumber || readModalCaseNumber(modal);
      await closeCaseModal({ signal });

      if (meta.caseId) scannedIds.add(meta.caseId);

      const matched = orders.filter((o) => targets.has(o));
      await recordScan({ caseNumber, caseId: meta.caseId, orders, matched, page });

      if (matched.length) {
        await appendSearchLog({
          level: 'info',
          message: `Caso ${caseNumber} → orden ${matched.join(', ')} ✔ (encontrada)`,
        });
      } else if (isDevMode()) {
        await appendSearchLog({
          level: 'debug',
          message: `Caso ${caseNumber} → ${orders.length ? orders.join(', ') : 'sin orden'}`,
        });
      }

      const run = await getSearchRun();
      if (isAllFound(run)) return true;
    } catch (err) {
      if (isAbortError(err, signal)) return false;
      const reason = toMessage(err);
      log.warn(`caso #${i + 1} (pág ${page ?? '?'}) falló`, err);
      await appendSearchLog({ level: 'warn', message: `Caso ${meta.caseNumber || '?'}: ${reason}` });
      // Intentar dejar el modal cerrado para poder continuar con el siguiente.
      await closeCaseModal({ signal }).catch(() => {});
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// helpers de estado
// ---------------------------------------------------------------------------

async function recordScan({ caseNumber, caseId, matched, page }) {
  await updateSearchRun((r) => {
    if (!r) return r;
    const found = { ...(r.found || {}) };
    for (const order of matched) {
      if (!found[order]) found[order] = { caseNumber, caseId, page };
    }
    return { ...r, found, casesScanned: (r.casesScanned || 0) + 1 };
  });
}

async function syncPageMeta(pag) {
  if (!pag) return;
  await updateSearchRun((r) => (r ? { ...r, currentPage: pag.activePage, totalPages: pag.totalPages ?? r.totalPages } : r));
}

function isAllFound(run) {
  if (!run) return false;
  const targets = Array.isArray(run.targets) ? run.targets : [];
  const found = run.found || {};
  return targets.length > 0 && targets.every((t) => found[t]);
}

async function finalize(reason, errorReason) {
  await updateSearchRun((r) => {
    if (!r) return r;
    return {
      ...r,
      active: false,
      paused: false,
      finishedAt: r.finishedAt || Date.now(),
      finishReason: r.finishReason || reason,
      errorReason: errorReason || r.errorReason || null,
    };
  });
  const r = await getSearchRun();
  const fr = r?.finishReason || reason;
  const foundCount = r ? Object.keys(r.found || {}).length : 0;
  const total = r?.targets?.length ?? 0;
  const level = fr === SEARCH_FINISH.ERROR ? 'error' : 'info';
  await appendSearchLog({
    level,
    message: `Búsqueda finalizada (${fr}) — ${foundCount}/${total} orden(es) encontrada(s), ${r?.casesScanned || 0} caso(s) escaneado(s).`,
  });
}

/**
 * Bloquea mientras el run esté en pausa (paused=true). Sale cuando se reanuda,
 * se detiene (active=false) o se aborta. Poll a storage cada 350ms.
 */
async function waitWhilePaused(signal) {
  let announced = false;
  while (!signal.aborted) {
    const r = await getSearchRun();
    if (!r || !r.active) return;   // detenido
    if (!r.paused) return;         // reanudado
    if (!announced) {
      announced = true;
      log.debug('búsqueda en pausa; esperando reanudación…');
    }
    try {
      await sleep(350, signal);
    } catch {
      return; // abortado durante el sleep
    }
  }
}

// ---------------------------------------------------------------------------
// claim watchdog (cuando ningún frame tiene el listado de casos)
// ---------------------------------------------------------------------------

function scheduleClaimWatchdog() {
  if (claimWatchdog != null) return;
  claimWatchdog = setTimeout(async () => {
    claimWatchdog = null;
    const r = await getSearchRun();
    if (r && r.active && !r.claimed) {
      await appendSearchLog({
        level: 'error',
        message: 'No se detectó el listado de casos en la pestaña activa. Abra la página de casos y espere a que cargue antes de Iniciar.',
      });
      await updateSearchRun((x) => ({
        ...x,
        active: false,
        paused: false,
        finishedAt: Date.now(),
        finishReason: SEARCH_FINISH.NOT_DETECTED,
        errorReason: 'Listado de casos no detectado.',
      }));
    }
  }, 3500);
}

function cancelClaimWatchdog() {
  if (claimWatchdog != null) {
    clearTimeout(claimWatchdog);
    claimWatchdog = null;
  }
}
