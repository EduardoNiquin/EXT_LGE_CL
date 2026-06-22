// Persistencia del estado de ejecución de "Verificar órdenes y stock" (Starkoms).
//
// Mismo modelo que colocar-tags: la coordinación vive en chrome.storage.local.
// El popup escribe el `run`; el content script (en la pestaña Starkoms) lo
// reclama y ejecuta el batch como un único flujo async continuo (la SPA usa
// hash routing, así que NO se recarga entre rutas y el proceso sobrevive).
// Progreso/logs se publican en el mismo objeto. Cerrar el popup no detiene.
//
// Forma del objeto guardado bajo STORAGE_KEYS.RUN:
//   {
//     active:      boolean,
//     claimed:     boolean,        // el frame top de Starkoms lo marcó al arrancar
//     startedAt, finishedAt,
//     finishReason?: 'done'|'cancelled'|'error'|'not-detected',
//     errorReason?: string,
//     config: { bodega, stockValue, verifyExistence, dryRun, limit },
//     total:  number,              // se fija tras recolectar la cola
//     currentIndex: number,
//     items: [{
//       orderNumber, reference,
//       status: STATUS, step?, detail?, reason?,
//       products?: [{ sku, action: 'has-stock'|'stocked'|'not-found'|'error', stock?, reason? }],
//     }],
//     log: [{ ts, level: 'info'|'warn'|'error', message }],  (cap LOG_CAP)
//   }

import { LOG_CAP, STORAGE_KEYS } from './constants.js';
import { createRunStore, createPersistedValue } from '../../shared/run-store/index.js';

// Run store compartido con coalescing de escrituras (ver shared/run-store).
const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });
export const { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun } = store;

/**
 * Construye un run nuevo. Las órdenes se autodetectan en el content script tras
 * filtrar, así que `items` arranca vacío y el runner lo completa con
 * `setItems()` una vez recolectada la cola.
 */
export function makeRun({ config, message }) {
  return {
    active: true,
    claimed: false,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    errorReason: null,
    config,
    total: 0,
    currentIndex: -1,
    items: [],
    log: [{ ts: Date.now(), level: 'info', message: message || 'Run iniciado' }],
  };
}

const lastConfig = createPersistedValue(STORAGE_KEYS.LAST_CONFIG, null);
export const getLastConfig = lastConfig.get;
export const setLastConfig = lastConfig.set;
