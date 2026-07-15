import { logger } from '../../../shared/utils/logger.js';
import { MESSAGES } from '../constants.js';
import { diagnose, isSupportSellerPage } from './detector.js';
import { parseSections } from './parser.js';
import { abortActiveRun, reconcileOnInit, tickIfActive } from './flows/run.js';
import {
  abortActiveRun as abortSearch,
  reconcileOnInit as reconcileSearch,
  tickIfActive as tickSearch,
} from './case-search/run.js';
import { subscribeToRun, subscribeToSearchRun } from '../state.js';
import { initPairing } from '../devoluciones/content.js';
import { wireAsyncRunLifecycle } from '../../../shared/run-store/index.js';
import { toMessage } from '../../../shared/errors/index.js';

const log = logger('seller-center-falabella');

// Lectura de pantalla one-shot (para el popup / debug). Responde el frame que
// tiene el formulario; si ninguno lo tiene, sólo responde el top.
function handleMessage(message, _sender, sendResponse) {
  if (message?.type !== MESSAGES.GET_PAGE_DATA) return false;

  const detected = isSupportSellerPage();
  if (!detected && window !== window.top) return false; // deja responder a otro frame

  try {
    sendResponse({ ok: true, detected, sections: parseSections(), diag: diagnose() });
  } catch (err) {
    sendResponse({ ok: false, reason: toMessage(err), diag: diagnose() });
  }
  return true;
}

export function init() {
  log.info('content script inicializado', { url: location.href, isTopFrame: window === window.top });

  chrome.runtime.onMessage.addListener(handleMessage);

  // Flujo "Detalle Orden": reconcile + subscribe(active?tick:abort) + tick inicial.
  wireAsyncRunLifecycle({ subscribeToRun, tickIfActive, abortActiveRun, reconcileOnInit, log });

  // Flujo "Buscar número de órden en caso": mismo ciclo de vida, run independiente.
  wireAsyncRunLifecycle({
    subscribeToRun: subscribeToSearchRun,
    tickIfActive: tickSearch,
    abortActiveRun: abortSearch,
    reconcileOnInit: reconcileSearch,
    log,
  });

  // Devoluciones: lee el token de emparejamiento de la web y lo persiste.
  initPairing();
}
