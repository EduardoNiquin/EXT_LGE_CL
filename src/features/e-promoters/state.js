// Persistencia del estado de "Informe ordenes".
//
// El service worker es el unico writer durante una corrida (procesa en segundo
// plano); el popup solo escribe para cancelar/limpiar. El estado vive en
// chrome.storage.local y el popup lo refleja en vivo via storage.onChanged, asi
// la tarea sobrevive a cerrar el popup o cambiar de pestaña.
//
// Forma del objeto guardado bajo STORAGE_KEYS.RUN:
//   {
//     active: boolean,
//     startedAt, finishedAt,
//     finishReason?: 'done'|'cancelled'|'error',
//     errorReason?: string,
//     source: 'api'|'csv',
//     from, to,                 // rango pedido (YYYY-MM-DD)
//     phase: PHASE.*,           // que esta haciendo ahora
//     stats?: { totalRows, afterDate, afterStatus, afterWarehouse, removedDuplicateNames, removedBoughtLater, removedDuplicateEmails, finalRows, byStatus },
//     result?: { filename, rows, bytes, ready: true },  // metadata; el CSV va en RESULT
//     log: [{ ts, level, message }],  (cap LOG_CAP)
//   }
//
// El CSV generado se guarda aparte (STORAGE_KEYS.RESULT) para no inflar el run
// (que el popup re-renderiza en cada cambio).

import { FINISH_REASON, LOG_CAP, PHASE, STORAGE_KEYS } from './constants.js';
import { createRunStore, createPersistedValue } from '../../shared/run-store/index.js';

const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });
export const { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun } = store;

export function makeRun({ source, from, to, message }) {
  return {
    active: true,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    errorReason: null,
    source,
    from: from || null,
    to: to || null,
    phase: PHASE.IDLE,
    stats: null,
    result: null,
    log: [{ ts: Date.now(), level: 'info', message: message || 'Corrida iniciada' }],
  };
}

export const isCancelled = (run) =>
  Boolean(run && (!run.active || run.finishReason === FINISH_REASON.CANCELLED));

// CSV generado (para re-descargar desde el popup).
const result = createPersistedValue(STORAGE_KEYS.RESULT, null);
export const getResult = result.get;
export const setResult = result.set;
export const clearResult = () => result.set(null);

// Ultima config del formulario.
const draft = createPersistedValue(STORAGE_KEYS.DRAFT, null);
export const getDraft = draft.get;
export const setDraft = draft.set;
