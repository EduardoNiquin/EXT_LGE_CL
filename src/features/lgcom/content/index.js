import { logger } from '../../../shared/utils/logger.js';
import {
  BRIDGE_SOURCE,
  GRAPHQL_URL_RE,
  LGCOM_HOST_RE,
  MESSAGES,
  PROXY_URL_RE,
} from '../constants.js';
import * as store from './capture-store.js';
import { waitAndParse } from './destacados/check.js';
import { toMessage } from '../../../shared/errors/index.js';

const log = logger('lgcom');

// Path esperado (sin barra final) para comparar contra la navegación actual.
function normalizePath(p) {
  return String(p || '').replace(/\/+$/, '');
}

function isLgcomHost() {
  try {
    return LGCOM_HOST_RE.test(location.hostname);
  } catch {
    return false;
  }
}

// Recibe las capturas que el bridge (mundo MAIN) reenvía por postMessage.
function onWindowMessage(event) {
  // Seguridad: solo mensajes de ESTE window y de nuestro bridge.
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== BRIDGE_SOURCE) return;
  if (data.url && !GRAPHQL_URL_RE.test(data.url) && !PROXY_URL_RE.test(data.url)) return;

  store.put(data.operationName, {
    operationName: data.operationName,
    variables: data.variables ?? null,
    response: data.response ?? null,
    url: data.url ?? location.href,
    ts: data.ts ?? Date.now(),
  });
  log.debug('captura GraphQL', { operationName: data.operationName, url: data.url });
}

// Mensajes one-shot desde el popup. Patrón calcado de colocar-tags.
function handleMessage(message, _sender, sendResponse) {
  if (message?.type === MESSAGES.GET_CAPTURES) {
    sendResponse({ ok: true, captures: store.listLatest() });
    return true;
  }
  if (message?.type === MESSAGES.GET_OPERATION) {
    const cap = store.getLatest(message.operationName);
    if (!cap) {
      sendResponse({ ok: false, reason: 'No hay captura para esa operación.' });
      return true;
    }
    sendResponse({
      ok: true,
      operationName: cap.operationName,
      ts: cap.ts,
      url: cap.url,
      variables: cap.variables,
      response: cap.response,
    });
    return true;
  }
  if (message?.type === MESSAGES.PARSE_SPOTLIGHT) {
    // El service worker abrió esta pestaña en una URL de categoría y pide leer
    // el spotlight ya renderizado. Verificamos que la navegación ya esté en la
    // URL esperada (si no, todavía está cargando la anterior → ready:false).
    const expect = normalizePath(message.expectPath);
    if (expect && normalizePath(location.pathname) !== expect) {
      sendResponse({ ok: true, ready: false });
      return true;
    }
    waitAndParse().then(
      ({ hasSpotlight, products }) => sendResponse({ ok: true, ready: true, hasSpotlight, products }),
      (err) => sendResponse({ ok: false, reason: toMessage(err) }),
    );
    return true; // canal abierto para la respuesta async
  }
  return false;
}

export function init() {
  // El listener de mensajes del popup se registra en el top frame (la pestaña
  // que el popup consulta). En frames anidados no aporta.
  if (window !== window.top) return;
  if (!isLgcomHost()) {
    log.debug('host no es lg.com — feature inactiva', { host: location.hostname });
    return;
  }

  log.info('lgcom init', { url: location.href });
  window.addEventListener('message', onWindowMessage);
  chrome.runtime.onMessage.addListener(handleMessage);
}

// Reexport para debug.js
export { store };
