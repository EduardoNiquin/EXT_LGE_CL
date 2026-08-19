import { STORAGE_KEYS, LOG_CAP } from './constants.js';
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
