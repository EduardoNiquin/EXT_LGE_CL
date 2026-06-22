// Motor de ejecución storage-driven de "Colocar TAGs".
//
// Reemplaza al antiguo `runSkuBatch` atado a un port. Ahora:
//   - El popup escribe un `run` (RUN_KIND + config + items) en storage.
//   - El content script lo detecta (init + storage.onChanged) y, en el frame
//     que detecta la pantalla MIM, ejecuta el batch publicando progreso y logs
//     en el mismo objeto `run`.
//   - El proceso vive en el content script (sobrevive al cierre del popup).
//   - Cancelación: el popup pone active=false; la subscripción aborta el
//     AbortController y el loop corta entre pasos.
//
// Multi-frame: tickIfActive corre en todos los frames. Sólo el que detecta MIM
// ejecuta (y "reclama" el run con claimed=true). El top frame, si no detecta,
// arma un watchdog: si nadie reclama en unos segundos, finaliza con
// 'not-detected' (equivalente al viejo watchdog del popup).

import { RUN_KIND, STATUS, STEPS } from '../../constants.js';
import {
  appendLog,
  getRun,
  updateRun,
} from '../../state.js';
import { diagnose } from '../detector.js';
import { searchProductBySku, SkuNotFoundError } from './search-product.js';
import { applyDeliveryTag } from './delivery-tag.js';
import { removeDeliveryTag } from './remove-delivery-tag.js';
import { applyProductTags } from './product-tag.js';
import { applyOfferTags } from './offer-tag.js';
import { ComboboxOptionNotFoundError } from '../gp1/combobox.js';
import { isMarketingModalOpen, waitForModalClosed } from '../gp1/modal.js';
import { waitForNoMessagebox, clickMessageboxButton, getTopMessagebox } from '../gp1/messagebox.js';
import { logger } from '../../../../shared/utils/logger.js';
import { sleep } from '../../../../shared/dom/wait.js';
import { clickEl } from '../../../../shared/dom/events.js';
import { toMessage, isAbortError } from '../../../../shared/errors/index.js';

const log = logger('colocar-tags');

const KIND_RUNNERS = {
  [RUN_KIND.DELIVERY]: {
    label: 'Tag de Delivery',
    runPerSku: async ({ config, sku, signal, onStep }) => {
      const { tagLabel, beginDay, beginTime, endDay, endTime, skipProd = true, userType = 'ALL' } = config;
      await searchProductBySku({ sku, signal, onStep });
      await applyDeliveryTag({ tagLabel, beginDay, beginTime, endDay, endTime, skipProd, userType, signal, onStep });
    },
  },
  [RUN_KIND.DELIVERY_REMOVE]: {
    label: 'Quitar Delivery',
    runPerSku: async ({ config, sku, signal, onStep }) => {
      const { skipProd = true } = config;
      await searchProductBySku({ sku, signal, onStep });
      await removeDeliveryTag({ skipProd, signal, onStep });
    },
  },
  [RUN_KIND.PRODUCT]: {
    label: 'Tag de Producto',
    runPerSku: async ({ config, sku, signal, onStep }) => {
      const { tags, skipProd = true, userType = 'ALL' } = config;
      await searchProductBySku({ sku, signal, onStep });
      await applyProductTags({ tags, skipProd, userType, signal, onStep });
    },
  },
  [RUN_KIND.OFFER]: {
    label: 'Tag de Oferta',
    runPerSku: async ({ config, sku, signal, onStep }) => {
      const { offers, skipProd = true } = config;
      await searchProductBySku({ sku, signal, onStep });
      await applyOfferTags({ offers, skipProd, signal, onStep });
    },
  },
};

let running = false;
let activeCtrl = null;
let claimWatchdog = null;

// -----------------------------------------------------------------------------
// API pública (usada por content/index.js)
// -----------------------------------------------------------------------------

/**
 * Punto de entrada idempotente. Llamar en init y en cada storage.onChanged del
 * run. En el frame que detecta MIM arranca el batch; en otros frames es no-op
 * (salvo el watchdog del top frame).
 */
export async function tickIfActive() {
  if (running) return;
  const run = await getRun();
  if (!run || !run.active) return;

  if (!diagnose().detected) {
    if (window === window.top) scheduleClaimWatchdog();
    return;
  }

  // Este frame detecta MIM. Si el run ya fue reclamado (este u otro frame ya
  // arrancó) no re-arrancamos.
  if (run.claimed) return;

  running = true;
  cancelClaimWatchdog();
  try {
    await updateRun((r) => ({ ...r, claimed: true }));
    await appendLog({ level: 'info', message: `Procesando ${run.total} SKU(s) — ${KIND_RUNNERS[run.kind]?.label || run.kind}` });

    const ctrl = new AbortController();
    activeCtrl = ctrl;
    await runSkuBatch({ run, signal: ctrl.signal });

    await finalize(ctrl.signal.aborted ? 'cancelled' : 'done');
  } catch (err) {
    log.error('run falló', err);
    await finalize('error', toMessage(err));
  } finally {
    activeCtrl = null;
    running = false;
  }
}

/** Aborta el run en curso de este frame (lo invoca index.js al ver active=false). */
export function abortActiveRun() {
  if (activeCtrl) {
    log.info('abort solicitado (run desactivado en storage)');
    try { activeCtrl.abort(); } catch { /* no-op */ }
  }
  cancelClaimWatchdog();
}

/**
 * Reconciliación al cargar la página: si quedó un run activo y ya reclamado,
 * significa que el frame que lo ejecutaba se recargó/cerró (el batch de GP1 no
 * sobrevive un reload de la SPA). Lo marcamos interrumpido para no dejar un run
 * "zombie" mostrando "Procesando…" para siempre. Sólo el top frame.
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

// -----------------------------------------------------------------------------
// loop
// -----------------------------------------------------------------------------

async function runSkuBatch({ run, signal }) {
  const runner = KIND_RUNNERS[run.kind];
  if (!runner) throw new Error(`Kind de run desconocido: ${run.kind}`);

  const skus = run.items.map((it) => it.sku);

  for (let i = 0; i < skus.length; i++) {
    if (signal.aborted) break;
    const sku = String(skus[i] ?? '').trim();
    if (!sku) {
      await setItem(i, { status: STATUS.SKIPPED, step: 'empty' });
      continue;
    }

    // Pre-flight a partir del 2º SKU: limpiar modal/messageboxes residuales.
    if (i > 0) {
      const cleaned = await ensureCleanModalState(signal).catch((err) => ({ ok: false, reason: toMessage(err) }));
      if (cleaned && cleaned.ok === false) {
        log.warn(`pre-flight falló para ${sku}`, cleaned);
        await setItem(i, {
          status: STATUS.ERROR,
          step: 'pre-modal-open',
          reason: `Modal o popup del SKU anterior no pudo cerrarse: ${cleaned.reason}`,
        });
        await appendLog({ level: 'error', message: `${sku}: pre-flight falló (${cleaned.reason})` });
        continue;
      }
    }

    await setItem(i, { status: STATUS.RUNNING, step: STEPS.SEARCH_TYPE });

    const onStep = (step, detail) => {
      // fire-and-forget: updateRun está serializado en state.js.
      setItem(i, { status: STATUS.RUNNING, step, detail });
    };

    try {
      await runner.runPerSku({ config: run.config, sku, signal, onStep });
      await setItem(i, { status: STATUS.OK, step: STEPS.DONE });
      await appendLog({ level: 'info', message: `${sku}: OK` });
    } catch (err) {
      if (isAbortError(err, signal)) {
        await setItem(i, { status: STATUS.SKIPPED, step: 'cancelled' });
        break;
      }
      if (err instanceof SkuNotFoundError) {
        log.warn(`SKU ${sku} sin resultados`, err.message);
        await setItem(i, { status: STATUS.SKIPPED, step: 'not-found', reason: err.message });
        await appendLog({ level: 'warn', message: `${sku}: sin resultados` });
        try {
          const input = document.querySelector('input[name="productId"]');
          if (input) { input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })); }
        } catch { /* no-op */ }
        continue;
      }
      if (err instanceof ComboboxOptionNotFoundError) {
        log.warn(`SKU ${sku}: ${err.message}`);
        await setItem(i, { status: STATUS.ERROR, step: 'combo-option-not-found', reason: err.message });
        await appendLog({ level: 'error', message: `${sku}: ${err.message}` });
        continue;
      }
      log.error(`SKU ${sku} falló`, err);
      await setItem(i, { status: STATUS.ERROR, step: 'error', reason: toMessage(err) });
      await appendLog({ level: 'error', message: `${sku}: ${toMessage(err)}` });
      if (isMarketingModalOpen()) {
        log.warn('modal quedó abierto tras error, intentando cerrar ahora');
        await ensureCleanModalState(signal).catch(() => {});
      }
    }
  }
}

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
      // Respetar un finishReason ya fijado por el popup (p.ej. 'cancelled').
      finishReason: r.finishReason || reason,
      errorReason: errorReason || r.errorReason || null,
    };
  });
  const r = await getRun();
  const fr = r?.finishReason || reason;
  await appendLog({ level: fr === 'error' ? 'error' : 'info', message: `Run finalizado (${fr})` });
}

// -----------------------------------------------------------------------------
// claim watchdog (top frame, cuando ningún frame detecta MIM)
// -----------------------------------------------------------------------------

function scheduleClaimWatchdog() {
  if (claimWatchdog != null) return;
  claimWatchdog = setTimeout(async () => {
    claimWatchdog = null;
    const r = await getRun();
    if (r && r.active && !r.claimed) {
      log.warn('ningún frame detectó MIM — finalizando run');
      await appendLog({
        level: 'error',
        message: 'No se detectó la pantalla "Marketing Info Mapping" en esta pestaña. Abra GP1/MIM y reintente.',
      });
      await updateRun((x) => ({
        ...x,
        active: false,
        finishedAt: Date.now(),
        finishReason: 'not-detected',
        errorReason: 'Pantalla MIM no detectada.',
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

// -----------------------------------------------------------------------------
// limpieza de modal/messageboxes (idéntico al comportamiento previo)
// -----------------------------------------------------------------------------

async function ensureCleanModalState(signal) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal.aborted) return { ok: false, reason: 'cancelado' };
    const box = getTopMessagebox();
    if (!box) break;
    let clicked = false;
    for (const label of ['OK', 'YES', 'NO']) {
      try {
        await clickMessageboxButton(label, { timeout: 600, signal });
        clicked = true;
        break;
      } catch { /* intentar siguiente label */ }
    }
    if (!clicked) return { ok: false, reason: 'messagebox no responde a OK/YES/NO' };
    await sleep(150, signal).catch(() => {});
  }
  await waitForNoMessagebox({ signal, timeout: 1500 }).catch(() => {});

  if (isMarketingModalOpen()) {
    const closeBtn = document.querySelector('#dialog2 a.container-close')
      || document.querySelector('a.container-close');
    if (closeBtn) clickEl(closeBtn);
    await waitForModalClosed({ signal, timeout: 2000 }).catch(() => {});
  }
  if (isMarketingModalOpen()) {
    return { ok: false, reason: 'modal no cerró' };
  }
  return { ok: true };
}
