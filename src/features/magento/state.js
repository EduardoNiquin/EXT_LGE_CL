import { DEFAULT_LISTING_URL, LOG_CAP, RUN_PHASE, STORAGE_KEYS } from './constants.js';
import { createRunStore } from '../../shared/run-store/index.js';

const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });

export const {
  getRun,
  setRun,
  clearRun,
  updateRun,
  appendLog,
  subscribeToRun,
} = store;

/** Forma inicial del run. Vive aca (no en el popup) igual que en el resto de features. */
export function makeRun({ listingUrl = DEFAULT_LISTING_URL } = {}) {
  return {
    active: true,
    phase: RUN_PHASE.STARTING,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    error: '',
    listingUrl,
    currentRuleIndex: -1,
    detailRedirects: 0,
    metrics: {
      discoveryMs: 0,
      detailMs: 0,
      regionalMs: 0,
      detailCount: 0,
      navigationCount: 1,
    },
    items: [],
    log: [{ ts: Date.now(), level: 'info', message: 'Abriendo Global Shipping Rules' }],
  };
}
