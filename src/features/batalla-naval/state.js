// Estado persistido del feature "GATO".
//
// - run (chrome.storage.local["gato:run"]): que esta viendo el usuario, para
//   poder restaurar la vista al reabrir el popup. La verdad de la partida vive
//   en Firebase; esto solo guarda el "puntero" + fase.
// - draft (chrome.storage.local["gato:draft"]): el nombre recordado.
// - uid: identidad estable del jugador (localStorage, sincrona).

import { createRunStore, createPersistedValue } from '../../shared/run-store/index.js';
import { STORAGE_KEYS, UID_KEY, PHASE, LOG_CAP } from './constants.js';

const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });

export const {
  getRun,
  setRun,
  clearRun,
  updateRun,
  appendLog,
  subscribeToRun,
} = store;

const draft = createPersistedValue(STORAGE_KEYS.DRAFT, { name: '' });
export const getDraft = draft.get;
export const setDraft = draft.set;

/** Estado inicial de la vista. */
export function makeRun(name, uid) {
  return {
    phase: PHASE.IDLE,
    name: name || '',
    uid,
    gameId: null,
    role: null,
    opponentName: null,
    startedAt: Date.now(),
    log: [],
  };
}

/**
 * uid estable del jugador. Se genera una vez y se persiste en localStorage
 * (sincrono, mismo origin para popup y sidepanel). Base36 + guion: seguro como
 * key de Firebase (sin `.`/`#`/`$`/`[`/`]`/`/`).
 */
export function getUid() {
  try {
    let v = localStorage.getItem(UID_KEY);
    if (!v) {
      v = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(UID_KEY, v);
    }
    return v;
  } catch {
    // localStorage no disponible: uid efimero (no persiste, pero funciona).
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
