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

// Dueno del run. El content script corre en TODAS las pestanas (`<all_urls>`),
// asi que al cargar cualquier pagina no basta con ver un run reclamado para
// darlo por interrumpido: puede ser de otra pestana que sigue viva (pasaba al
// navegar en otra pestana durante una corrida). El frame que reclama deja un
// token en `sessionStorage` (es por pestana y sobrevive a la recarga) y lo
// mismo en el run; solo un frame que encuentra ESE token es la pestana que se
// recargo. Si la pestana duena se cerro, lo resuelve el latido.
const OWNER_KEY = 'ext-lge-cl:colocar-tags:owner';
const HEARTBEAT_MS = 10_000;
// Holgado a proposito: una pestana en segundo plano estrangula sus timers
// (hasta 1 por minuto), y eso no la vuelve "muerta".
const HEARTBEAT_STALE_MS = 150_000;
// El token solo dice "esta pestana"; GP1 tiene iframes hermanos del mismo
// origen (comparten `sessionStorage`) que cargan durante la corrida. Antes de
// dar el run por muerto se le pregunta al dueno por un BroadcastChannel.
const OWNER_PING_MS = 700;
let ownerChannel = null;

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
  let heartbeat = null;
  try {
    const token = makeOwnerToken();
    await updateRun((r) => (r?.claimed ? r : { ...r, claimed: true, ownerToken: token, heartbeatAt: Date.now() }));
    // El flag `claimed` no es atomico entre pestanas: si otra lo gano, se cede.
    const claimedRun = await getRun();
    if (claimedRun?.ownerToken !== token) {
      log.info('el run lo reclamo otro frame/pestana');
      return;
    }
    writeOwnerToken(token);
    ownerChannel = listenOwnerPings(token);
    heartbeat = setInterval(() => {
      updateRun((r) => (r?.active && r.ownerToken === token ? { ...r, heartbeatAt: Date.now() } : r))
        .catch(() => {});
    }, HEARTBEAT_MS);
    await appendLog({ level: 'info', message: `Procesando ${run.total} SKU(s) — ${KIND_RUNNERS[run.kind]?.label || run.kind}` });

    const ctrl = new AbortController();
    activeCtrl = ctrl;
    await runSkuBatch({ run, signal: ctrl.signal });

    await finalize(ctrl.signal.aborted ? 'cancelled' : 'done');
  } catch (err) {
    log.error('run falló', err);
    await finalize('error', toMessage(err));
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    try { ownerChannel?.close(); } catch { /* no-op */ }
    ownerChannel = null;
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
 * Reconciliacion al cargar la pagina: un run activo y reclamado puede ser de
 * ESTA pestana (que se recargo: el batch de GP1 no sobrevive el reload) o de
 * otra que sigue corriendo. Solo se da por interrumpido si este frame tiene el
 * token del dueno en su `sessionStorage`, o si el latido del dueno esta viejo
 * (la pestana se cerro). Corre en todos los frames: MIM puede vivir en un iframe.
 */
export async function reconcileOnInit() {
  const run = await getRun();
  if (!run || !run.active || !run.claimed) return;
  const mine = !!run.ownerToken && readOwnerToken() === run.ownerToken;
  const stale = Date.now() - (Number(run.heartbeatAt) || Number(run.startedAt) || 0) > HEARTBEAT_STALE_MS;
  if (!mine && !stale) return;
  if (mine && await ownerAlive(run.ownerToken)) return;
  log.warn('run interrumpido', { mine, stale });
  clearOwnerToken();
  await appendLog({
    level: 'warn',
    message: mine
      ? 'Run interrumpido: la pestaña se recargó durante el proceso.'
      : 'Run interrumpido: la pestaña que lo ejecutaba dejó de responder.',
  });
  await updateRun((r) => (r?.active && r.ownerToken === run.ownerToken ? {
    ...r,
    active: false,
    finishedAt: Date.now(),
    finishReason: 'error',
    errorReason: mine ? 'Proceso interrumpido por recarga de la página.' : 'La pestaña del proceso dejó de responder.',
  } : r));
}

function listenOwnerPings(token) {
  try {
    const ch = new BroadcastChannel(OWNER_KEY);
    ch.onmessage = (ev) => {
      if (ev.data?.type === 'ping' && ev.data.token === token) ch.postMessage({ type: 'pong', token });
    };
    return ch;
  } catch {
    return null;
  }
}

function ownerAlive(token) {
  return new Promise((resolve) => {
    let ch;
    try { ch = new BroadcastChannel(OWNER_KEY); } catch { resolve(false); return; }
    const done = (alive) => { clearTimeout(timer); try { ch.close(); } catch { /* no-op */ } resolve(alive); };
    const timer = setTimeout(() => done(false), OWNER_PING_MS);
    ch.onmessage = (ev) => { if (ev.data?.type === 'pong' && ev.data.token === token) done(true); };
    ch.postMessage({ type: 'ping', token });
  });
}

function makeOwnerToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readOwnerToken() {
  try { return sessionStorage.getItem(OWNER_KEY); } catch { return null; }
}

function writeOwnerToken(token) {
  try { sessionStorage.setItem(OWNER_KEY, token); } catch { /* frame sin storage */ }
}

function clearOwnerToken() {
  try { sessionStorage.removeItem(OWNER_KEY); } catch { /* no-op */ }
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

    // Pre-flight: limpiar modal/messageboxes residuales. Tambien en el 1º SKU:
    // una corrida cancelada mientras esperaba el modal lo deja abrirse despues,
    // y la siguiente corrida arrancaba con ese modal ajeno encima.
    {
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
    return { ...r, items, currentIndex: index, heartbeatAt: Date.now() };
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
