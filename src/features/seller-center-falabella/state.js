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
import { createRunStore, createPersistedValue } from '../../shared/run-store/index.js';

// Run store compartido con coalescing de escrituras (ver shared/run-store).
const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });
export const { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun } = store;

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

// Borrador del formulario (texto del CSV + modo) — independiente del run.
const draft = createPersistedValue(STORAGE_KEYS.DRAFT, null);
export const getDraft = draft.get;
export const setDraft = draft.set;
