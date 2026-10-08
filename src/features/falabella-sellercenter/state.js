// Persistencia de "Falabella SellerCenter".
//
// Credenciales: { userId, apiKey } en chrome.storage.local (solo en este
// navegador; no van en el codigo ni en el repo).
//
// Corrida de "Identificar paquetes" (STORAGE_KEYS.PAQUETES_RUN). El service
// worker es el unico writer durante la corrida; el popup solo escribe para
// cancelar/limpiar.
//   {
//     active, startedAt, finishedAt, finishReason?, errorReason?,
//     desde, hasta,                       // dias de Chile (YYYY-MM-DD)
//     estados: string[],                  // filtro de estado de orden ([] = todos)
//     phase: PHASE.*,
//     progress: { paginasHechas, paginasTotal, ordenesApi, ordenesLeidas,
//                 lotesHechos, lotesTotal },
//     stats?: { enRango, multiProducto, analizadas, conProblema, montoProblema, porEstado },
//     log: [{ ts, level, message }],      (cap LOG_CAP)
//   }
// Las ordenes con problema van aparte (PAQUETES_RESULT: { desde, hasta, estados, hallazgos })
// para no inflar el run que el popup re-renderiza en cada cambio.

import { FINISH_REASON, LOG_CAP, PHASE, STORAGE_KEYS } from './constants.js';
import { createRunStore, createPersistedValue } from '../../shared/run-store/index.js';

const credenciales = createPersistedValue(STORAGE_KEYS.CREDENCIALES, null);
export const getCredenciales = credenciales.get;
export const setCredenciales = credenciales.set;

const store = createRunStore({ key: STORAGE_KEYS.PAQUETES_RUN, logCap: LOG_CAP });
export const { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun } = store;

export function makeRun({ desde, hasta, estados = [] }) {
  return {
    active: true,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    errorReason: null,
    desde,
    hasta,
    estados,
    phase: PHASE.IDLE,
    progress: { paginasHechas: 0, paginasTotal: 0, ordenesApi: 0, ordenesLeidas: 0, lotesHechos: 0, lotesTotal: 0 },
    stats: null,
    log: [{ ts: Date.now(), level: 'info', message: `Analisis iniciado — ${desde} a ${hasta}` }],
  };
}

export const isCancelled = (run) =>
  Boolean(run && (!run.active || run.finishReason === FINISH_REASON.CANCELLED));

const result = createPersistedValue(STORAGE_KEYS.PAQUETES_RESULT, null);
export const getResult = result.get;
export const setResult = result.set;
export const clearResult = () => result.set(null);

const draft = createPersistedValue(STORAGE_KEYS.PAQUETES_DRAFT, null);
export const getDraft = draft.get;
export const setDraft = draft.set;
