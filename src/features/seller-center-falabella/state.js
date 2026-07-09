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

// ---------------------------------------------------------------------------
// "Buscar número de órden en caso"
// ---------------------------------------------------------------------------
//
// Segundo flujo, storage-driven e independiente del anterior. El popup escribe
// el run con la lista de órdenes a buscar; el content script (en la pestaña con
// el listado de casos) lo reclama y recorre los casos página por página. Soporta
// PAUSA (paused=true: el runner queda a la espera sin abortar) además de DETENER
// (active=false: aborta el flujo). Progreso/logs viven en el mismo objeto.
//
// Forma del objeto guardado bajo STORAGE_KEYS.SEARCH_RUN:
//   {
//     active:  boolean,
//     paused:  boolean,             // pausa reanudable (no aborta)
//     claimed: boolean,
//     startedAt, finishedAt,
//     finishReason?: 'all-found'|'exhausted'|'cancelled'|'error'|'not-detected',
//     errorReason?: string,
//     fromFirstPage: boolean,       // arrancar desde la página 1
//     targets: string[],            // números de orden a buscar (sólo dígitos)
//     found: { [order]: { caseNumber, caseId, page } },
//     casesScanned: number,
//     currentPage: number|null,
//     totalPages: number|null,
//     log: [{ ts, level, message }],
//   }
const searchStore = createRunStore({ key: STORAGE_KEYS.SEARCH_RUN, logCap: LOG_CAP });
export const getSearchRun       = searchStore.getRun;
export const setSearchRun       = searchStore.setRun;
export const clearSearchRun     = searchStore.clearRun;
export const updateSearchRun    = searchStore.updateRun;
export const appendSearchLog    = searchStore.appendLog;
export const subscribeToSearchRun = searchStore.subscribeToRun;

/** Construye un run nuevo de búsqueda a partir de la lista de órdenes objetivo. */
export function makeSearchRun({ targets, fromFirstPage = true, message }) {
  return {
    active: true,
    paused: false,
    claimed: false,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    errorReason: null,
    fromFirstPage: fromFirstPage !== false,
    targets: [...targets],
    found: {},
    casesScanned: 0,
    currentPage: null,
    totalPages: null,
    log: [{ ts: Date.now(), level: 'info', message: message || 'Búsqueda iniciada' }],
  };
}

// Borrador de la búsqueda (texto de órdenes + opción) — independiente del run.
const searchDraft = createPersistedValue(STORAGE_KEYS.SEARCH_DRAFT, null);
export const getSearchDraft = searchDraft.get;
export const setSearchDraft = searchDraft.set;
