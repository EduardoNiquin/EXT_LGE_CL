// Motor de ejecución storage-driven de "Creación de producto" (PIM).
//
// Patrón idéntico a starkoms/seller-center: el popup escribe el `run` (con la
// lista de SKU); el frame que detecta el buscador lo reclama (claimed=true) y
// verifica cada SKU como un único flujo async continuo. La grilla busca sin
// recargar la página, así que el flujo sobrevive al cierre del popup.
//
// Cancelación: el popup pone active=false → index.js llama abortActiveRun() →
// el AbortController corta el loop entre pasos.
//
// Read-only: sólo se usa el buscador (SKU + SEARCH) en STG. No se toca PROD ni
// ningún botón de guardado.

import { SELECTORS, STATUS, STEPS } from '../../constants.js';
import { appendLog, getRun, updateRun } from '../../state.js';
import { isPimPage } from '../detector.js';
import { searchSku } from './search.js';
import { waitFor } from '../../../../shared/dom/wait.js';
import { logger } from '../../../../shared/utils/logger.js';
import { toMessage, isAbortError } from '../../../../shared/errors/index.js';

const log = logger('pim');

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

  // Sólo el frame que tiene el buscador actúa. Si ninguno lo tiene, el top
  // agenda un watchdog para reportar "pantalla no detectada".
  if (!isPimPage()) {
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
 * una recarga. Lo marcamos interrumpido para no dejar un run zombie.
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
  const items = Array.isArray(run.items) ? run.items : [];
  await appendLog({ level: 'info', message: `Verificando ${items.length} SKU en PIM (STG)…` });
  if (items.length === 0) return;

  // Esperar a que el buscador esté presente.
  await waitFor(() => document.querySelector(SELECTORS.searchBtn), {
    timeout: 10000,
    description: 'el buscador de PIM',
    signal,
  });

  for (let i = 0; i < items.length; i++) {
    if (signal.aborted) break;
    const item = items[i];

    try {
      await setItem(i, { status: STATUS.RUNNING, step: STEPS.SELECT_STG });
      const found = await searchSku(item.sku, {
        signal,
        onStep: (step) => { setItem(i, { step }); },
      });
      if (signal.aborted) break;

      await setItem(i, { status: STATUS.OK, step: STEPS.DONE, found });
      await appendLog({
        level: 'info',
        message: `SKU ${i + 1}/${items.length}: ${item.sku} → ${found ? 'existe (YES)' : 'no existe (NO)'}`,
      });
    } catch (err) {
      if (isAbortError(err, signal)) break;
      const reason = toMessage(err);
      log.error(`SKU ${i + 1} falló`, err);
      await setItem(i, { status: STATUS.ERROR, step: 'error', reason });
      await appendLog({ level: 'error', message: `SKU ${i + 1} (${item.sku}): ${reason}` });
      // Cada SKU es independiente: se continúa con el siguiente.
    }
  }
}

// ---------------------------------------------------------------------------
// helpers de estado
// ---------------------------------------------------------------------------

async function setItem(index, patch) {
  await updateRun((r) => {
    if (!r || !Array.isArray(r.items)) return r;
    const items = r.items.slice();
    items[index] = { ...items[index], ...patch };
    return { ...r, items, currentIndex: index };
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
// claim watchdog (cuando ningún frame tiene el buscador)
// ---------------------------------------------------------------------------

function scheduleClaimWatchdog() {
  if (claimWatchdog != null) return;
  claimWatchdog = setTimeout(async () => {
    claimWatchdog = null;
    const r = await getRun();
    if (r && r.active && !r.claimed) {
      await appendLog({
        level: 'error',
        message: 'No se detectó la pantalla de PIM en la pestaña activa. Abra el buscador por SKU y espere a que cargue antes de Iniciar.',
      });
      await updateRun((x) => ({
        ...x,
        active: false,
        finishedAt: Date.now(),
        finishReason: 'not-detected',
        errorReason: 'Pantalla de PIM no detectada.',
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
