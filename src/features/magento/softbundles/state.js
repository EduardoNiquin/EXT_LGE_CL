import { createPersistedValue, createRunStore } from '../../../shared/run-store/index.js';
import {
  BUNDLE_STATUS,
  CHILD_STATUS,
  EXPORT_PHASE,
  LOG_CAP,
  RUN_PHASE,
  STORAGE_KEYS,
} from './constants.js';

const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });

export const {
  getRun,
  setRun,
  clearRun,
  updateRun,
  appendLog,
  subscribeToRun,
} = store;

const draft = createPersistedValue(STORAGE_KEYS.DRAFT, null);
export const getDraft = draft.get;
export const setDraft = draft.set;

// El export del listado completo es un trabajo aparte del de creacion: no
// navega, no toca formularios y se puede pedir con un run en curso detenido.
// Por eso vive en su propia clave y su propio store.
const exportStore = createRunStore({ key: STORAGE_KEYS.EXPORT, logCap: LOG_CAP });

export const getExport = exportStore.getRun;
export const setExport = exportStore.setRun;
export const clearExport = exportStore.clearRun;
export const updateExport = exportStore.updateRun;
export const appendExportLog = exportStore.appendLog;
export const subscribeToExport = exportStore.subscribeToRun;

/** Forma inicial del export. El CSV se guarda ya armado para poder re-bajarlo. */
export function makeExport() {
  return {
    active: true,
    phase: EXPORT_PHASE.STARTING,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    error: '',
    pages: 0,
    rules: 0,
    rows: 0,
    total: null,
    csv: '',
    log: [{ ts: Date.now(), level: 'info', message: 'Leyendo el listado de package rules...' }],
  };
}

/**
 * Forma inicial del run.
 * @param {object} o
 * @param {object} o.config      lo que pidio el usuario (campos del padre, del hijo y opciones).
 * @param {Array}  o.bundles     salida de `parseBundleLines`.
 * @param {string} o.listingUrl  listado desde donde arranca el recorrido.
 */
export function makeRun({ config, bundles, listingUrl }) {
  return {
    active: true,
    phase: RUN_PHASE.STARTING,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    error: '',
    config,
    listingUrl,
    currentIndex: -1,
    redirects: 0,
    items: bundles.map((bundle) => ({
      parentSku: bundle.parentSku,
      status: BUNDLE_STATUS.PENDING,
      skipReason: '',
      error: '',
      packageId: '',
      editUrl: '',
      checkedExisting: false,
      // Veces que se entro al formulario del padre por este bundle. Corta el
      // bucle si Magento lo devuelve sin explicar por que.
      attempts: 0,
      // Package rule que se mando a borrar (politica de duplicados en
      // "borrar"). Se anota antes de pulsar porque el borrado recarga la
      // pagina: es lo unico que sobrevive para saber que estabamos haciendo.
      pendingDelete: null,
      // Veces que se intento liberar el SKU borrando la regla que lo ocupaba.
      deleteAttempts: 0,
      children: bundle.children.map((child) => ({
        sku: child.sku,
        discountRate: child.discountRate,
        mainDiscountRate: child.mainDiscountRate,
        status: CHILD_STATUS.PENDING,
        error: '',
      })),
    })),
    log: [{
      ts: Date.now(),
      level: 'info',
      message: config?.dryRun
        ? 'Modo simulacion: se llenan los formularios sin guardar nada'
        : 'Preparando la creacion de soft bundles',
    }],
  };
}
