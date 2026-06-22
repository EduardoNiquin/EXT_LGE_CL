// Persistencia del estado del run de Cupones. Mismo patrón que lead-times: el
// flujo cruza múltiples page reloads de Magento (listing → edit → listing), por
// lo que toda la coordinación ocurre vía chrome.storage.local en lugar de
// ports/runtime.sendMessage que se cerrarían al unload.
//
// Forma del objeto guardado bajo STORAGE_KEYS.RUN:
//   {
//     active: boolean,
//     kind: RUN_KIND,                        // 'remove' | 'add'
//     startedAt, finishedAt, finishReason?,
//     searchBy: SEARCH_BY,                   // 'id' | 'rule'
//     condition?: {                          // sólo kind 'add'
//       attributeLabel, operator, operatorLabel, value,
//     },
//     currentItemIndex: number,
//     items: [{
//       query: string,                       // ID o nombre de Rule pedido
//       status: ITEM_STATUS,
//       matchedRuleId?: number,              // id real una vez encontrado
//       matchedName?: string,                // nombre real una vez encontrado
//       editHref?: string,
//       removedConditions?: number,          // kind 'remove'
//       addedCondition?: { attribute, operator, value },  // kind 'add'
//       savedAt?: number,
//       error?: string,
//     }],
//     log: [{ ts, level, message }],
//   }

import { STORAGE_KEYS, LOG_CAP } from './constants.js';
import { createRunStore, createPersistedValue } from '../../shared/run-store/index.js';

// Run store compartido (ver shared/run-store).
const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });
export const { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun } = store;

const lastConfig = createPersistedValue(STORAGE_KEYS.LAST_CONFIG, null);
export const getLastConfig = lastConfig.get;
export const setLastConfig = lastConfig.set;

const lastConfigAdd = createPersistedValue(STORAGE_KEYS.LAST_CONFIG_ADD, null);
export const getLastConfigAdd = lastConfigAdd.get;
export const setLastConfigAdd = lastConfigAdd.set;
