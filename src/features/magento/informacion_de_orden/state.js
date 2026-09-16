import { createPersistedValue, createRunStore } from '../../../shared/run-store/index.js';
import { LOG_CAP, RUN_PHASE, STORAGE_KEYS } from './constants.js';
import { emptyStats } from './stats.js';

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

// Los registros capturados viven fuera del run: el run se reescribe en cada
// avance y arrastrar miles de filas en cada escritura lo haria inmanejable.
const result = createPersistedValue(STORAGE_KEYS.RESULT, null);
export const getResult = result.get;
export const setResult = result.set;
export const clearResult = () => result.set(null);

export function subscribeToResult(callback) {
  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEYS.RESULT]) return;
    callback(changes[STORAGE_KEYS.RESULT].newValue || null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/**
 * Forma inicial del run. Solo lleva progreso: los datos de las ordenes van a
 * STORAGE_KEYS.RESULT.
 * @param {object} o
 * @param {object} o.config  { from, to, mode, orderNumbers[], concurrency, includeRaw }
 */
export function makeRun({ config }) {
  return {
    active: true,
    claimed: false,
    phase: RUN_PHASE.STARTING,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    error: '',
    config,
    endpoint: '',
    totalRecords: 0,
    total: 0, // unidades de trabajo (paginas o numeros de orden)
    doneCount: 0,
    okCount: 0,
    notFoundCount: 0,
    errorCount: 0,
    fetchStartedAt: null, // desde cuando se entran fichas (para el ritmo)
    stats: emptyStats(), // tiempos acumulados por ficha (stats.js)
    log: [{ ts: Date.now(), level: 'info', message: 'Preparando la captura de ordenes' }],
  };
}
