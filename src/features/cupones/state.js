// Persistencia del estado del run de Cupones. Mismo patrón que lead-times: el
// flujo cruza múltiples page reloads de Magento (listing → edit → listing), por
// lo que toda la coordinación ocurre vía chrome.storage.local en lugar de
// ports/runtime.sendMessage que se cerrarían al unload.
//
// Forma del objeto guardado bajo STORAGE_KEYS.RUN:
//   {
//     active: boolean,
//     startedAt, finishedAt, finishReason?,
//     searchBy: SEARCH_BY,                   // 'id' | 'rule'
//     currentItemIndex: number,
//     items: [{
//       query: string,                       // ID o nombre de Rule pedido
//       status: ITEM_STATUS,
//       matchedRuleId?: number,              // id real una vez encontrado
//       matchedName?: string,                // nombre real una vez encontrado
//       editHref?: string,
//       removedConditions?: number,
//       savedAt?: number,
//       error?: string,
//     }],
//     log: [{ ts, level, message }],
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

export async function updateRun(updater) {
  const run = (await getRun()) || null;
  if (!run) return null;
  const next = updater(run);
  await setRun(next);
  return next;
}

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
