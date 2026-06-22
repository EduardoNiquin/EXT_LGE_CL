// Factory de "run stores" — la persistencia de estado de ejecución que cada
// feature con batch (Colocar TAGs, Lead Times, Cupones, Starkoms, Seller Center,
// Orden Info) reimplementaba casi idéntica en su `state.js`.
//
// Provee: getRun/setRun/clearRun, updateRun (read-modify-write coalescido),
// appendLog (con cap) y subscribeToRun (storage.onChanged del key).
//
// VELOCIDAD — coalescing de escrituras:
//   updateRun encola el updater y drena la cola en LOTES. Cada lote hace UN
//   getRun + UN setRun aplicando en orden FIFO todos los updaters acumulados
//   mientras la IO anterior estaba en vuelo. Reduce de O(N) round-trips a
//   storage a O(rondas de IO) durante ráfagas (los onStep fire-and-forget de los
//   runners), y reduce los eventos storage.onChanged → menos re-renders del
//   popup. Es correcto: cada lote lee fresco de storage, así que ve writes
//   externos (p.ej. la cancelación que el popup escribe poniendo active=false).
//
// CORRECTITUD — multi-writer:
//   El content script es el único writer durante un run; el popup sólo escribe
//   para cancelar/limpiar. Como cada lote re-lee storage antes de aplicar, un
//   write externo entre lotes se respeta. updateRun resuelve con el estado justo
//   después de su propio updater (igual semántica que la versión serializada).

import { getStorage, setStorage, removeStorage } from '../storage/storage.js';

/**
 * @param {object} opts
 * @param {string} opts.key      key de chrome.storage.local donde vive el run.
 * @param {number} [opts.logCap=400]  máximo de líneas en run.log.
 */
export function createRunStore({ key, logCap = 400 } = {}) {
  if (!key) throw new Error('createRunStore: falta `key`');

  const getRun = () => getStorage(key).then((v) => v || null);
  const setRun = (run) => setStorage(key, run);
  const clearRun = () => removeStorage(key);

  let queue = [];
  let flushing = false;

  function updateRun(updater) {
    return new Promise((resolve, reject) => {
      queue.push({ updater, resolve, reject });
      if (!flushing) {
        flushing = true;
        queueMicrotask(flush);
      }
    });
  }

  async function flush() {
    try {
      while (queue.length) {
        const batch = queue;
        queue = [];

        let run;
        try {
          run = await getRun();
        } catch (err) {
          for (const it of batch) it.reject(err);
          continue;
        }
        if (!run) {
          for (const it of batch) it.resolve(null);
          continue;
        }

        let cur = run;
        const settled = [];
        for (const it of batch) {
          try {
            cur = it.updater(cur);
            settled.push({ it, value: cur });
          } catch (err) {
            it.reject(err);
          }
        }

        try {
          await setRun(cur);
          for (const s of settled) s.it.resolve(s.value);
        } catch (err) {
          for (const s of settled) s.it.reject(err);
        }
      }
    } finally {
      flushing = false;
      // Si entró algo entre el último drain y el reset del flag, re-agendar.
      if (queue.length) {
        flushing = true;
        queueMicrotask(flush);
      }
    }
  }

  function appendLog(entry) {
    return updateRun((run) => {
      const prev = Array.isArray(run.log) ? run.log : [];
      const log = [...prev, { ts: Date.now(), ...entry }];
      if (log.length > logCap) log.splice(0, log.length - logCap);
      return { ...run, log };
    });
  }

  function subscribeToRun(callback) {
    const listener = (changes, area) => {
      if (area !== 'local' || !changes[key]) return;
      callback(changes[key].newValue || null);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      try { chrome.storage.onChanged.removeListener(listener); } catch { /* no-op */ }
    };
  }

  return { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun };
}

/**
 * Helper para valores persistidos sueltos (última config, borrador, etc.).
 * Devuelve `{ get, set }`. `get()` resuelve `fallback` si no hay valor.
 */
export function createPersistedValue(key, fallback = null) {
  return {
    get: () => getStorage(key).then((v) => (v == null ? fallback : v)),
    set: (value) => setStorage(key, value),
  };
}

// -----------------------------------------------------------------------------
// Ciclo de vida del content script
// -----------------------------------------------------------------------------

/**
 * Patrón "storage-driven async" (Colocar TAGs, Starkoms, Seller Center): la SPA
 * no recarga, así que el batch corre como un flujo async continuo. Engancha
 * reconcile + subscribe(active?tick:abort) + tick inicial, con el manejo de
 * errores centralizado.
 *
 * @param {object} o
 * @param {(cb:(run:any)=>void)=>void} o.subscribeToRun
 * @param {()=>Promise<void>|void} o.tickIfActive
 * @param {()=>void} [o.abortActiveRun]
 * @param {()=>Promise<void>|void} [o.reconcileOnInit]
 * @param {boolean} [o.topFrameOnly=false]  sólo coordina el top frame.
 * @param {{warn?:Function,error?:Function}} [o.log=console]
 */
export function wireAsyncRunLifecycle({
  subscribeToRun,
  tickIfActive,
  abortActiveRun = null,
  reconcileOnInit = null,
  topFrameOnly = false,
  log = console,
}) {
  if (topFrameOnly && window !== window.top) return;

  if (reconcileOnInit) {
    Promise.resolve().then(reconcileOnInit).catch((err) => log.warn?.('reconcileOnInit falló', err));
  }

  subscribeToRun((run) => {
    if (run && run.active) {
      Promise.resolve(tickIfActive()).catch((err) => log.error?.('tickIfActive falló', err));
    } else if (abortActiveRun) {
      abortActiveRun();
    }
  });

  Promise.resolve(tickIfActive()).catch((err) => log.error?.('tickIfActive inicial falló', err));
}

/**
 * Patrón "tick-por-reload" (Lead Times, Cupones): el flujo cruza navegaciones
 * full-page de Magento, así que cada carga hace un tick y cualquier cambio del
 * run en storage dispara otro. Sólo el top frame.
 *
 * @param {object} o
 * @param {string} o.runKey   key del run en storage que se observa.
 * @param {()=>Promise<void>|void} o.tickIfActive
 * @param {number} [o.delay=300]  espera inicial para que monte el DOM/grid.
 * @param {{debug?:Function}} [o.log=console]
 */
export function wireReloadTickLifecycle({ runKey, tickIfActive, delay = 300, log = console }) {
  if (window !== window.top) {
    log.debug?.('iframe — no se inicializa la state machine en este frame');
    return;
  }
  const tick = () => Promise.resolve(tickIfActive()).catch(() => { /* logueado adentro */ });
  setTimeout(tick, delay);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[runKey]) return;
    tick();
  });
}
