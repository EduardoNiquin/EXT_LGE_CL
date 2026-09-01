// Lado aislado del puente con el mundo MAIN (ver content/bridge.js).
//
// Nunca lanza salvo cancelacion: el bridge es una via rapida opcional. Si el
// script MAIN no esta (otra base de admin, version de Chromium vieja, Magento
// sin uiRegistry), la respuesta es `{ ok: false, reason }` y el que llama sigue
// con el recorrido por DOM de siempre.

import { BRIDGE } from '../constants.js';

let nextId = 1;

/**
 * @param {string} op operacion soportada por el bridge (BRIDGE.OPS)
 * @param {object} [payload]
 * @param {{ signal?: AbortSignal, timeout?: number, target?: Window }} [opts]
 * @returns {Promise<{ ok: boolean, result?: any, reason?: string, aborted?: boolean }>}
 */
export function askBridge(op, payload = {}, opts = {}) {
  const { signal, timeout = BRIDGE.TIMEOUT_MS, target = window } = opts;

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, aborted: true, reason: 'cancelado' });
      return;
    }

    const id = `${Date.now().toString(36)}-${nextId += 1}`;
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      target.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    function onMessage(event) {
      // Los mensajes del bridge vienen del propio documento; los de un iframe
      // ajeno se descartan (en las pruebas no hay `source`).
      if (event.source && event.source !== target) return;
      const data = event.data;
      if (!data || data.source !== BRIDGE.SOURCE || data.kind !== 'response' || data.id !== id) return;
      finish(data.ok
        ? { ok: true, result: data.result }
        : { ok: false, reason: data.error || 'el bridge no pudo resolverlo' });
    }

    function onAbort() {
      finish({ ok: false, aborted: true, reason: 'cancelado' });
    }

    target.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish({ ok: false, reason: `el bridge no respondio en ${timeout}ms` }), timeout);

    try {
      target.postMessage({ source: BRIDGE.SOURCE, kind: 'request', id, op, payload }, '*');
    } catch (err) {
      finish({ ok: false, reason: String(err?.message || err) });
    }
  });
}
