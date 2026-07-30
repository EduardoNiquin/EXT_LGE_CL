// Persistencia de la gestion automatica (plataforma Falabella).
//
// Storage-driven como el resto: el popup arranca el run, el service worker lo
// ejecuta (sobrevive al cierre del popup) y el content script lee de aca que
// tiene que hacer en la pagina que acaba de cargar. Es lo que permite que el
// flujo cruce navegaciones: listado -> formulario de apelacion, o listado ->
// formulario de ticket.
//
// Los PDF NO viven aca: se descargan de la API en el momento de subirlos (ver
// runner.js). Meter varios MB en base64 en chrome.storage.local reventaria la
// cuota y ademas hay que evitar dejar evidencias de devoluciones en disco.
//
// Forma del objeto guardado bajo GESTION_STORAGE_KEYS.RUN:
//   {
//     active, startedAt, finishedAt, finishReason, errorReason,
//     base,                          // base de la API del modulo
//     tabId,                          // pestana donde se gestiona
//     prueba: boolean,                // modo prueba: rellena pero NO envia
//     currentId: number|null,         // job en curso
//     jobs: [{
//       id, orden, numero_guia,
//       reembolso: { producto, modelo, serie, observacion } | null,
//       cc: string[],
//       fase, resultado, ticket, mensaje,
//       reportado: boolean,
//       startedAt: number|null,       // para el watchdog
//     }],
//     log: [{ ts, level, message }],
//   }

import { FASE, GESTION_STORAGE_KEYS, LOG_CAP } from './constants.js';
import { createRunStore } from '../../../../shared/run-store/index.js';

const store = createRunStore({ key: GESTION_STORAGE_KEYS.RUN, logCap: LOG_CAP });
export const { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun } = store;

/** Job nuevo a partir de una orden de la cola `/gestiones`. */
export function makeJob(orden) {
  return {
    id: orden.id,
    orden: orden.orden ?? '',
    numero_guia: orden.numero_guia ?? '',
    reembolso: orden.reembolso ?? null,
    cc: Array.isArray(orden.gestion?.cc) ? orden.gestion.cc : [],
    fase: FASE.PENDIENTE,
    resultado: null,
    ticket: null,
    mensaje: null,
    reportado: false,
    startedAt: null,
  };
}

export function makeRun({ base, jobs, prueba = false, message }) {
  return {
    active: true,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    errorReason: null,
    base,
    tabId: null,
    prueba: Boolean(prueba),
    currentId: null,
    jobs: (jobs || []).map((o) => makeJob(o)),
    log: [{ ts: Date.now(), level: 'info', message: message || 'Gestion iniciada' }],
  };
}

/** Aplica un patch al job indicado, devolviendo un run nuevo. */
export function patchJob(run, id, patch) {
  if (!run) return run;
  return {
    ...run,
    jobs: (run.jobs || []).map((j) => (j.id === id ? { ...j, ...patch } : j)),
  };
}

export function findJob(run, id) {
  return (run?.jobs || []).find((j) => j.id === id) || null;
}

/** ¿El job ya termino (con resultado, se haya reportado o no)? */
export function isJobDone(job) {
  return Boolean(job?.resultado);
}

/** Siguiente job sin resultado, en orden de llegada. */
export function nextPendingJob(run) {
  return (run?.jobs || []).find((j) => !isJobDone(j)) || null;
}
