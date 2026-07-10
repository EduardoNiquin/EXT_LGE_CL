import { logger } from '../../../shared/utils/logger.js';
import { MESSAGES } from '../constants.js';
import { diagnose, isSolotodoReportPage } from './detector.js';
import { parseForm } from './parser.js';
import { abortActiveRun, reconcileOnInit, tickIfActive } from './flows/run.js';
import { subscribeToRun } from '../state.js';
import { wireAsyncRunLifecycle } from '../../../shared/run-store/index.js';
import { toMessage } from '../../../shared/errors/index.js';

const log = logger('solotodo');

// Lectura de pantalla one-shot (para el popup / debug). Responde el frame que
// tiene el formulario; si ninguno lo tiene, sólo responde el top.
function handleMessage(message, _sender, sendResponse) {
  if (message?.type !== MESSAGES.GET_PAGE_DATA) return false;

  const detected = isSolotodoReportPage();
  if (!detected && window !== window.top) return false; // deja responder a otro frame

  try {
    sendResponse({ ok: true, detected, form: parseForm(), diag: diagnose() });
  } catch (err) {
    sendResponse({ ok: false, reason: toMessage(err), diag: diagnose() });
  }
  return true;
}

export function init() {
  log.info('content script inicializado', { url: location.href, isTopFrame: window === window.top });

  chrome.runtime.onMessage.addListener(handleMessage);

  // Storage-driven async: reconcile + subscribe(active?tick:abort) + tick inicial.
  wireAsyncRunLifecycle({ subscribeToRun, tickIfActive, abortActiveRun, reconcileOnInit, log });
}
