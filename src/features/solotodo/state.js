// Persistencia del estado de ejecución de "SoloTodo".
//
// Mismo modelo que starkoms/seller-center: la coordinación vive en
// chrome.storage.local. El popup arma el `run` (con la config de la categoría
// elegida y los pasos a ejecutar) y lo escribe; el content script (en la pestaña
// del backoffice de SoloTodo) lo reclama y ejecuta como un único flujo async
// continuo. El backoffice es una SPA React (MUI): el form se llena sin recargas,
// así que el proceso sobrevive al cierre del popup. Progreso/logs en el mismo obj.
//
// Forma del objeto guardado bajo STORAGE_KEYS.RUN:
//   {
//     active:  boolean,
//     claimed: boolean,            // el frame que detecta el form lo marcó
//     startedAt, finishedAt,
//     finishReason?: 'done'|'cancelled'|'error'|'not-detected',
//     errorReason?: string,
//     config: { categoryId, categoryLabel, category, currency, stores[],
//               countries[], filename, dryRun },
//     total: number,
//     currentIndex: number,
//     items: [{ key, label, status, detail?, reason? }],
//     log: [{ ts, level, message }],  (cap LOG_CAP)
//   }

import { LOG_CAP, STORAGE_KEYS, STATUS, STEP } from './constants.js';
import { createRunStore, createPersistedValue } from '../../shared/run-store/index.js';

const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });
export const { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun } = store;

/**
 * Construye la lista de pasos (items) a partir de la config de la categoría.
 * Cada item lleva su label ya resuelto para mostrar en el progreso.
 */
export function buildSteps(config) {
  return [
    { key: STEP.EXPORT,    label: 'Abrir exportación',                 status: STATUS.PENDING },
    { key: STEP.CATEGORIA, label: `Categoría → ${config.category}`,   status: STATUS.PENDING },
    { key: STEP.MONEDA,    label: `Moneda → ${config.currency}`,       status: STATUS.PENDING },
    { key: STEP.TIENDAS,   label: `Tiendas (${config.stores.length})`, status: STATUS.PENDING },
    { key: STEP.PAISES,    label: `Países → ${config.countries.join(', ')}`, status: STATUS.PENDING },
    { key: STEP.FILENAME,  label: `Nombre de archivo → ${config.filename}`, status: STATUS.PENDING },
    {
      key: STEP.GENERAR,
      label: config.dryRun ? 'Generar (omitido — simulación)' : 'Generar',
      status: STATUS.PENDING,
    },
  ];
}

/** Construye un run nuevo a partir de la config resuelta en el popup. */
export function makeRun({ config, message }) {
  const items = buildSteps(config);
  return {
    active: true,
    claimed: false,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    errorReason: null,
    config,
    total: items.length,
    currentIndex: -1,
    items,
    log: [{ ts: Date.now(), level: 'info', message: message || 'Run iniciado' }],
  };
}

// Borrador del formulario del popup (categoría elegida + modo simulación).
const draft = createPersistedValue(STORAGE_KEYS.DRAFT, null);
export const getDraft = draft.get;
export const setDraft = draft.set;
