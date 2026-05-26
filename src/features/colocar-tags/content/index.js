import { MESSAGES, PORTS, PORT_MSG, STATUS, STEPS } from '../constants.js';
import { diagnose } from './detector.js';
import { parsePage } from './parser.js';
import { searchProductBySku, SkuNotFoundError } from './flows/search-product.js';
import { applyDeliveryTag } from './flows/delivery-tag.js';
import { isMarketingModalOpen } from './gp1/modal.js';
import { logger } from '../../../shared/utils/logger.js';
import { WaitAbortedError } from '../../../shared/dom/wait.js';

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
function handleConnect(port) {
  if (port.name !== PORTS.DELIVERY_RUN) return;
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
      await runDeliveryBatch(msg.config, port, ctrl.signal);
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

async function runDeliveryBatch(config, port, signal) {
  const { skus, tagLabel, beginDay, beginTime, endDay, endTime, skipProd = true, userType = 'ALL' } = config || {};
  if (!Array.isArray(skus) || skus.length === 0) {
    throw new Error('No se recibieron SKUs');
  }

  log.info('run start', { count: skus.length, skipProd, tagLabel });

  for (let i = 0; i < skus.length; i++) {
    if (signal.aborted) break;
    const sku = String(skus[i] ?? '').trim();
    if (!sku) {
      safePost(port, { type: PORT_MSG.PROGRESS, sku, index: i, total: skus.length, status: STATUS.SKIPPED, step: 'empty' });
      continue;
    }
    safePost(port, { type: PORT_MSG.PROGRESS, sku, index: i, total: skus.length, status: STATUS.RUNNING, step: STEPS.SEARCH_TYPE });

    const onStep = (step, detail) => {
      safePost(port, { type: PORT_MSG.PROGRESS, sku, index: i, total: skus.length, status: STATUS.RUNNING, step, detail });
    };

    try {
      await searchProductBySku({ sku, signal, onStep });
      await applyDeliveryTag({
        tagLabel, beginDay, beginTime, endDay, endTime, skipProd, userType, signal, onStep,
      });
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
        // Limpiar el campo de búsqueda para el próximo SKU
        try {
          const input = document.querySelector('input[name="productId"]');
          if (input) { input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })); }
        } catch { /* no-op */ }
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
      // Si el modal quedó abierto por el error, intentar cerrarlo no es trivial
      // (el botón Close es <a> con href="#"). Por ahora seguimos al siguiente
      // SKU: si el modal sigue abierto, el siguiente search-product fallará y
      // el usuario verá el error claro.
      if (isMarketingModalOpen()) {
        log.warn('modal quedó abierto tras error, el siguiente SKU puede fallar');
      }
    }
  }

  if (signal.aborted) {
    safePost(port, { type: PORT_MSG.CANCELLED });
  }
}

function safePost(port, msg) {
  try { port.postMessage(msg); } catch { /* port cerrado */ }
}

export function init() {
  log.info('content script inicializado', { url: location.href, isTopFrame: window === window.top });
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.runtime.onConnect.addListener(handleConnect);
}
