// Estado de "Crear Promo-Id".
//
// Una corrida = una promo. El popup guarda el run (datos + lista de SKUs tal
// cual) y se lo entrega a la pestana con MESSAGES.START; el frame que tiene la
// pantalla busca los SKUs en el catalogo, arma la promo con los que existen y
// publica el avance aqui. Cerrar el popup no corta nada.
//
// Forma del run (STORAGE_KEYS.RUN):
//   {
//     id, active, phase: RUN_PHASE, startedAt, finishedAt, heartbeatAt,
//     finishReason?: FINISH_REASON, error?: string, cancelRequested?: boolean, saving?: boolean,
//     config: { title, tag, bodyCopy, startDate, endDate, displayDate, reviewUse, hiddenUse, dryRun },
//     skus: string[], mainSkus: string[], categoryMode,
//     items: [{ sku, status: SKU_STATUS, salesModel?, modelId?, rows?, note? }],   // uno por SKU pegado
//     models: [{ modelId, sku, salesModel, modelName, rows: [...] }],               // los que se agregan
//     mainModelIds: string[], totalRows, addedRows,
//     promotionId?: string, marked?: boolean, simulated?: boolean,
//     log: [{ ts, level, message }],
//   }

import { LOG_CAP, RUN_PHASE, SKU_STATUS, STORAGE_KEYS } from './constants.js';
import { createPersistedValue, createRunStore } from '../../shared/run-store/index.js';

const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });
export const { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun } = store;

const draft = createPersistedValue(STORAGE_KEYS.DRAFT, null);
export const getDraft = draft.get;
export const setDraft = draft.set;

export function makeRun({ config, skus, mainSkus = [], categoryMode }) {
  const now = Date.now();
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    active: true,
    phase: RUN_PHASE.RESOLVING,
    startedAt: now,
    finishedAt: null,
    heartbeatAt: now,
    finishReason: null,
    error: null,
    cancelRequested: false,
    saving: false,
    config,
    skus,
    mainSkus,
    categoryMode,
    items: skus.map((sku) => ({ sku, status: SKU_STATUS.PENDING })),
    models: [],
    mainModelIds: [],
    totalRows: 0,
    addedRows: 0,
    promotionId: null,
    marked: false,
    simulated: false,
    log: [{ ts: now, level: 'info', message: `Corrida iniciada: "${config.title}", ${skus.length} SKU(s)${config.dryRun ? ' (simulacion)' : ''}` }],
  };
}
