// Motor de ejecución storage-driven de "SoporteSeller — Detalle Orden".
//
// Patrón idéntico a starkoms/run.js: el popup escribe el `run` (con la cola de
// "Detalle Orden" ya armada desde el CSV); el frame que detecta el formulario lo
// reclama (claimed=true) y ejecuta TODO el batch como un único flujo async
// continuo. El sitio es una SPA Salesforce: el acordeón se llena sin recargas,
// así que el flujo sobrevive al cierre del popup. Progreso/logs en el mismo `run`.
//
// Cancelación: el popup pone active=false → index.js llama abortActiveRun() →
// el AbortController corta el loop entre pasos.
//
// IMPORTANTE: la extensión sólo COMPLETA los "Detalle Orden". No envía ni guarda
// nada en el sitio: el usuario revisa y guarda manualmente.

import { STATUS, STEPS } from '../../constants.js';
import { appendLog, getRun, updateRun } from '../../state.js';
import { getDetalleSections, isSupportSellerPage } from '../detector.js';
import { ensureSection, expandSection, fillSection } from './accordion.js';
import { WaitAbortedError, waitFor } from '../../../../shared/dom/wait.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('seller-center-falabella');

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

  // Sólo el frame que tiene el formulario actúa. Si ningún frame lo tiene, el
  // top agenda un watchdog para reportar "pestaña no detectada".
  if (!isSupportSellerPage()) {
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
    await finalize('error', err?.message || String(err));
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
  await appendLog({ level: 'info', message: `Completando ${items.length} "Detalle Orden"…` });
  if (items.length === 0) return;

  // Esperar a que el acordeón esté presente (el usuario ya debería verlo).
  await waitFor(() => getDetalleSections().length > 0, {
    timeout: 10000,
    description: 'el formulario "Detalle Orden"',
    signal,
  });

  for (let i = 0; i < items.length; i++) {
    if (signal.aborted) break;
    const item = items[i];

    try {
      await setItem(i, { status: STATUS.RUNNING, step: STEPS.ENSURE_SECTION });
      const section = await ensureSection(i, { signal });
      if (signal.aborted) break;

      await setItem(i, { step: STEPS.EXPAND });
      await expandSection(section, { signal });

      await setItem(i, { step: STEPS.FILL });
      await fillSection(section, item, { signal });

      await setItem(i, { status: STATUS.OK, step: STEPS.DONE });
      await appendLog({
        level: 'info',
        message: `Detalle ${i + 1}/${items.length}: orden ${item.ordernumber} · guía ${item.guia} · ${item.cantP} paq.`,
      });
    } catch (err) {
      if (err instanceof WaitAbortedError || signal.aborted) {
        await setItem(i, { status: STATUS.SKIPPED, step: 'cancelled' });
        break;
      }
      const reason = err?.message || String(err);
      log.error(`Detalle ${i + 1} falló`, err);
      await setItem(i, { status: STATUS.ERROR, step: 'error', reason });
      await appendLog({ level: 'error', message: `Detalle ${i + 1} (orden ${item.ordernumber}): ${reason}` });
      // Si no pudimos crear/expandir una sección, las siguientes también fallarán:
      // cortamos para no dejar el form a medias y que el usuario revise.
      break;
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
// claim watchdog (cuando ningún frame tiene el formulario)
// ---------------------------------------------------------------------------

function scheduleClaimWatchdog() {
  if (claimWatchdog != null) return;
  claimWatchdog = setTimeout(async () => {
    claimWatchdog = null;
    const r = await getRun();
    if (r && r.active && !r.claimed) {
      await appendLog({
        level: 'error',
        message: 'No se detectó el formulario "Detalle Orden" en la pestaña activa. Abrí la página de Soporte y esperá a que aparezca antes de Iniciar.',
      });
      await updateRun((x) => ({
        ...x,
        active: false,
        finishedAt: Date.now(),
        finishReason: 'not-detected',
        errorReason: 'Formulario "Detalle Orden" no detectado.',
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
