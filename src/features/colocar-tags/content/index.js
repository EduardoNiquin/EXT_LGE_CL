import { MESSAGES, PORTS, PORT_MSG, STATUS, STEPS } from '../constants.js';
import { diagnose } from './detector.js';
import { parsePage } from './parser.js';
import { searchProductBySku, SkuNotFoundError } from './flows/search-product.js';
import { applyDeliveryTag } from './flows/delivery-tag.js';
import { applyProductTags } from './flows/product-tag.js';
import { ComboboxOptionNotFoundError } from './gp1/combobox.js';
import { isMarketingModalOpen, waitForModalClosed } from './gp1/modal.js';
import { waitForNoMessagebox, clickMessageboxButton, getTopMessagebox } from './gp1/messagebox.js';
import { logger } from '../../../shared/utils/logger.js';
import { WaitAbortedError, sleep } from '../../../shared/dom/wait.js';

const log = logger('colocar-tags');

// ---------- mensajes one-shot (lectura de pantalla) ----------
function handleMessage(message, _sender, sendResponse) {
  if (message?.type !== MESSAGES.GET_PAGE_DATA) return false;

  const diag = diagnose();
  log.info('get-page-data recibido', { url: diag.url, isTopFrame: diag.isTopFrame, missing: diag.missing });

  if (diag.detected) {
    try {
      const data = parsePage();
      log.info('parsePage OK', { rows: data?.grid?.rows?.length });
      sendResponse({ ok: true, data, frame: { isTopFrame: diag.isTopFrame, url: diag.url } });
    } catch (err) {
      log.error('parsePage falló', err);
      sendResponse({ ok: false, reason: `Error al leer la página: ${err.message}`, diag });
    }
    return true;
  }

  // Frame no detecta: damos chance a otro frame (iframe con MIM).
  const delay = diag.isTopFrame ? 200 : 80;
  setTimeout(() => {
    try {
      sendResponse({
        ok: false,
        reason: 'No se detectó la pantalla "Marketing Info Mapping" en GP1.',
        diag,
      });
    } catch {
      /* canal ya cerrado por otro frame */
    }
  }, delay);
  return true;
}

// ---------- puertos long-lived (flow streaming) ----------

/**
 * Despacho de ports. Cada port name implementa el mismo protocolo
 * (START / PROGRESS / DONE / CANCEL / CANCELLED / ERROR), pero la acción
 * por SKU difiere. La función `runner` recibe ({ sku, config, signal, onStep })
 * y debe lanzar para reportar error.
 */
const PORT_RUNNERS = {
  [PORTS.DELIVERY_RUN]: {
    label: 'delivery',
    runPerSku: async ({ config, sku, signal, onStep }) => {
      const { tagLabel, beginDay, beginTime, endDay, endTime, skipProd = true, userType = 'ALL' } = config;
      await searchProductBySku({ sku, signal, onStep });
      await applyDeliveryTag({
        tagLabel, beginDay, beginTime, endDay, endTime, skipProd, userType, signal, onStep,
      });
    },
  },
  [PORTS.PRODUCT_RUN]: {
    label: 'product',
    runPerSku: async ({ config, sku, signal, onStep }) => {
      const { tags, skipProd = true, userType = 'ALL' } = config;
      await searchProductBySku({ sku, signal, onStep });
      await applyProductTags({ tags, skipProd, userType, signal, onStep });
    },
  },
};

function handleConnect(port) {
  const runner = PORT_RUNNERS[port.name];
  if (!runner) return;
  log.info('port conectado', { name: port.name });

  // Sólo el frame que detecta la pantalla acepta el run. Si nuestro frame no
  // tiene MIM, ignoramos: otro frame (iframe) ya estará escuchando también.
  if (!diagnose().detected) {
    log.debug('port ignorado (este frame no detecta MIM)', { url: location.href });
    return;
  }

  const ctrl = new AbortController();
  let active = false;

  port.onDisconnect.addListener(() => {
    if (active) {
      log.warn('port desconectado durante run — abortando');
      ctrl.abort();
    }
  });

  port.onMessage.addListener(async (msg) => {
    if (msg?.type === PORT_MSG.CANCEL) {
      log.info('CANCEL recibido');
      ctrl.abort();
      return;
    }
    if (msg?.type !== PORT_MSG.START) return;
    if (active) {
      safePost(port, { type: PORT_MSG.ERROR, reason: 'Ya hay un run activo en este frame' });
      return;
    }
    active = true;
    try {
      await runSkuBatch({ config: msg.config, port, signal: ctrl.signal, runner });
    } catch (err) {
      log.error('run falló', err);
      safePost(port, { type: PORT_MSG.ERROR, reason: err?.message || String(err) });
    } finally {
      active = false;
      safePost(port, { type: PORT_MSG.DONE });
      try { port.disconnect(); } catch { /* ya cerrado */ }
    }
  });
}

/**
 * Loop genérico sobre SKUs. Reporta PROGRESS por cada cambio de estado,
 * captura SkuNotFoundError como SKIPPED y WaitAbortedError como cancelación.
 */
async function runSkuBatch({ config, port, signal, runner }) {
  const skus = Array.isArray(config?.skus) ? config.skus : null;
  if (!skus || skus.length === 0) throw new Error('No se recibieron SKUs');

  log.info(`run start [${runner.label}]`, { count: skus.length });

  for (let i = 0; i < skus.length; i++) {
    if (signal.aborted) break;
    const sku = String(skus[i] ?? '').trim();
    if (!sku) {
      safePost(port, { type: PORT_MSG.PROGRESS, sku, index: i, total: skus.length, status: STATUS.SKIPPED, step: 'empty' });
      continue;
    }

    // Pre-flight: si el SKU anterior dejó algún modal o messagebox abierto,
    // intentamos limpiar antes de empezar. Si no se puede, abortamos el SKU
    // con un error claro en vez de cascadear timeouts oscuros.
    const cleaned = await ensureCleanModalState(signal).catch((err) => ({ ok: false, reason: err?.message || String(err) }));
    if (cleaned && cleaned.ok === false) {
      safePost(port, {
        type: PORT_MSG.PROGRESS,
        sku,
        index: i,
        total: skus.length,
        status: STATUS.ERROR,
        step: 'pre-modal-open',
        reason: `Modal o popup del SKU anterior no pudo cerrarse: ${cleaned.reason}`,
      });
      continue;
    }

    safePost(port, { type: PORT_MSG.PROGRESS, sku, index: i, total: skus.length, status: STATUS.RUNNING, step: STEPS.SEARCH_TYPE });

    const onStep = (step, detail) => {
      safePost(port, { type: PORT_MSG.PROGRESS, sku, index: i, total: skus.length, status: STATUS.RUNNING, step, detail });
    };

    try {
      await runner.runPerSku({ config, sku, signal, onStep });
      safePost(port, { type: PORT_MSG.PROGRESS, sku, index: i, total: skus.length, status: STATUS.OK, step: STEPS.DONE });
    } catch (err) {
      if (err instanceof WaitAbortedError || signal.aborted) {
        safePost(port, { type: PORT_MSG.PROGRESS, sku, index: i, total: skus.length, status: STATUS.SKIPPED, step: 'cancelled' });
        break;
      }
      if (err instanceof SkuNotFoundError) {
        log.warn(`SKU ${sku} sin resultados`, err.message);
        safePost(port, {
          type: PORT_MSG.PROGRESS,
          sku,
          index: i,
          total: skus.length,
          status: STATUS.SKIPPED,
          step: 'not-found',
          reason: err.message,
        });
        // Limpiar el campo de búsqueda para el próximo SKU.
        try {
          const input = document.querySelector('input[name="productId"]');
          if (input) { input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })); }
        } catch { /* no-op */ }
        continue;
      }
      if (err instanceof ComboboxOptionNotFoundError) {
        // El usuario tipeó un tag/group que no existe en GP1 para este producto.
        // No es un bug del extension — es input incorrecto o tag no aplicable.
        // Reportamos como ERROR con el detalle (la muestra de opciones la lleva
        // err.availableSample, ya formateada en err.message).
        log.warn(`SKU ${sku}: ${err.message}`);
        safePost(port, {
          type: PORT_MSG.PROGRESS,
          sku,
          index: i,
          total: skus.length,
          status: STATUS.ERROR,
          step: 'combo-option-not-found',
          reason: err.message,
        });
        // El modal quedó abierto en un estado inconsistente. El pre-flight
        // del siguiente SKU se encarga de limpiar.
        continue;
      }
      log.error(`SKU ${sku} falló`, err);
      safePost(port, {
        type: PORT_MSG.PROGRESS,
        sku,
        index: i,
        total: skus.length,
        status: STATUS.ERROR,
        step: 'error',
        reason: err?.message || String(err),
      });
      if (isMarketingModalOpen()) {
        log.warn('modal quedó abierto tras error, intentaré cerrarlo antes del próximo SKU');
      }
    }
  }

  if (signal.aborted) {
    safePost(port, { type: PORT_MSG.CANCELLED });
  }
}

/**
 * Intenta dejar el DOM en un estado limpio para el próximo SKU:
 * sin messageboxes abiertos y sin el modal #dialog2 visible.
 *
 * Estrategia:
 *  1. Si hay messageboxes (típicamente confirmaciones a medio cerrar tras un
 *     error), se intenta clickear OK / YES / NO en ese orden hasta que no
 *     queden.
 *  2. Si el modal sigue abierto, se intenta su botón "Close" (link en el
 *     header). Si tampoco cierra, se devuelve fallo.
 *  3. Si todo cerró, ok=true.
 *
 * Devuelve `{ ok: boolean, reason?: string }`. Nunca lanza (los `await` están
 * envueltos en `.catch`).
 */
async function ensureCleanModalState(signal) {
  // 1) Drenar messageboxes residuales.
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
      } catch { /* no había botón con ese label, intentar siguiente */ }
    }
    if (!clicked) return { ok: false, reason: 'messagebox no responde a OK/YES/NO' };
    await sleep(150, signal).catch(() => {});
  }
  await waitForNoMessagebox({ signal, timeout: 1500 }).catch(() => {});

  // 2) Si el modal sigue abierto, intentar cerrarlo por su botón Close.
  if (isMarketingModalOpen()) {
    const closeBtn = document.querySelector('a.container-close');
    if (closeBtn) closeBtn.click();
    await waitForModalClosed({ signal, timeout: 2000 }).catch(() => {});
  }
  if (isMarketingModalOpen()) {
    return { ok: false, reason: 'modal no cerró' };
  }
  return { ok: true };
}

function safePost(port, msg) {
  try { port.postMessage(msg); } catch { /* port cerrado */ }
}

export function init() {
  log.info('content script inicializado', { url: location.href, isTopFrame: window === window.top });
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.runtime.onConnect.addListener(handleConnect);
}
