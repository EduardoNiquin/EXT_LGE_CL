// Lado aislado del puente con el mundo MAIN (ver content/bridge.js). Mismo
// protocolo que el bridge de Magento: request/response por window.postMessage.
// Cada llamada queda en el registro tecnico (op, ms, resultado o error).

import { BRIDGE } from '../constants.js';
import { createTrace } from '../trace.js';
import { ExtError } from '../../../shared/errors/index.js';

const trace = createTrace('content');
let nextId = 1;

function summarize(op, result) {
  if (!result || typeof result !== 'object') return result;
  if (op === BRIDGE.OPS.CATALOG) return { rows: result.rows?.length };
  if (op === BRIDGE.OPS.LIST) return { rows: result.length, first: result[0]?.promotionId };
  return result;
}

/**
 * Pide una operacion al bridge y devuelve su resultado. Lanza `ExtError` si el
 * bridge falla, no responde a tiempo o se cancela.
 *
 * @param {string} op BRIDGE.OPS.*
 * @param {object} [payload]
 * @param {{ signal?: AbortSignal, timeout?: number }} [opts]
 */
export function askBridge(op, payload = {}, { signal, timeout = BRIDGE.TIMEOUT_MS } = {}) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new ExtError('cancelado', { code: 'aborted' })); return; }
    const id = `${Date.now().toString(36)}-${nextId += 1}`;
    let timer = null;

    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    };
    function onMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== BRIDGE.SOURCE || data.kind !== 'response' || data.id !== id) return;
      cleanup();
      const ms = Date.now() - t0;
      if (data.ok) {
        trace.debug(`bridge ${op} ok (${ms} ms)`, summarize(op, data.result));
        resolve(data.result);
      } else {
        trace.warn(`bridge ${op} fallo (${ms} ms): ${data.error}`);
        reject(new ExtError(data.error || 'el bridge no pudo resolverlo', { code: 'bridge', context: { op } }));
      }
    }
    function onAbort() {
      cleanup();
      reject(new ExtError('cancelado', { code: 'aborted' }));
    }

    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      cleanup();
      trace.error(`bridge ${op} sin respuesta en ${Math.round(timeout / 1000)} s (el script MAIN no esta cargado en este frame?)`);
      reject(new ExtError(`el bridge no respondio (${op}) en ${Math.round(timeout / 1000)} s`, { code: 'bridge-timeout', context: { op } }));
    }, timeout);
    window.postMessage({ source: BRIDGE.SOURCE, kind: 'request', id, op, payload }, '*');
  });
}
