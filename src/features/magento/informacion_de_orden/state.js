import { createPersistedValue, createRunStore } from '../../../shared/run-store/index.js';
import {
  LOG_CAP,
  PART_SIZE_DEFAULT,
  RESULT_VERSION,
  RUN_PHASE,
  STORAGE_KEYS,
} from './constants.js';
import { getStorage, removeStorage, setStorage } from '../../../shared/storage/storage.js';
import { emptyStats } from './stats.js';

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

// Los registros capturados viven fuera del run: el run se reescribe en cada
// avance y arrastrar miles de filas en cada escritura lo haria inmanejable.
//
// Y fuera del INDICE, ademas: los registros se reparten en partes de `partSize`
// ordenes, una clave por parte. El indice (esta clave) solo lleva el mapa de las
// partes, asi que se puede reescribir en cada volcado sin pagar el tamano del
// resultado completo. Ver "El resultado en partes" en constants.js.
const result = createPersistedValue(STORAGE_KEYS.RESULT, null);

/** Clave de storage de la parte numero `index` (0-based). */
export const resultPartKey = (index) => `${STORAGE_KEYS.RESULT_PART}${index}`;

export const getResultIndexRaw = result.get;
export const setResultIndex = (index) => result.set(index);

/** Indice del resultado, ya normalizado (null si no hay nada capturado). */
export async function getResultIndex() {
  return normalizeResultIndex(await result.get());
}

/**
 * Indice guardado -> forma unica. Un resultado capturado ANTES de las partes
 * guardaba todos los registros dentro de esta misma clave: se presenta como una
 * parte unica que vive en la clave del indice, asi el popup y los comandos de
 * debug lo siguen mostrando y exportando sin ramas especiales.
 */
export function normalizeResultIndex(raw) {
  if (!raw || typeof raw !== 'object') return null;

  if (Array.isArray(raw.parts)) {
    const parts = raw.parts
      .filter(Boolean)
      .map((part, order) => ({
        index: Number.isFinite(part.index) ? part.index : order,
        key: part.key || resultPartKey(Number.isFinite(part.index) ? part.index : order),
        count: Number(part.count) || 0,
        first: part.first || '',
        last: part.last || '',
      }));
    return {
      version: raw.version || RESULT_VERSION,
      generatedAt: raw.generatedAt || 0,
      partSize: Number(raw.partSize) || PART_SIZE_DEFAULT,
      columns: Array.isArray(raw.columns) ? raw.columns : [],
      parts,
      total: Number(raw.total) || parts.reduce((sum, part) => sum + part.count, 0),
    };
  }

  const records = Array.isArray(raw.records) ? raw.records : [];
  return {
    version: 1,
    generatedAt: raw.generatedAt || 0,
    partSize: records.length || PART_SIZE_DEFAULT,
    columns: [],
    parts: records.length
      ? [{
        index: 0,
        key: STORAGE_KEYS.RESULT,
        count: records.length,
        first: records[0]?.incrementId || '',
        last: records[records.length - 1]?.incrementId || '',
      }]
      : [],
    total: records.length,
  };
}

/** Registros de una parte (acepta la entrada del indice, su clave o su numero). */
export async function readResultPart(part) {
  const key = typeof part === 'string'
    ? part
    : (part?.key || resultPartKey(Number(part?.index ?? part) || 0));
  const stored = await getStorage(key);
  return Array.isArray(stored?.records) ? stored.records : [];
}

export const writeResultPart = (index, records) => setStorage(resultPartKey(index), { records });

/**
 * Borra el indice y TODAS las claves de parte. Se barre un poco mas alla de lo
 * que dice el indice porque la parte se escribe antes que el indice: si la
 * pestana muere entre las dos escrituras queda una parte huerfana que ningun
 * indice menciona.
 */
export async function clearResult() {
  const index = await getResultIndex();
  const count = index?.parts?.length || 0;
  const keys = new Set();
  for (const part of index?.parts || []) {
    if (part.key && part.key !== STORAGE_KEYS.RESULT) keys.add(part.key);
  }
  for (let i = count; i < count + 4; i += 1) keys.add(resultPartKey(i));
  await Promise.all([...keys].map(removeStorage));
  await removeStorage(STORAGE_KEYS.RESULT);
}

export function subscribeToResult(callback) {
  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEYS.RESULT]) return;
    callback(changes[STORAGE_KEYS.RESULT].newValue || null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/**
 * Forma inicial del run. Solo lleva progreso: los datos de las ordenes van a
 * STORAGE_KEYS.RESULT.
 * @param {object} o
 * @param {object} o.config  { from, to, mode, orderNumbers[], concurrency, includeRaw }
 */
export function makeRun({ config }) {
  return {
    active: true,
    claimed: false,
    phase: RUN_PHASE.STARTING,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    error: '',
    config,
    endpoint: '',
    totalRecords: 0,
    total: 0, // unidades de trabajo (paginas o numeros de orden)
    doneCount: 0,
    okCount: 0,
    notFoundCount: 0,
    errorCount: 0,
    fetchStartedAt: null, // desde cuando se entran fichas (para el ritmo)
    stats: emptyStats(), // tiempos acumulados por ficha (stats.js)
    log: [{ ts: Date.now(), level: 'info', message: 'Preparando la captura de ordenes' }],
  };
}
