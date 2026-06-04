// Persistencia del estado de ejecución de "Verificar órdenes y stock" (Starkoms).
//
// Mismo modelo que colocar-tags: la coordinación vive en chrome.storage.local.
// El popup escribe el `run`; el content script (en la pestaña Starkoms) lo
// reclama y ejecuta el batch como un único flujo async continuo (la SPA usa
// hash routing, así que NO se recarga entre rutas y el proceso sobrevive).
// Progreso/logs se publican en el mismo objeto. Cerrar el popup no detiene.
//
// Forma del objeto guardado bajo STORAGE_KEYS.RUN:
//   {
//     active:      boolean,
//     claimed:     boolean,        // el frame top de Starkoms lo marcó al arrancar
//     startedAt, finishedAt,
//     finishReason?: 'done'|'cancelled'|'error'|'not-detected',
//     errorReason?: string,
//     config: { bodega, stockValue, verifyExistence, dryRun, limit },
//     total:  number,              // se fija tras recolectar la cola
//     currentIndex: number,
//     items: [{
//       orderNumber, reference,
//       status: STATUS, step?, detail?, reason?,
//       products?: [{ sku, action: 'has-stock'|'stocked'|'not-found'|'error', stock?, reason? }],
//     }],
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

// Serializamos los read-modify-write: los onStep disparan setItem/appendLog en
// modo fire-and-forget, así que sin esta cola las llamadas concurrentes se
// pisarían (get/set intercalados → updates perdidos).
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
 * Construye un run nuevo. Las órdenes se autodetectan en el content script tras
 * filtrar, así que `items` arranca vacío y el runner lo completa con
 * `setItems()` una vez recolectada la cola.
 */
export function makeRun({ config, message }) {
  return {
    active: true,
    claimed: false,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    errorReason: null,
    config,
    total: 0,
    currentIndex: -1,
    items: [],
    log: [{ ts: Date.now(), level: 'info', message: message || 'Run iniciado' }],
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

export async function getLastConfig() {
  return (await getStorage(STORAGE_KEYS.LAST_CONFIG)) || null;
}

export async function setLastConfig(config) {
  return setStorage(STORAGE_KEYS.LAST_CONFIG, config);
}
