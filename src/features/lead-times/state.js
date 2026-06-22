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
import { createRunStore, createPersistedValue } from '../../shared/run-store/index.js';

// Run store compartido (ver shared/run-store). subscribeToRun queda disponible
// aunque lead-times observe storage directamente en content/index.js.
const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });
export const { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun } = store;

const lastConfig = createPersistedValue(STORAGE_KEYS.LAST_CONFIG, null);
export const getLastConfig = lastConfig.get;
export const setLastConfig = lastConfig.set;
