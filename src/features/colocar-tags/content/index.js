import { MESSAGES } from '../constants.js';
import { diagnose } from './detector.js';
import { parsePage } from './parser.js';
import { logger } from '../../../shared/utils/logger.js';

const log = logger('colocar-tags');

function handleMessage(message, sender, sendResponse) {
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
      sendResponse({
        ok: false,
        reason: `Error al leer la página: ${err.message}`,
        diag,
      });
    }
    return true;
  }

  // Si este frame no detecta la pantalla, damos chance a que otro frame
  // (un iframe que SÍ la tenga) responda primero. El top frame espera más
  // para que iframes ganen la carrera. Si nadie detecta, gana esta respuesta
  // con el diagnóstico para que el popup lo muestre.
  const delay = diag.isTopFrame ? 200 : 80;
  setTimeout(() => {
    try {
      sendResponse({
        ok: false,
        reason: 'No se detectó la pantalla "Marketing Info Mapping" en GP1.',
        diag,
      });
    } catch {
      // canal ya cerrado: otro frame ya respondió, todo bien
    }
  }, delay);
  return true;
}

export function init() {
  log.info('content script inicializado', {
    url: location.href,
    isTopFrame: window === window.top,
  });
  chrome.runtime.onMessage.addListener(handleMessage);
}
