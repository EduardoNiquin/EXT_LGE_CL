import { MESSAGES } from '../constants.js';
import { diagnose } from './detector.js';
import { parsePage } from './parser.js';
import { tickIfActive, abortActiveRun, reconcileOnInit } from './flows/runner.js';
import { subscribeToRun } from '../state.js';
import { logger } from '../../../shared/utils/logger.js';
import { wireAsyncRunLifecycle } from '../../../shared/run-store/index.js';
import { toMessage } from '../../../shared/errors/index.js';

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
      sendResponse({ ok: false, reason: `Error al leer la página: ${toMessage(err)}`, diag });
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

// ---------- ejecución de flujos (storage-driven) ----------
//
// La coordinación del batch vive ahora en `flows/runner.js` y se comunica vía
// chrome.storage.local (ver state.js). Esto hace que el proceso sobreviva al
// cierre del popup: el content script sigue corriendo mientras la pestaña esté
// abierta. Aquí sólo enganchamos los disparadores.

export function init() {
  log.info('content script inicializado', { url: location.href, isTopFrame: window === window.top });

  // Lectura de pantalla (one-shot).
  chrome.runtime.onMessage.addListener(handleMessage);

  // Reconcile + subscribe(active?tick:abort) + tick inicial (ver shared/run-store).
  // Corre en todos los frames: el que detecta MIM reclama el run.
  wireAsyncRunLifecycle({ subscribeToRun, tickIfActive, abortActiveRun, reconcileOnInit, log });
}
