import { createPersistedValue, createRunStore } from '../../../shared/run-store/index.js';
import { LOG_CAP, RUN_PHASE, STORAGE_KEYS } from './constants.js';

const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });

export const {
  getRun,
  setRun,
  clearRun,
  updateRun,
  appendLog,
  subscribeToRun,
} = store;

const draft = createPersistedValue(STORAGE_KEYS.DRAFT, null);
export const getDraft = draft.get;
export const setDraft = draft.set;

/**
 * Forma inicial del run.
 * @param {object} o
 * @param {object} o.config    lo que pidio el usuario (rango, pasarelas, campos, topes).
 * @param {string} o.listingUrl  listado desde donde arranca el recorrido.
 */
export function makeRun({ config, listingUrl }) {
  return {
    active: true,
    phase: RUN_PHASE.STARTING,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    error: '',
    config,
    listingUrl,
    currentIndex: -1,
    detailRedirects: 0,
    matches: 0,
    items: [],
    log: [{ ts: Date.now(), level: 'info', message: 'Preparando la busqueda en el listado de ordenes' }],
  };
}
