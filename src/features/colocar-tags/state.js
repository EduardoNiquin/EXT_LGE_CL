// Persistencia del estado de ejecución de "Colocar TAGs".
//
// ANTES: el popup abría un `chrome.runtime.connect` port y el content script
// corría el batch atado a ese port. Si el popup se cerraba (clic afuera, cambio
// de ventana), el port se desconectaba y el proceso se ABORTABA a mitad.
//
// AHORA: toda la coordinación ocurre vía chrome.storage.local (igual que
// lead-times y cupones). El popup escribe el run; el content script lo detecta
// (init + storage.onChanged), ejecuta el batch en su propio contexto (que vive
// mientras la pestaña esté abierta) y publica progreso/logs en el mismo objeto.
// Cerrar el popup ya NO detiene el proceso; al reabrirlo se ve el avance/result.
//
// Forma del objeto guardado bajo STORAGE_KEYS.RUN:
//   {
//     active:      boolean,        // true mientras hay un run en curso
//     kind:        RUN_KIND,       // delivery | delivery-remove | product | offer
//     claimed:     boolean,        // el frame que detecta MIM lo marcó al arrancar
//     startedAt, finishedAt,       // timestamps
//     finishReason?: 'done'|'cancelled'|'error'|'not-detected',
//     errorReason?: string,
//     config:      object,         // config específica del kind (skus, etc.)
//     total:       number,
//     items: [{ sku, index, status: STATUS, step?, detail?, reason? }],
//     log: [{ ts, level: 'info'|'warn'|'error', message }],  (cap LOG_CAP)
//   }

import { LOG_CAP, STORAGE_KEYS } from './constants.js';
import { createRunStore } from '../../shared/run-store/index.js';

// Run store compartido (getRun/setRun/clearRun/updateRun/appendLog/subscribeToRun)
// con coalescing de escrituras — ver shared/run-store. El runner dispara
// setItem/appendLog fire-and-forget; el factory los agrupa en lotes.
const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });
export const { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun } = store;

/**
 * Construye un run nuevo a partir de un kind, su config y la lista de SKUs.
 * No lo persiste — el caller hace setRun().
 */
export function makeRun({ kind, config, skus, message }) {
  const list = Array.isArray(skus) ? skus : [];
  return {
    active: true,
    kind,
    claimed: false,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    config,
    total: list.length,
    items: list.map((sku, index) => ({ sku, index, status: 'pending', step: null })),
    log: [{ ts: Date.now(), level: 'info', message: message || `Run iniciado — ${list.length} SKU(s)` }],
  };
}
