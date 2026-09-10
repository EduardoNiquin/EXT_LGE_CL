import { createPersistedValue, createRunStore } from '../../../shared/run-store/index.js';
import { BUNDLE_STATUS, CHILD_STATUS, LOG_CAP, RUN_PHASE, STORAGE_KEYS } from './constants.js';

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
