// Motor de ejecución storage-driven de "SoloTodo".
//
// Patrón idéntico a starkoms/seller-center: el popup escribe el `run` (con la
// config de la categoría y la lista de pasos); el frame que detecta el formulario
// lo reclama (claimed=true) y ejecuta los pasos como un único flujo async
// continuo. El backoffice es una SPA React (MUI): el form se llena sin recargas,
// así que el flujo sobrevive al cierre del popup. Progreso/logs en el mismo `run`.
//
// Cancelación: el popup pone active=false → index.js llama abortActiveRun() →
// el AbortController corta el loop entre pasos.

import { CLAIM_WATCHDOG_MS, FINISH_REASON, STATUS, STEP } from '../../constants.js';
import { appendLog, getRun, updateRun } from '../../state.js';
import { isSolotodoReportPage } from '../detector.js';
import { clickGenerar, fillFilename, openExportForm, selectMultiple, selectSingle } from './fill.js';
import { waitFor } from '../../../../shared/dom/wait.js';
import { logger } from '../../../../shared/utils/logger.js';
import { isAbortError, toMessage } from '../../../../shared/errors/index.js';

const log = logger('solotodo');

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

  if (!isSolotodoReportPage()) {
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
    await runSteps({ run, signal: ctrl.signal });
    await finalize(ctrl.signal.aborted ? FINISH_REASON.CANCELLED : FINISH_REASON.DONE);
  } catch (err) {
    log.error('run falló', err);
    await finalize(FINISH_REASON.ERROR, toMessage(err));
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

/** Marca interrumpido un run reclamado si la página se recargó a mitad. */
export async function reconcileOnInit() {
  if (window !== window.top) return;
  const run = await getRun();
  if (run && run.active && run.claimed) {
    await appendLog({ level: 'warn', message: 'Run interrumpido: la pestaña se recargó durante el proceso.' });
    await updateRun((r) => ({
      ...r,
      active: false,
      finishedAt: Date.now(),
      finishReason: FINISH_REASON.ERROR,
      errorReason: 'Proceso interrumpido por recarga de la página.',
    }));
  }
}

// ---------------------------------------------------------------------------
// pasos
// ---------------------------------------------------------------------------

async function runSteps({ run, signal }) {
  const config = run.config || {};
  const items = Array.isArray(run.items) ? run.items : [];
  await appendLog({ level: 'info', message: `Llenando el formulario de "${config.categoryLabel}"…` });

  // Esperar a que el formulario esté presente.
  await waitFor(() => isSolotodoReportPage(), {
    timeout: 10000,
    description: 'el formulario de export de SoloTodo',
    signal,
  });

  for (let i = 0; i < items.length; i++) {
    if (signal.aborted) break;
    const item = items[i];

    try {
      await setItem(i, { status: STATUS.RUNNING });
      await runStep(item.key, config, { signal, index: i });
      await setItem(i, { status: STATUS.OK });
    } catch (err) {
      if (isAbortError(err, signal)) {
        await setItem(i, { status: STATUS.SKIPPED });
        break;
      }
      const reason = toMessage(err);
      log.error(`Paso "${item.key}" falló`, err);
      await setItem(i, { status: STATUS.ERROR, reason });
      await appendLog({ level: 'error', message: `${item.label}: ${reason}` });
      // Un paso caído deja el form a medias; cortamos para que el usuario revise.
      break;
    }
  }
}

async function runStep(key, config, { signal, index }) {
  switch (key) {
    case STEP.EXPORT:
      await openExportForm({ signal });
      await appendLog({ level: 'info', message: 'Formulario de exportación abierto.' });
      break;
    case STEP.CATEGORIA:
      await selectSingle('Categoría', config.category, { signal });
      await appendLog({ level: 'info', message: `Categoría: "${config.category}"` });
      break;
    case STEP.MONEDA:
      await selectSingle('Moneda', config.currency, { signal });
      await appendLog({ level: 'info', message: `Moneda: "${config.currency}"` });
      break;
    case STEP.TIENDAS:
      await selectMultiple('Tiendas', config.stores, {
        signal,
        onProgress: (done, total, name) => {
          setItem(index, { detail: `${done}/${total}` }).catch(() => {});
          if (done === 1 || done === total || done % 10 === 0) {
            appendLog({ level: 'info', message: `Tiendas ${done}/${total} (última: ${name})` }).catch(() => {});
          }
        },
      });
      await appendLog({ level: 'info', message: `Tiendas: ${config.stores.length} seleccionadas` });
      break;
    case STEP.PAISES:
      await selectMultiple('Países', config.countries, {
        signal,
        onProgress: (done, total) => { setItem(index, { detail: `${done}/${total}` }).catch(() => {}); },
      });
      await appendLog({ level: 'info', message: `Países: ${config.countries.join(', ')}` });
      break;
    case STEP.FILENAME:
      await fillFilename(config.filename, { signal });
      await appendLog({ level: 'info', message: `Nombre de archivo: "${config.filename}"` });
      break;
    case STEP.GENERAR:
      if (config.dryRun) {
        await appendLog({ level: 'warn', message: 'Modo simulación: NO se clickeó "Generar".' });
        return;
      }
      await clickGenerar({ signal });
      await appendLog({ level: 'info', message: 'Botón "Generar" presionado. El reporte se enviará por correo.' });
      break;
    default:
      throw new Error(`Paso desconocido: ${key}`);
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
  await appendLog({ level: fr === FINISH_REASON.ERROR ? 'error' : 'info', message: `Run finalizado (${fr})` });
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
        message: 'No se detectó el formulario de SoloTodo en la pestaña activa. Abra el backoffice de reportes y espere a que aparezca antes de Iniciar.',
      });
      await updateRun((x) => ({
        ...x,
        active: false,
        finishedAt: Date.now(),
        finishReason: FINISH_REASON.NOT_DETECTED,
        errorReason: 'Formulario de SoloTodo no detectado.',
      }));
    }
  }, CLAIM_WATCHDOG_MS);
}

function cancelClaimWatchdog() {
  if (claimWatchdog != null) {
    clearTimeout(claimWatchdog);
    claimWatchdog = null;
  }
}
