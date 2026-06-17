// Persistencia del estado de ejecución de "SoporteSeller — Detalle Orden".
//
// Mismo modelo que starkoms/colocar-tags: la coordinación vive en
// chrome.storage.local. El popup arma la cola de "Detalle Orden" (a partir del
// CSV) y escribe el `run`; el content script (en la pestaña de Soporte Seller)
// lo reclama y ejecuta el batch como un único flujo async continuo. El sitio es
// una SPA Salesforce: el acordeón se llena sin recargas, así que el proceso
// sobrevive al cierre del popup. Progreso/logs se publican en el mismo objeto.
//
// Forma del objeto guardado bajo STORAGE_KEYS.RUN:
//   {
//     active:  boolean,
//     claimed: boolean,            // el frame que detecta el form lo marcó
//     startedAt, finishedAt,
//     finishReason?: 'done'|'cancelled'|'error'|'not-detected',
//     errorReason?: string,
//     total: number,
//     currentIndex: number,
//     items: [{ ordernumber, guia, cantP, status, step?, reason? }],
//     log: [{ ts, level: 'info'|'warn'|'error', message }],  (cap LOG_CAP)
//   }

import { LOG_CAP, STORAGE_KEYS, STATUS } from './constants.js';
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

// Serializamos los read-modify-write para que los updates concurrentes (setItem
// + appendLog disparados en cadena) no se pisen entre sí.
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
 * Construye un run nuevo a partir de la cola de "Detalle Orden" ya expandida en
 * el popup (un item por guía).
 */
export function makeRun({ items, message }) {
  return {
    active: true,
    claimed: false,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    errorReason: null,
    total: items.length,
    currentIndex: -1,
    items: items.map((it) => ({ ...it, status: STATUS.PENDING, step: null })),
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

// Borrador del formulario (texto del CSV + modo) — independiente del run.
export async function getDraft() {
  return (await getStorage(STORAGE_KEYS.DRAFT)) || null;
}

export async function setDraft(draft) {
  return setStorage(STORAGE_KEYS.DRAFT, draft);
}
