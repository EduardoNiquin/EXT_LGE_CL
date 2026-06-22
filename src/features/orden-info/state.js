// Estado de la búsqueda de órdenes. La búsqueda cruza una navegación full-page
// (popup → listing → click fila → order view), por lo que la coordinación vive
// en chrome.storage.local, igual que cupones/lead-times.
//
// Forma del objeto bajo STORAGE_KEYS.SEARCH:
//   {
//     active: boolean,
//     orderNumber: string,
//     status: SEARCH_STATUS,
//     startedAt, finishedAt,
//     error?: string,
//   }

import { STORAGE_KEYS } from './constants.js';
import { createRunStore, createPersistedValue } from '../../shared/run-store/index.js';

// El estado de búsqueda es un "run store" con nombres propios (search en vez de
// run). Reusamos el factory por su read-modify-write coalescido; ver shared/run-store.
const store = createRunStore({ key: STORAGE_KEYS.SEARCH });
export const getSearch = store.getRun;
export const setSearch = store.setRun;
export const clearSearch = store.clearRun;
export const updateSearch = store.updateRun;

const lastQuery = createPersistedValue(STORAGE_KEYS.LAST_QUERY, '');
export const getLastQuery = lastQuery.get;
export const setLastQuery = lastQuery.set;
