// Persistencia del estado de ejecución de "Colocar TAGs".
//
// ANTES: el popup abría un `chrome.runtime.connect` port y el content script
// corría el batch atado a ese port. Si el popup se cerraba (clic afuera, cambio
// de ventana), el port se desconectaba y el proceso se ABORTABA a mitad.
//
// AHORA: toda la coordinación ocurre vía chrome.storage.local (igual que
// lead-times y cupones). El popup escribe el run; el content script lo detecta
// (init + storage.onChanged), ejecuta el batch en su propio contexto (que vive
// mientras la pestaña esté abierta) y publica progreso/logs en el mismo objeto.
// Cerrar el popup ya NO detiene el proceso; al reabrirlo se ve el avance/result.
//
// Forma del objeto guardado bajo STORAGE_KEYS.RUN:
//   {
//     active:      boolean,        // true mientras hay un run en curso
//     kind:        RUN_KIND,       // delivery | delivery-remove | product | offer
//     claimed:     boolean,        // el frame que detecta MIM lo marcó al arrancar
//     startedAt, finishedAt,       // timestamps
//     finishReason?: 'done'|'cancelled'|'error'|'not-detected',
//     errorReason?: string,
//     config:      object,         // config específica del kind (skus, etc.)
//     total:       number,
//     items: [{ sku, index, status: STATUS, step?, detail?, reason? }],
//     log: [{ ts, level: 'info'|'warn'|'error', message }],  (cap LOG_CAP)
//   }

import { LOG_CAP, STORAGE_KEYS } from './constants.js';
import { getStorage, setStorage, removeStorage } from '../../shared/storage/storage.js';

export async function getRun() {
  return (await getStorage(STORAGE_KEYS.RUN)) || null;
}

export async function setRun(run) {
  return setStorage(STORAGE_KEYS.RUN, run);
}

export async function clearRun() {
  return removeStorage(STORAGE_KEYS.RUN);
}

// Serializamos los read-modify-write: el runner dispara setItem/appendLog en
// modo fire-and-forget (onStep no se await-ea), así que sin esta cola las
// llamadas concurrentes se pisarían (get/set intercalados → updates perdidos).
let writeChain = Promise.resolve();

/** Read-modify-write serializado del run. Devuelve el próximo estado (o null). */
export function updateRun(updater) {
  const next = writeChain.then(async () => {
    const run = (await getRun()) || null;
    if (!run) return null;
    const updated = updater(run);
    await setRun(updated);
    return updated;
  });
  // No dejamos que un rechazo rompa la cadena para las siguientes escrituras.
  writeChain = next.catch(() => {});
  return next;
}

/** Agrega una línea de log al run actual (cap aplicado). */
export async function appendLog(entry) {
  return updateRun((run) => {
    const log = Array.isArray(run.log) ? [...run.log, { ts: Date.now(), ...entry }] : [{ ts: Date.now(), ...entry }];
    if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP);
    return { ...run, log };
  });
}

/**
 * Construye un run nuevo a partir de un kind, su config y la lista de SKUs.
 * No lo persiste — el caller hace setRun().
 */
export function makeRun({ kind, config, skus, message }) {
  const list = Array.isArray(skus) ? skus : [];
  return {
    active: true,
    kind,
    claimed: false,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    config,
    total: list.length,
    items: list.map((sku, index) => ({ sku, index, status: 'pending', step: null })),
    log: [{ ts: Date.now(), level: 'info', message: message || `Run iniciado — ${list.length} SKU(s)` }],
  };
}

export function subscribeToRun(callback) {
  const listener = (changes, area) => {
    if (area !== 'local') return;
    if (!changes[STORAGE_KEYS.RUN]) return;
    callback(changes[STORAGE_KEYS.RUN].newValue || null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    try { chrome.storage.onChanged.removeListener(listener); } catch { /* no-op */ }
  };
}
