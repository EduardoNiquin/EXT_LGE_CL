import { logger } from '../../../shared/utils/logger.js';
import { MESSAGES, STORAGE_KEYS } from '../constants.js';
import { detectPage, diagnose } from './detector.js';
import { parseOrder } from './parser.js';
import { tickIfActive } from './flows/search.js';

const log = logger('orden-info');

// Mensaje one-shot desde el popup: leer el detalle de la orden de esta pestaña.
function handleMessage(message, _sender, sendResponse) {
  if (message?.type !== MESSAGES.GET_ORDER_DATA) return false;

  const page = detectPage();
  if (page.type !== 'order-view') {
    sendResponse({ ok: false, reason: 'No estás en el detalle de una orden.', diag: { page: page.type, url: page.url } });
    return true;
  }

  try {
    const result = parseOrder();
    if (!result.ok) {
      sendResponse({ ok: false, reason: result.reason, diag: diagnose() });
    } else {
      sendResponse({ ok: true, data: result.data });
    }
  } catch (err) {
    log.error('parseOrder falló', err);
    sendResponse({ ok: false, reason: `Error al leer la orden: ${err?.message || String(err)}` });
  }
  return true;
}

export function init() {
  if (window !== window.top) {
    log.debug('iframe — no se inicializa en este frame');
    return;
  }

  chrome.runtime.onMessage.addListener(handleMessage);

  // Tick inicial: si el popup dejó una búsqueda activa, la retomamos al cargar.
  setTimeout(() => { tickIfActive().catch(() => { /* logged inside */ }); }, 300);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes[STORAGE_KEYS.SEARCH]) return;
    tickIfActive().catch(() => { /* logged inside */ });
  });

  log.info('orden-info init', { url: location.href });
}
