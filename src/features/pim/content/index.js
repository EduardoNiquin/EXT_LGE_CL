import { logger } from '../../../shared/utils/logger.js';
import { MESSAGES } from '../constants.js';
import { diagnose, isPimPage } from './detector.js';
import { abortActiveRun, reconcileOnInit, tickIfActive } from './flows/run.js';
import { subscribeToRun } from '../state.js';
import { wireAsyncRunLifecycle } from '../../../shared/run-store/index.js';
import { toMessage } from '../../../shared/errors/index.js';

const log = logger('pim');

// Lectura de pantalla one-shot (para el popup / debug).
function handleMessage(message, _sender, sendResponse) {
  if (message?.type !== MESSAGES.GET_PAGE_DATA) return false;
  if (window !== window.top || !isPimPage()) return false;

  try {
    sendResponse({ ok: true, diag: diagnose() });
  } catch (err) {
    sendResponse({ ok: false, reason: toMessage(err), diag: diagnose() });
  }
  return true;
}

export function init() {
  log.info('content script inicializado', { url: location.href, isTopFrame: window === window.top });

  chrome.runtime.onMessage.addListener(handleMessage);

  // Sólo el top frame de PIM coordina el run (ver shared/run-store).
  wireAsyncRunLifecycle({ subscribeToRun, tickIfActive, abortActiveRun, reconcileOnInit, topFrameOnly: true, log });
}
