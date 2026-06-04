import { logger } from '../../../shared/utils/logger.js';
import { MESSAGES } from '../constants.js';
import { detectPage, diagnose, isStarkomsHost } from './detector.js';
import { collectFueraDeStock } from './parser.js';
import { abortActiveRun, reconcileOnInit, tickIfActive } from './flows/run.js';
import { subscribeToRun } from '../state.js';

const log = logger('starkoms');

// Lectura de pantalla one-shot (para el popup / debug).
function handleMessage(message, _sender, sendResponse) {
  if (message?.type !== MESSAGES.GET_PAGE_DATA) return false;
  if (window !== window.top || !isStarkomsHost()) return false;

  try {
    const page = detectPage();
    const orders = page.type === 'orders-list' ? collectFueraDeStock() : [];
    sendResponse({ ok: true, page, orders, diag: diagnose() });
  } catch (err) {
    sendResponse({ ok: false, reason: err?.message || String(err), diag: diagnose() });
  }
  return true;
}

export function init() {
  log.info('content script inicializado', { url: location.href, isTopFrame: window === window.top });

  chrome.runtime.onMessage.addListener(handleMessage);

  // Sólo el top frame de Starkoms coordina el run.
  if (window !== window.top) return;

  reconcileOnInit().catch((err) => log.warn('reconcileOnInit falló', err));

  subscribeToRun((run) => {
    if (run && run.active) {
      tickIfActive().catch((err) => log.error('tickIfActive falló', err));
    } else {
      abortActiveRun();
    }
  });

  // Por si ya había un run activo al cargar el frame.
  tickIfActive().catch((err) => log.error('tickIfActive inicial falló', err));
}
