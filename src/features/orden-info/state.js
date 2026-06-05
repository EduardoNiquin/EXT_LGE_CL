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
import { getStorage, setStorage, removeStorage } from '../../shared/storage/storage.js';

export async function getSearch() {
  return (await getStorage(STORAGE_KEYS.SEARCH)) || null;
}

export async function setSearch(search) {
  return setStorage(STORAGE_KEYS.SEARCH, search);
}

export async function clearSearch() {
  return removeStorage(STORAGE_KEYS.SEARCH);
}

export async function updateSearch(updater) {
  const search = (await getSearch()) || null;
  if (!search) return null;
  const next = updater(search);
  await setSearch(next);
  return next;
}

export async function getLastQuery() {
  return (await getStorage(STORAGE_KEYS.LAST_QUERY)) || '';
}

export async function setLastQuery(query) {
  return setStorage(STORAGE_KEYS.LAST_QUERY, query);
}
