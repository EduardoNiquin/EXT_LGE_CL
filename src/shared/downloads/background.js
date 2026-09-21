// El lado service worker de `requestDownload`.
//
// En el service worker NO existe `URL.createObjectURL` (no esta en
// ServiceWorkerGlobalScope), asi que la unica via es armar una **data URL en
// base64** y pasarsela a `chrome.downloads` — el mismo camino que ya usaban
// `registro-acciones/background/exportar.js` y `e-promoters/background/informe.js`.
// El base64 se arma por bloques de 0x8000 porque `String.fromCharCode.apply`
// revienta con arreglos grandes.
//
// Medido el 20-09-2026 en Edge: un texto de 6,29 MB (data URL de 8 MB) se
// descargo completo y sin error, asi que las partes del CSV de Informacion de
// Orden (500 ordenes) entran con holgura.
//
// Y se ESPERA a que el archivo este escrito: disparar decenas de descargas
// seguidas sin esperar puede dejar archivos a medias sin que nadie se entere,
// que es exactamente lo que una descarga "de respaldo" no debe hacer.

import { logger } from '../utils/logger.js';
import { toMessage } from '../errors/index.js';
import { DOWNLOAD_MESSAGE } from './index.js';

const log = logger('service-worker');

const DEFAULT_MIME = 'text/plain;charset=utf-8';
const WAIT_TIMEOUT_MS = 120000;

/** Registra el handler del mensaje. Idempotente por contexto (se llama una vez). */
export function wireDownloadsBackground() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== DOWNLOAD_MESSAGE) return undefined;
    downloadText(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: toMessage(err) }));
    return true; // respuesta asincrona
  });
}

async function downloadText({ filename, text, mime = DEFAULT_MIME, wait = true }) {
  if (!filename) return { ok: false, error: 'falta el nombre del archivo' };
  const url = `data:${mime};base64,${base64Of(String(text ?? ''))}`;

  const started = await new Promise((resolve) => {
    try {
      chrome.downloads.download({ url, filename, saveAs: false }, (id) => {
        resolve({ id: id ?? null, error: chrome.runtime.lastError?.message || null });
      });
    } catch (err) {
      resolve({ id: null, error: toMessage(err) });
    }
  });

  if (started.error || started.id == null) {
    log.warn('no se pudo iniciar la descarga', { filename, error: started.error });
    return { ok: false, error: started.error || 'chrome.downloads no devolvio id' };
  }
  if (!wait) return { ok: true, id: started.id };

  const done = await waitForDownload(started.id);
  if (!done.ok) log.warn('la descarga no termino bien', { filename, error: done.error });
  return { ...done, id: started.id };
}

function base64Of(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Resuelve cuando el archivo quedo escrito (o se interrumpio / tardo demasiado). */
function waitForDownload(id, timeoutMs = WAIT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { chrome.downloads.onChanged.removeListener(onChanged); } catch { /* no-op */ }
      clearTimeout(timer);
      resolve(result);
    };

    function onChanged(delta) {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') finish({ ok: true });
      else if (delta.state?.current === 'interrupted') {
        finish({ ok: false, error: delta.error?.current || 'descarga interrumpida' });
      }
    }

    const timer = setTimeout(() => finish({ ok: false, error: 'la descarga no termino a tiempo' }), timeoutMs);
    chrome.downloads.onChanged.addListener(onChanged);

    // Pudo terminar antes de que el listener quedara enganchado.
    chrome.downloads.search({ id }, (found) => {
      const state = found?.[0]?.state;
      if (state === 'complete') finish({ ok: true });
      else if (state === 'interrupted') finish({ ok: false, error: 'descarga interrumpida' });
    });
  });
}
