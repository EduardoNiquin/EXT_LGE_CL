// Persistencia del estado de ejecución de "Creación de producto" (PIM).
//
// Mismo modelo que starkoms/seller-center: la coordinación vive en
// chrome.storage.local. El popup arma la cola de SKU y escribe el `run`; el
// content script (en la pestaña de PIM) lo reclama y ejecuta el batch como un
// único flujo async continuo (la grilla busca sin recargar la página, así que
// el proceso sobrevive al cierre del popup). Progreso/logs en el mismo objeto.
//
// Forma del objeto guardado bajo STORAGE_KEYS.RUN:
//   {
//     active:  boolean,
//     claimed: boolean,            // el frame que detecta el buscador lo marcó
//     startedAt, finishedAt,
//     finishReason?: 'done'|'cancelled'|'error'|'not-detected',
//     errorReason?: string,
//     total: number,
//     currentIndex: number,
//     items: [{ sku, status, step?, found?: boolean, specAssign?: string|null, reason? }],
//     log: [{ ts, level: 'info'|'warn'|'error', message }],  (cap LOG_CAP)
//   }

import { LOG_CAP, STORAGE_KEYS, STATUS } from './constants.js';
import { createRunStore, createPersistedValue } from '../../shared/run-store/index.js';

// Run store compartido con coalescing de escrituras (ver shared/run-store).
const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });
export const { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun } = store;

/**
 * Construye un run nuevo a partir de la lista de SKU armada en el popup.
 */
export function makeRun({ skus, message }) {
  return {
    active: true,
    claimed: false,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    errorReason: null,
    total: skus.length,
    currentIndex: -1,
    items: skus.map((sku) => ({ sku, status: STATUS.PENDING, step: null, found: null, specAssign: null })),
    log: [{ ts: Date.now(), level: 'info', message: message || 'Run iniciado' }],
  };
}

// Borrador del formulario (texto con los SKU) — independiente del run.
const draft = createPersistedValue(STORAGE_KEYS.DRAFT, null);
export const getDraft = draft.get;
export const setDraft = draft.set;
