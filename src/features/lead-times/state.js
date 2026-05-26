// Persistencia del estado de ejecución. Toda la coordinación entre el popup
// (que dispara el run) y el content script (que recorre la página y aplica los
// lead times) ocurre a través de chrome.storage.local. Esto se debe a que el
// flujo cruza múltiples page reloads de Magento, donde cualquier
// `chrome.runtime.connect` port se cerraría al unload.
//
// Forma del objeto guardado bajo STORAGE_KEYS.RUN:
//   {
//     active: boolean,            // true mientras hay un run en curso
//     startedAt, finishedAt,      // timestamps
//     currentRegionIndex: number, // índice dentro de queue
//     queue: [{
//       regionName: string,
//       minDays:    number,
//       maxDays:    number,
//       status:     REGION_STATUS,
//       error?:     string,
//       totalComunas?: number,
//       currentComunaIndex?: number,
//       comunas?: [{
//         id, code, name, regionName, currentMin, currentMax,
//         editHref, status: COMUNA_STATUS, error?, previousMin?, previousMax?, savedAt?,
//       }],
//     }],
//     log: [{ ts, level: 'info'|'warn'|'error', message }],
//   }

import { STORAGE_KEYS, LOG_CAP } from './constants.js';
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

/** Actualiza el run con un updater y devuelve el siguiente estado. */
export async function updateRun(updater) {
  const run = (await getRun()) || null;
  if (!run) return null;
  const next = updater(run);
  await setRun(next);
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

export async function getLastConfig() {
  return (await getStorage(STORAGE_KEYS.LAST_CONFIG)) || null;
}

export async function setLastConfig(config) {
  return setStorage(STORAGE_KEYS.LAST_CONFIG, config);
}
