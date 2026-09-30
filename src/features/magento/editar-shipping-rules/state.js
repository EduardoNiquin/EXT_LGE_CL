import { createPersistedValue, createRunStore } from '../../../shared/run-store/index.js';
import { ACTION, HISTORY_CAP, ITEM_STATUS, LOG_CAP, RUN_PHASE, STORAGE_KEYS } from './constants.js';

const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });

export const {
  getRun,
  setRun,
  clearRun,
  updateRun,
  appendLog,
  subscribeToRun,
} = store;

// Ultimo catalogo leido: `{ loadedAt, adminBase, listingUrl, rules: [slimRule] }`.
const catalog = createPersistedValue(STORAGE_KEYS.CATALOG, null);
export const getCatalog = catalog.get;
export const setCatalog = catalog.set;

// Corridas terminadas, la mas nueva primero. Es el registro para poder volver
// una rule a como estaba: cada item guarda su estado antes y despues.
const history = createPersistedValue(STORAGE_KEYS.HISTORY, []);
export const getHistory = async () => {
  const value = await history.get();
  return Array.isArray(value) ? value : [];
};
export const setHistory = history.set;

export async function pushHistory(run) {
  const entry = historyEntryOf(run);
  const list = (await getHistory()).filter((item) => item.id !== entry.id);
  await setHistory([entry, ...list].slice(0, HISTORY_CAP));
  return entry;
}

/** Lo que se guarda de una corrida: sin el log, que no hace falta para revertir. */
export function historyEntryOf(run) {
  return {
    id: run.id,
    action: run.action,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    finishReason: run.finishReason,
    revertOf: run.revertOf || null,
    items: (run.items || []).map((item) => ({
      id: item.id,
      nameFe: item.nameFe,
      nameBe: item.nameBe,
      carrier: item.carrier,
      editHref: item.editHref,
      target: item.target,
      before: item.before,
      after: item.after,
      status: item.status,
      error: item.error,
      verified: item.verified,
      changedAt: item.changedAt,
    })),
  };
}

export function makeRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Forma inicial del run.
 * @param {object} o
 * @param {'activate'|'deactivate'|'revert'} o.action
 * @param {Array} o.rules       reglas elegidas (slimRule). En una reversion cada
 *                              una trae su propio `target`.
 * @param {string} o.listingUrl listado con su key, para volver si hace falta.
 * @param {string} [o.revertOf] id de la corrida que se revierte.
 */
export function makeRun({ action, rules, listingUrl, revertOf = null }) {
  const targetOf = (rule) => {
    if (typeof rule.target === 'boolean') return rule.target;
    return action === ACTION.ACTIVATE;
  };
  return {
    id: makeRunId(),
    active: true,
    phase: RUN_PHASE.RUNNING,
    action,
    revertOf,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    error: '',
    listingUrl,
    currentIndex: -1,
    redirects: 0,
    items: rules.map((rule) => ({
      id: rule.id,
      nameFe: rule.nameFe,
      nameBe: rule.nameBe,
      carrier: rule.carrier,
      editHref: rule.editHref,
      // Estado que mostraba el listado al elegirla; el real se lee en el
      // formulario (`before`) justo antes de tocarlo.
      catalogActive: typeof rule.isActive === 'boolean' ? rule.isActive : null,
      target: targetOf(rule),
      before: null,
      after: null,
      status: ITEM_STATUS.PENDING,
      error: '',
      note: '',
      verified: null,
      changedAt: null,
    })),
    log: [],
  };
}
