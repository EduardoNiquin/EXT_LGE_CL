import { toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';
import { wireReloadTickLifecycle } from '../../../../shared/run-store/index.js';
import { MESSAGES, STORAGE_KEYS } from '../constants.js';
import { fetchAllRules } from './catalog-fetch.js';
import { adminBaseFrom } from './detector.js';
import { abortActiveRun, claimHere, tickIfActive } from './flows/run.js';

const log = logger('magento/editar-shipping-rules');

// One-shot desde el popup. Solo contesta el top frame de una pestana del admin.
function handleMessage(message, _sender, sendResponse) {
  if (message?.type === MESSAGES.LOAD_CATALOG) {
    if (!adminBaseFrom()) {
      sendResponse({ ok: false, reason: 'La pestana activa no es el admin de Magento.' });
      return true;
    }
    fetchAllRules()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => {
        log.error('no se pudo leer el catalogo de rules', err);
        sendResponse({ ok: false, reason: toMessage(err) });
      });
    return true;
  }

  if (message?.type === MESSAGES.CLAIM) {
    const ok = claimHere(message.runId);
    sendResponse({ ok, url: location.href });
    if (ok) tickIfActive().catch(() => { /* logueado adentro */ });
    return true;
  }
  return false;
}

export function init() {
  if (window !== window.top) return;
  chrome.runtime.onMessage.addListener(handleMessage);
  wireReloadTickLifecycle({
    runKey: STORAGE_KEYS.RUN,
    tickIfActive,
    abortActiveRun,
    // Los lectores esperan sus propios componentes (bridge); arrancar enseguida
    // solo gasta reintentos mientras Magento arma el formulario.
    delay: 500,
    log,
  });
}
