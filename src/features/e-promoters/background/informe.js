// Orquestador de "Informe ordenes" en el service worker.
//
// Corre en segundo plano (sobrevive al cierre del popup): pide los datos a la
// API o recibe el CSV cargado por el usuario, aplica el pipeline (rango de
// fechas + estados a recuperar + dedupe de canceladas), genera el CSV recortado
// y dispara la descarga automatica. El estado/fases se publican en el run
// (storage.local) para que el popup muestre en vivo "que esta haciendo".

import {
  API,
  FINISH_REASON,
  MESSAGES,
  OUTPUT_COLUMNS,
  OUTPUT_FILENAME_PREFIX,
  PHASE,
  PHASE_LABEL,
  SOURCE,
} from '../constants.js';
import {
  appendLog,
  clearResult,
  getRun,
  makeRun,
  setResult,
  setRun,
  updateRun,
} from '../state.js';
import { processReport } from '../shared/report.js';
import { buildCsv, parseCsvRecords } from '../shared/csv.js';
import { toMessage, isAbortError } from '../../../shared/errors/index.js';
import { logger } from '../../../shared/utils/logger.js';

const log = logger('e-promoters');

let running = false;
let cancelled = false;
let controller = null;

// Error que se lanza al cancelar para cortar el flujo de inmediato.
class CancelledError extends Error {
  constructor() { super('Cancelado por el usuario'); this.name = 'CancelledError'; }
}

function throwIfCancelled() {
  if (cancelled) throw new CancelledError();
}

async function setPhase(phase, extra = {}) {
  await updateRun((run) => ({ ...run, phase, ...extra }));
  log.debug('fase', { phase, ...extra });
}

// -----------------------------------------------------------------------------
// API
// -----------------------------------------------------------------------------

/** Suma/resta dias a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD. */
function shiftDate(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildApiUrl(from, to) {
  // El server filtra por order_date (otra zona horaria); pedimos una ventana mas
  // ancha (+-WINDOW_PAD_DAYS) y el filtro exacto por "Local Time" lo hace el
  // cliente (processReport).
  const serverFrom = from ? shiftDate(from, -API.WINDOW_PAD_DAYS) : '';
  const serverTo = to ? shiftDate(to, API.WINDOW_PAD_DAYS) : '';
  const params = new URLSearchParams();
  if (serverFrom) params.set('from', serverFrom);
  if (serverTo) params.set('to', `${serverTo}T23:59:59`);
  params.set('format', API.FORMAT);
  params.set('limit', String(API.LIMIT));
  return `${API.BASE_URL}?${params.toString()}`;
}

async function fetchFromApi(from, to, signal) {
  const url = buildApiUrl(from, to);
  log.info('pidiendo datos a la API', { url });
  const res = await fetch(url, {
    method: 'GET',
    headers: { [API.TOKEN_HEADER]: API.TOKEN, Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new Error(`La API respondio ${res.status} ${res.statusText || ''}`.trim());
  }
  const json = await res.json();
  const records = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
  return records;
}

// -----------------------------------------------------------------------------
// Descarga del CSV generado
// -----------------------------------------------------------------------------

function base64FromString(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function triggerDownload(csv, filename) {
  const url = `data:text/csv;charset=utf-8;base64,${base64FromString(csv)}`;
  return new Promise((resolve) => {
    try {
      chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
        if (chrome.runtime.lastError) {
          log.warn('descarga automatica fallo', { error: chrome.runtime.lastError.message });
        }
        resolve(downloadId);
      });
    } catch (err) {
      log.warn('descarga automatica fallo', { error: toMessage(err) });
      resolve(null);
    }
  });
}

// -----------------------------------------------------------------------------
// Corrida
// -----------------------------------------------------------------------------

/**
 * @param {object} payload
 * @param {'api'|'csv'} payload.source
 * @param {string} payload.from  YYYY-MM-DD
 * @param {string} payload.to    YYYY-MM-DD
 * @param {string} [payload.text]  contenido CSV (cuando source === 'csv')
 */
export async function runInforme(payload) {
  if (running) {
    const run = await getRun();
    return { ok: false, reason: 'Ya hay un proceso en curso.', run };
  }
  running = true;
  cancelled = false;
  controller = new AbortController();

  const { source, from, to, text } = payload || {};

  try {
    await clearResult();
    await setRun(makeRun({
      source,
      from,
      to,
      message: `Corrida iniciada — origen ${source === SOURCE.API ? 'API' : 'CSV'}, rango ${from || '—'} a ${to || '—'}`,
    }));

    // 1. Obtener registros (API o CSV cargado).
    let records;
    if (source === SOURCE.API) {
      await setPhase(PHASE.DOWNLOADING);
      await appendLog({ level: 'info', message: PHASE_LABEL[PHASE.DOWNLOADING] });
      records = await fetchFromApi(from, to, controller.signal);
      throwIfCancelled();
      await appendLog({ level: 'info', message: `Descargadas ${records.length} fila(s) de la API` });
    } else {
      await setPhase(PHASE.PARSING);
      await appendLog({ level: 'info', message: PHASE_LABEL[PHASE.PARSING] });
      // El CSV se parsea aca (en el SW). El popup ya leyo el archivo a texto.
      const parsed = parseCsvRecords(text || '');
      records = parsed.records;
      throwIfCancelled();
      await appendLog({ level: 'info', message: `Leidas ${records.length} fila(s) del archivo` });
    }

    if (!records.length) {
      throw new Error('El origen no devolvio filas. Revisa el rango de fechas o el archivo.');
    }

    // 2. Filtros + dedupe (pipeline puro).
    await setPhase(PHASE.FILTERING);
    await appendLog({ level: 'info', message: PHASE_LABEL[PHASE.FILTERING] });
    throwIfCancelled();
    const { records: out, stats } = processReport(records, { from, to });
    await setPhase(PHASE.DEDUPING, { stats });
    await appendLog({
      level: 'info',
      message: `Filtrado: ${stats.afterDate} en rango → ${stats.afterStatus} por estado → ${stats.removedDuplicates} canceladas duplicadas quitadas → ${stats.finalRows} finales`,
    });

    if (!out.length) {
      await finishOk(stats, null);
      await appendLog({ level: 'warn', message: 'No quedaron filas tras los filtros. No se genero archivo.' });
      return { ok: true, empty: true, stats };
    }

    // 3. Generar CSV.
    await setPhase(PHASE.BUILDING, { stats });
    const csv = buildCsv(out, OUTPUT_COLUMNS);
    throwIfCancelled();

    // 4. Guardar resultado + descargar.
    const filename = `${OUTPUT_FILENAME_PREFIX}-${from || 'todo'}_${to || 'todo'}.csv`;
    const bytes = new TextEncoder().encode(csv).length;
    await setResult({ filename, csv });
    await setPhase(PHASE.SAVING, {
      stats,
      result: { filename, rows: out.length, bytes, ready: true },
    });
    await appendLog({ level: 'info', message: `CSV generado (${out.length} filas). Descargando…` });
    await triggerDownload(csv, filename);

    await finishOk(stats, { filename, rows: out.length, bytes, ready: true });
    log.info('corrida completa', { finalRows: out.length });
    return { ok: true, stats };
  } catch (err) {
    if (err instanceof CancelledError || isAbortError(err, controller?.signal)) {
      await updateRun((run) => ({
        ...run,
        active: false,
        finishedAt: Date.now(),
        finishReason: FINISH_REASON.CANCELLED,
        phase: PHASE.IDLE,
      }));
      await appendLog({ level: 'warn', message: 'Cancelado por el usuario.' });
      log.info('corrida cancelada');
      return { ok: false, cancelled: true };
    }
    const reason = toMessage(err);
    await updateRun((run) => ({
      ...run,
      active: false,
      finishedAt: Date.now(),
      finishReason: FINISH_REASON.ERROR,
      errorReason: reason,
      phase: PHASE.IDLE,
    }));
    await appendLog({ level: 'error', message: `Error: ${reason}` });
    log.error('corrida fallo', err instanceof Error ? err : new Error(reason));
    return { ok: false, reason };
  } finally {
    running = false;
    controller = null;
  }
}

async function finishOk(stats, result) {
  await updateRun((run) => ({
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: FINISH_REASON.DONE,
    phase: PHASE.DONE,
    stats,
    result,
  }));
}

export function cancelInforme() {
  cancelled = true;
  try { controller?.abort(); } catch { /* no-op */ }
}

// Se llama una vez desde el service worker.
export function wireInformeBackground() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === MESSAGES.START) {
      // Arranca en segundo plano; responde ack de inmediato (el progreso va por
      // storage). Asi el popup puede cerrarse sin cortar el proceso.
      runInforme(msg.payload).catch((err) => log.error('runInforme', new Error(toMessage(err))));
      sendResponse({ ok: true, started: true });
      return false;
    }
    if (msg?.type === MESSAGES.CANCEL) {
      cancelInforme();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
}
