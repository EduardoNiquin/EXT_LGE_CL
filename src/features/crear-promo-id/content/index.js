// Content de "Crear Promo-Id". Solo el frame que tiene Promotion Management
// responde: GP1 la carga en un iframe de main.lg (o suelta, si se abre la URL
// directa). Los demas frames no contestan, y si ninguno lo hace el popup recibe
// el error de "sin respuesta" y lo traduce a "abre/recarga la pantalla".

import { BRIDGE, CATEGORY_MODE, MESSAGES } from '../constants.js';
import { resolveSkus } from '../resolve.js';
import { createTrace } from '../trace.js';
import { askBridge } from './bridge-client.js';
import { getCatalog } from './catalog.js';
import { diagnose, isPromotionPage, isPromotionUrl } from './detector.js';
import { isRunning, reconcileOnInit, startRun } from './flows/run.js';
import { waitFor } from '../../../shared/dom/wait.js';
import { toMessage } from '../../../shared/errors/index.js';

const trace = createTrace('content');

const TYPES = new Set(Object.values(MESSAGES));

function handleMessage(message, _sender, sendResponse) {
  const type = message?.type;
  if (!TYPES.has(type)) return false;
  if (!isPromotionPage()) {
    trace.debug(`${type} ignorado: este frame no tiene la pantalla lista`, diagnose());
    return false;
  }

  if (type === MESSAGES.PING) {
    askBridge(BRIDGE.OPS.STATE, {}, { timeout: 4000 })
      .then((state) => sendResponse({ ok: true, state, running: isRunning(), url: location.href, diag: diagnose() }))
      .catch((err) => sendResponse({ ok: false, reason: `La pantalla esta, pero el script de la pagina no responde: ${toMessage(err)}. Recarga la pestana (F5).`, diag: diagnose() }));
    return true;
  }

  if (type === MESSAGES.RESOLVE) {
    // Solo para depurar (__extLgeCl / pruebas): la corrida resuelve por su cuenta.
    const { skus = [], categoryMode = CATEGORY_MODE.ALL } = message.payload || {};
    getCatalog('B2C')
      .then((catalog) => sendResponse({ ok: true, resolution: resolveSkus(skus, catalog.rows, { categoryMode }), catalogSize: catalog.rows.length }))
      .catch((err) => sendResponse({ ok: false, reason: toMessage(err) }));
    return true;
  }

  // START: se acepta al toque y la corrida sigue sola.
  if (isRunning()) {
    trace.warn('START rechazado: ya hay una corrida en esta pestana');
    sendResponse({ ok: false, reason: 'Ya hay una corrida en curso en esta pestana.' });
    return false;
  }
  trace.info('START recibido', { id: message.payload?.id, url: location.href });
  sendResponse({ ok: true, url: location.href });
  startRun(message.payload?.id).catch((err) => trace.error(`startRun: ${toMessage(err)}`, err));
  return false;
}

export function init() {
  if (!isPromotionUrl()) return;
  chrome.runtime.onMessage.addListener(handleMessage);
  // El iframe oculto con la misma URL nunca llega a tener el boton NEW: se
  // espera un rato y, si no aparece, este frame no es la pantalla.
  waitFor(isPromotionPage, { timeout: 30000, interval: 250, description: 'el boton NEW' })
    .then(() => {
      trace.info('Promotion Management lista en este frame', { url: location.href, isTopFrame: window === window.top });
      return reconcileOnInit();
    })
    .catch(() => {});
}
