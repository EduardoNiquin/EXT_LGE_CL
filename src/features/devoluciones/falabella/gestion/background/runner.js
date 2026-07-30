// Orquestador de la gestion automatica de devoluciones (Falabella).
//
// Corre en el service worker, que es quien guarda la maquina de estados: el
// flujo cruza navegaciones de pagina (listado -> formulario) y el content script
// muere en cada una, asi que no puede recordar nada por si mismo. En cada carga
// el content pregunta "¿que gestiono aca?" y el SW le responde con el job y su
// fase.
//
// Ciclo de un job:
//   1. claim contra la API del modulo (PENDIENTE -> EN_PROCESO). Si otra
//      instancia se adelanto, la API devuelve 409 y lo saltamos.
//   2. Abrimos/reutilizamos UNA pestana en el listado de devoluciones (fase
//      BUSCAR). El content busca la orden.
//   3. Si aparece: pulsa "No, rechazar" -> fase APELAR -> rellena y envia la
//      apelacion -> resultado OK.
//      Si no aparece: fase TICKET -> llevamos la pestana a ayudaseller -> el
//      content levanta el ticket -> resultado TICKET.
//   4. Reportamos el resultado a la API (ahi la web del usuario lo muestra y
//      libera los archivos del servidor) y pasamos al siguiente job.
//
// Los PDF se descargan de la API en el momento de subirlos y viajan al content
// como base64 (chrome.runtime no serializa File/Blob). No se guardan en storage
// ni en disco: son evidencias de devoluciones.

import {
  ALARM_PERIOD_MIN,
  FASE,
  GESTION_ALARM,
  GESTION_MESSAGES,
  JOB_TIMEOUT_MS,
  RESULTADO,
  RETURNS_URL,
} from '../constants.js';
import {
  appendLog,
  findJob,
  getRun,
  isJobDone,
  nextPendingJob,
  patchJob,
  updateRun,
} from '../state.js';
import { claimGestion, getFile, getManifest, reportGestion } from '../../api.js';
import { getPairing } from '../../state.js';
import { CONTEXTOS, fijarContextoDeTraza, traza, trazaError, trazaInfo } from '../../../trace.js';
import { toMessage } from '../../../../../shared/errors/index.js';
import { logger } from '../../../../../shared/utils/logger.js';

const log = logger('devoluciones-gestion');

let advancing = false; // evita dos avances simultaneos de la cola

// -----------------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------------

async function credentials(run) {
  const pairing = await getPairing();
  const base = run?.base || pairing?.base;
  const token = pairing?.token;
  return { base, token };
}

/** Base64 de un Blob sin reventar la pila (el SW no tiene FileReader). */
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Deja la pestana de trabajo en la URL pedida (la crea si hace falta). */
async function openTab(run, url) {
  if (run?.tabId != null) {
    try {
      await chrome.tabs.update(run.tabId, { url, active: true });
      return run.tabId;
    } catch {
      // La pestana ya no existe: se crea una nueva mas abajo.
    }
  }
  const tab = await chrome.tabs.create({ url, active: true });
  await updateRun((r) => (r ? { ...r, tabId: tab.id } : r));
  return tab.id;
}

// -----------------------------------------------------------------------------
// Avance de la cola
// -----------------------------------------------------------------------------

/**
 * Toma el siguiente job pendiente, lo reclama en la API y lleva la pestana al
 * listado de devoluciones. Si no queda ninguno, cierra el run.
 */
async function advance() {
  if (advancing) return;
  advancing = true;
  try {
    const run = await getRun();
    if (!run?.active) return;

    const job = nextPendingJob(run);
    if (!job) {
      const conError = (run.jobs || []).some((j) => j.resultado === RESULTADO.ERROR);
      await appendLog({
        level: conError ? 'warn' : 'info',
        message: conError ? 'Gestion terminada con incidencias.' : 'Todas las devoluciones gestionadas.',
      });
      await finish(conError ? 'error' : 'done');
      return;
    }

    const { base, token } = await credentials(run);
    if (!base || !token) {
      await appendLog({ level: 'error', message: 'Sin emparejamiento: abre o recarga la web del modulo.' });
      await finish('unpaired', 'Sin token de emparejamiento');
      return;
    }

    // 1. Reclamar. Un 409 significa que otro cliente ya se la llevo: no es un
    //    fallo de esta orden, se salta sin marcarla como error propio.
    const claim = await claimGestion(base, token, job.id);
    traza('runner', 'Respuesta del claim', { orden: job.orden, status: claim.status, ok: claim.ok });

    if (claim.status === 409) {
      await appendLog({ level: 'warn', message: `Orden ${job.orden}: ya la estaba gestionando otra sesion, se omite.` });
      await updateRun((r) => patchJob(r, job.id, {
        resultado: RESULTADO.ERROR,
        mensaje: 'Reclamada por otra sesion',
        reportado: true, // el desenlace lo reporta quien la reclamo
      }));
      advancing = false;
      return advance();
    }
    if (!claim.ok) {
      await appendLog({ level: 'error', message: `Orden ${job.orden}: no se pudo reclamar (${claim.error}).` });
      await updateRun((r) => patchJob(r, job.id, {
        resultado: RESULTADO.ERROR,
        mensaje: claim.error || 'No se pudo reclamar',
        reportado: true,
      }));
      advancing = false;
      return advance();
    }

    // 2. A buscar la orden en el modulo de devoluciones.
    await updateRun((r) => ({
      ...patchJob(r, job.id, { fase: FASE.BUSCAR, startedAt: Date.now() }),
      currentId: job.id,
    }));
    await appendLog({ level: 'info', message: `Orden ${job.orden}: buscando en el modulo de devoluciones…` });

    const fresh = await getRun();
    const tabId = await openTab(fresh, RETURNS_URL);

    trazaInfo('runner', 'Orden reclamada y pestana abierta', {
      orden: job.orden,
      pestana: tabId,
      url: RETURNS_URL,
    });
  } catch (err) {
    log.error('advance', err instanceof Error ? err : new Error(toMessage(err)));
  } finally {
    advancing = false;
  }
}

async function finish(reason, errorReason = null) {
  await stopAlarm();
  await updateRun((run) => (run ? {
    ...run,
    active: false,
    currentId: null,
    finishedAt: Date.now(),
    finishReason: reason,
    errorReason,
  } : run));
}

// -----------------------------------------------------------------------------
// Reporte del resultado
// -----------------------------------------------------------------------------

/**
 * Cierra un job: lo reporta a la API del modulo y pasa al siguiente. El reporte
 * es lo que libera los archivos retenidos en el servidor, asi que un fallo aqui
 * se registra pero no bloquea la cola (la limpieza por expiracion lo cubre).
 */
async function closeJob(id, { resultado, ticket = null, mensaje = null }) {
  const run = await getRun();
  const job = findJob(run, id);
  if (!job || isJobDone(job)) return;

  await updateRun((r) => patchJob(r, id, { resultado, ticket, mensaje }));

  const { base, token } = await credentials(run);
  if (base && token) {
    const res = await reportGestion(base, token, id, { resultado, ticket, mensaje });
    if (res.ok) {
      await updateRun((r) => patchJob(r, id, { reportado: true }));
    } else {
      await appendLog({ level: 'warn', message: `Orden ${job.orden}: no se pudo reportar el resultado (${res.error}).` });
    }
  }

  trazaInfo('runner', 'Orden cerrada', { orden: job.orden, resultado, ticket, mensaje });

  const etiqueta = resultado === RESULTADO.TICKET
    ? `ticket ${ticket || 'levantado'}`
    : resultado === RESULTADO.OK ? 'apelacion enviada' : `error — ${mensaje || 'sin detalle'}`;
  await appendLog({
    level: resultado === RESULTADO.ERROR ? 'error' : 'info',
    message: `Orden ${job.orden}: ${etiqueta}.`,
  });

  await advance();
}

// -----------------------------------------------------------------------------
// Mensajes del content script
// -----------------------------------------------------------------------------

/**
 * ¿Que job corresponde a esta pestana? Solo respondemos a la pestana de trabajo:
 * si el usuario abre el portal en otra pestana, ahi no se automatiza nada.
 */
async function jobForTab(tabId) {
  const run = await getRun();

  // Este es el punto donde un "no pasa nada" se explica: la pestana que
  // pregunta no es la del run, el run ya termino, o no hay job en curso.
  if (!run?.active || run.tabId !== tabId || run.currentId == null) {
    traza('runner', 'GET_JOB sin respuesta', {
      pestanaQuePregunta: tabId,
      pestanaDelRun: run?.tabId ?? null,
      runActivo: Boolean(run?.active),
      jobEnCurso: run?.currentId ?? null,
    });

    return null;
  }

  const job = findJob(run, run.currentId);

  if (!job || isJobDone(job)) {
    traza('runner', 'GET_JOB: el job ya no esta vivo', {
      jobEnCurso: run.currentId,
      resultado: job?.resultado ?? null,
    });

    return null;
  }

  return { job, prueba: Boolean(run.prueba) };
}

/**
 * PDFs de la orden en base64. `scope`:
 *   - 'apelacion': solo evidencias.pdf (es lo que pide el formulario).
 *   - 'ticket': evidencias.pdf + el PDF original + los adjuntos del comprimido.
 */
async function filesFor(id, scope) {
  const run = await getRun();
  const { base, token } = await credentials(run);
  if (!base || !token) throw new Error('Sin emparejamiento');

  const manifestRes = await getManifest(base, token, id);
  if (!manifestRes.ok) throw new Error(manifestRes.error || 'No se pudo leer el manifiesto');

  const todos = Array.isArray(manifestRes.data?.archivos) ? manifestRes.data.archivos : [];
  const quiero = scope === 'apelacion'
    ? ['pdf_evidencias']
    : ['pdf_evidencias', 'pdf_original', 'pdf_adjunto'];

  const elegidos = todos.filter((a) => quiero.includes(a.type));

  traza('runner', 'Archivos pedidos por el content', {
    scope,
    enElManifiesto: todos.map((a) => a.type),
    seEnviaran: elegidos.map((a) => a.path),
  });

  if (!elegidos.length) throw new Error('El manifiesto no trae PDFs que subir');

  const salida = [];
  for (const archivo of elegidos) {
    const res = await getFile(base, token, id, archivo.path);
    if (!res.ok) throw new Error(`No se pudo bajar ${archivo.path} (HTTP ${res.status})`);
    salida.push({
      nombre: archivo.path.split('/').pop(),
      tipo: 'application/pdf',
      contenido: await blobToBase64(await res.blob()),
    });
  }
  return salida;
}

/**
 * El content avisa de un cambio de fase. Aqui NO se navega: a la mesa de ayuda
 * se llega pulsando la navbar de SellerCenter (entrar por su URL cae en otro
 * login), asi que los saltos los da el propio content script sobre la pagina.
 */
async function advancePhase(tabId, id, fase) {
  const run = await getRun();
  if (!run?.active || run.tabId !== tabId) return;

  traza('runner', 'Cambio de fase', { id, fase, pestana: tabId });

  await updateRun((r) => patchJob(r, id, { fase }));

  if (fase === FASE.AYUDA) {
    const job = findJob(run, id);
    await appendLog({
      level: 'info',
      message: `Orden ${job?.orden}: no esta en el modulo, se va al centro de ayuda a levantar el ticket…`,
    });
  }
}

// -----------------------------------------------------------------------------
// Watchdog
// -----------------------------------------------------------------------------

/**
 * Un job que no avanza (portal caido, sesion cerrada, pestana cerrada a mano)
 * no puede colgar la cola: pasado el plazo se reporta ERROR y se sigue.
 */
async function watchdog() {
  const run = await getRun();
  if (!run?.active || run.currentId == null) return;

  const job = findJob(run, run.currentId);
  if (!job || isJobDone(job) || !job.startedAt) return;

  if (Date.now() - job.startedAt > JOB_TIMEOUT_MS) {
    trazaError('runner', 'Watchdog: la orden no avanzo a tiempo', {
      orden: job.orden,
      fase: job.fase,
      llevaMs: Date.now() - job.startedAt,
    });

    await closeJob(job.id, {
      resultado: RESULTADO.ERROR,
      mensaje: 'La gestion no avanzo dentro del plazo (¿sesion cerrada en la plataforma?)',
    });
  }
}

function ensureAlarm() {
  try { chrome.alarms.create(GESTION_ALARM, { periodInMinutes: ALARM_PERIOD_MIN }); } catch { /* no-op */ }
}

async function stopAlarm() {
  try { await chrome.alarms.clear(GESTION_ALARM); } catch { /* no-op */ }
}

// -----------------------------------------------------------------------------
// Control
// -----------------------------------------------------------------------------

async function start() {
  const run = await getRun();
  if (!run?.active) return;
  ensureAlarm();
  await appendLog({
    level: 'info',
    message: run.prueba
      ? 'Modo prueba: se rellenaran los formularios SIN enviarlos.'
      : 'Gestionando en SellerCenter…',
  });
  await advance();
}

async function cancel() {
  await stopAlarm();
  await updateRun((run) => (run ? {
    ...run,
    active: false,
    currentId: null,
    finishedAt: Date.now(),
    finishReason: 'cancelled',
  } : run));
  await appendLog({ level: 'warn', message: 'Gestion cancelada por el usuario.' });
}

// Se llama una vez desde el service worker.
export function wireGestionBackground() {
  fijarContextoDeTraza(CONTEXTOS.SW);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const tabId = sender?.tab?.id;

    switch (msg?.type) {
      case GESTION_MESSAGES.START:
        start().catch((err) => log.error('start', new Error(toMessage(err))));
        sendResponse({ ok: true });
        return false;

      case GESTION_MESSAGES.CANCEL:
        cancel().catch((err) => log.error('cancel', new Error(toMessage(err))));
        sendResponse({ ok: true });
        return false;

      case GESTION_MESSAGES.GET_JOB:
        jobForTab(tabId)
          .then((data) => sendResponse({ ok: true, ...(data || { job: null }) }))
          .catch((err) => sendResponse({ ok: false, error: toMessage(err) }));
        return true;

      case GESTION_MESSAGES.FILES:
        filesFor(msg.id, msg.scope)
          .then((archivos) => sendResponse({ ok: true, archivos }))
          .catch((err) => sendResponse({ ok: false, error: toMessage(err) }));
        return true;

      case GESTION_MESSAGES.ADVANCE:
        advancePhase(tabId, msg.id, msg.fase)
          .then(() => sendResponse({ ok: true }))
          .catch((err) => sendResponse({ ok: false, error: toMessage(err) }));
        return true;

      case GESTION_MESSAGES.REPORT:
        closeJob(msg.id, { resultado: msg.resultado, ticket: msg.ticket, mensaje: msg.mensaje })
          .then(() => sendResponse({ ok: true }))
          .catch((err) => sendResponse({ ok: false, error: toMessage(err) }));
        return true;

      case GESTION_MESSAGES.LOG:
        appendLog({ level: msg.level || 'info', message: msg.message })
          .catch(() => { /* no-op */ });
        sendResponse({ ok: true });
        return false;

      default:
        return false;
    }
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== GESTION_ALARM) return;
    getRun().then((run) => {
      if (run?.active) watchdog();
      else stopAlarm();
    }).catch(() => { /* no-op */ });
  });

  // Si el SW se reinicio en mitad de un run, el watchdog lo destraba.
  getRun().then((run) => { if (run?.active) ensureAlarm(); }).catch(() => { /* no-op */ });
}
