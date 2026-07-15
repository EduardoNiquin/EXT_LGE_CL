// Orquestador de "Devoluciones SellerCenter" en el service worker.
//
// Corre en segundo plano (sobrevive al cierre del popup). El panel sube los
// archivos y escribe el `run`; acá:
//   1. Sondeamos GET /orders cada ~3 s mientras alguna orden esté `procesando`.
//   2. Cuando una orden llega a `listo`, bajamos su manifiesto y cada archivo
//      con chrome.downloads (sin diálogo), esperando a que cada descarga termine
//      de verdad (chrome.downloads.onChanged → state.complete).
//   3. Sólo cuando TODO se escribió llamamos a POST /saved (destructivo: el
//      servidor borra los archivos de la orden).
//   4. Si el guardado local falla → POST /cancel con motivo LOCAL_SAVE_ERROR.
//
// URL.createObjectURL no existe en el service worker MV3, así que los blobs se
// convierten a `data:` URL (mismo enfoque que e-promoters/informe.js). Los PDFs
// del módulo pesan pocos MB, así que es aceptable.
//
// Un loop interno con setTimeout mantiene la cadencia de 3 s mientras el SW está
// vivo; una chrome.alarms de respaldo (mín. 30 s) lo resucita si Chrome lo
// duerme en mitad de un run.

import {
  ALARM_PERIOD_MIN,
  DEVO_ALARM,
  DEVO_FINISH,
  DEVO_MESSAGES,
  DOWNLOAD_SUBDIR,
  LOCAL_SAVE_ERROR,
  POLL_INTERVAL_MS,
} from '../constants.js';
import {
  appendLog,
  getPairing,
  getRun,
  mergeServerOrders,
  updateRun,
} from '../state.js';
import { cancelOrder, getFile, getManifest, getOrders, markSaved } from '../api.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('devoluciones-seller');

let ticking = false;         // evita ticks solapados
let timer = null;            // setTimeout del loop interno
const savingIds = new Set(); // órdenes cuyo guardado está en curso (en memoria)

// -----------------------------------------------------------------------------
// Descarga a disco
// -----------------------------------------------------------------------------

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  const type = blob.type || 'application/octet-stream';
  return `data:${type};base64,${btoa(binary)}`;
}

function startDownload(url, filename) {
  return new Promise((resolve, reject) => {
    try {
      chrome.downloads.download(
        { url, filename, conflictAction: 'overwrite', saveAs: false },
        (downloadId) => {
          if (chrome.runtime.lastError || downloadId == null) {
            reject(new Error(chrome.runtime.lastError?.message || 'chrome.downloads falló'));
          } else {
            resolve(downloadId);
          }
        },
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(toMessage(err)));
    }
  });
}

// download() resuelve al EMPEZAR; esperamos a que el archivo esté 'complete'.
function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    const listener = (delta) => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete') { cleanup(); resolve(); }
      else if (delta.state.current === 'interrupted') { cleanup(); reject(new Error('descarga interrumpida')); }
    };
    function cleanup() { chrome.downloads.onChanged.removeListener(listener); }
    chrome.downloads.onChanged.addListener(listener);
  });
}

// -----------------------------------------------------------------------------
// Guardado de una orden
// -----------------------------------------------------------------------------

async function saveOrder(base, token, orden) {
  const id = orden.id;
  if (savingIds.has(id)) return;
  savingIds.add(id);
  await updateRun((run) => patchOrden(run, id, { guardando: true, saveError: null }));

  try {
    const manifestRes = await getManifest(base, token, id);
    if (manifestRes.status === 409) {
      // Aún no está lista pese al flag: reintentar en el próximo tick.
      await updateRun((run) => patchOrden(run, id, { guardando: false }));
      return;
    }
    if (!manifestRes.ok) throw new Error(manifestRes.error || 'No se pudo leer el manifiesto');

    const manifest = manifestRes.data || {};
    const carpeta = manifest.carpeta || String(orden.orden || id);
    const archivos = Array.isArray(manifest.archivos) ? manifest.archivos : [];
    if (!archivos.length) throw new Error('El manifiesto no trae archivos');

    for (const archivo of archivos) {
      const res = await getFile(base, token, id, archivo.path);
      if (!res.ok) throw new Error(`No se pudo bajar ${archivo.path} (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = await blobToDataUrl(blob);
      const filename = `${DOWNLOAD_SUBDIR}/${carpeta}/${archivo.path}`;
      const downloadId = await startDownload(url, filename);
      await waitForDownload(downloadId);
    }

    // Todo escrito: recién ahora cerramos la orden (el servidor borra archivos).
    const savedRes = await markSaved(base, token, id);
    if (!savedRes.ok) throw new Error(savedRes.error || 'No se pudo confirmar el guardado');

    await updateRun((run) => patchOrden(run, id, {
      guardando: false,
      guardado: true,
      procesando: false,
      listo: false,
      final: true,
      estado_label: 'Guardado',
      progreso: 100,
    }));
    await appendLog({ level: 'info', message: `Orden ${orden.orden}: guardada (${archivos.length} archivo/s).` });
    log.info('orden guardada', { id, orden: orden.orden });
  } catch (err) {
    const reason = toMessage(err);
    // Avisar al servidor para que la web lo explique al usuario.
    try {
      await cancelOrder(base, token, id, { motivo: LOCAL_SAVE_ERROR, mensaje: reason });
    } catch { /* best-effort */ }
    await updateRun((run) => patchOrden(run, id, {
      guardando: false,
      guardado: false,
      saveError: reason,
      final: true,
      estado_label: 'Error al guardar',
    }));
    await appendLog({ level: 'error', message: `Orden ${orden.orden}: error al guardar — ${reason}` });
    log.error('guardado local falló', err instanceof Error ? err : new Error(reason));
  } finally {
    savingIds.delete(id);
  }
}

function patchOrden(run, id, patch) {
  if (!run) return run;
  return {
    ...run,
    ordenes: (run.ordenes || []).map((o) => (o.id === id ? { ...o, ...patch } : o)),
  };
}

// -----------------------------------------------------------------------------
// Tick de polling
// -----------------------------------------------------------------------------

function isDone(orden) {
  return Boolean(orden.guardado || orden.saveError || (orden.final && !orden.listo));
}

async function finish(reason, errorReason = null) {
  clearTimer();
  await stopAlarm();
  await updateRun((run) => (run ? {
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: reason,
    errorReason,
  } : run));
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const run = await getRun();
    if (!run || !run.active) { clearTimer(); await stopAlarm(); return; }

    const pairing = await getPairing();
    const base = run.base || pairing?.base;
    const token = pairing?.token;
    if (!base || !token) {
      await appendLog({ level: 'error', message: 'Sin emparejamiento: abre/recarga la web o pega el código.' });
      await finish(DEVO_FINISH.UNPAIRED, 'Sin token de emparejamiento');
      return;
    }

    // 1. Sondeo.
    const ordersRes = await getOrders(base, token);
    if (ordersRes.status === 401) {
      await appendLog({ level: 'error', message: 'Token caducado (401): vuelve a emparejar.' });
      await finish(DEVO_FINISH.UNPAIRED, 'Token caducado (401)');
      return;
    }
    if (ordersRes.ok) {
      const serverOrdenes = Array.isArray(ordersRes.data?.ordenes) ? ordersRes.data.ordenes : [];
      await updateRun((r) => (r ? { ...r, ordenes: mergeServerOrders(r.ordenes, serverOrdenes) } : r));
    } else {
      await appendLog({ level: 'warn', message: `Sondeo falló: ${ordersRes.error}` });
    }

    // 2. Lanzar guardados de las órdenes listas (fire-and-forget con guarda).
    const fresh = await getRun();
    for (const orden of fresh?.ordenes || []) {
      if (orden.listo && !orden.guardado && !orden.saveError && !savingIds.has(orden.id)) {
        saveOrder(base, token, orden).catch((err) => log.error('saveOrder', new Error(toMessage(err))));
      }
    }

    // 3. ¿Terminó todo?
    const all = fresh?.ordenes || [];
    const pending = all.filter((o) => !isDone(o));
    if (all.length && pending.length === 0 && savingIds.size === 0) {
      const conError = all.some((o) => o.saveError || o.error_code);
      await appendLog({ level: conError ? 'warn' : 'info', message: conError ? 'Terminado con incidencias.' : 'Todas las órdenes guardadas.' });
      await finish(conError ? DEVO_FINISH.ERROR : DEVO_FINISH.DONE);
      return;
    }

    scheduleNext();
  } catch (err) {
    log.error('tick', err instanceof Error ? err : new Error(toMessage(err)));
    scheduleNext();
  } finally {
    ticking = false;
  }
}

function scheduleNext() {
  clearTimer();
  timer = setTimeout(() => { timer = null; tick(); }, POLL_INTERVAL_MS);
}

function clearTimer() {
  if (timer != null) { clearTimeout(timer); timer = null; }
}

// -----------------------------------------------------------------------------
// Alarma de respaldo (resucita el SW)
// -----------------------------------------------------------------------------

function ensureAlarm() {
  try { chrome.alarms.create(DEVO_ALARM, { periodInMinutes: ALARM_PERIOD_MIN }); } catch { /* no-op */ }
}

async function stopAlarm() {
  try { await chrome.alarms.clear(DEVO_ALARM); } catch { /* no-op */ }
}

// -----------------------------------------------------------------------------
// Control
// -----------------------------------------------------------------------------

async function start() {
  const run = await getRun();
  if (!run || !run.active) return;
  ensureAlarm();
  await appendLog({ level: 'info', message: 'Procesando en segundo plano…' });
  tick();
}

async function cancel() {
  clearTimer();
  await stopAlarm();
  await updateRun((run) => (run ? {
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: DEVO_FINISH.CANCELLED,
  } : run));
  await appendLog({ level: 'warn', message: 'Cancelado por el usuario.' });
  log.info('run cancelado');
}

// Se llama una vez desde el service worker.
export function wireDevolucionesBackground() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === DEVO_MESSAGES.START) {
      start().catch((err) => log.error('start', new Error(toMessage(err))));
      sendResponse({ ok: true, started: true });
      return false;
    }
    if (msg?.type === DEVO_MESSAGES.CANCEL) {
      cancel().catch((err) => log.error('cancel', new Error(toMessage(err))));
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  // Respaldo: si el SW despierta por la alarma y hay un run activo, reanuda.
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== DEVO_ALARM) return;
    getRun().then((run) => {
      if (run?.active) tick();
      else stopAlarm();
    }).catch(() => { /* no-op */ });
  });

  // Al (re)arrancar el SW, reconciliar por si quedó un run activo.
  getRun().then((run) => {
    if (run?.active) { ensureAlarm(); tick(); }
  }).catch(() => { /* no-op */ });
}
