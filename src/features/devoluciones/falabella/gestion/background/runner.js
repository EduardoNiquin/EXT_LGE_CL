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
//   2. Refrescamos el numero de guia con el que devuelve el claim: el usuario
//      pudo escribirlo mientras la orden esperaba turno en la cola.
//   3. Abrimos/reutilizamos UNA pestana en el listado de devoluciones (fase
//      BUSCAR). El content busca la orden.
//   4. Si aparece: pulsa "No, rechazar" -> fase APELAR -> rellena y envia la
//      apelacion -> resultado OK.
//      Si no aparece: fase TICKET -> llevamos la pestana a ayudaseller -> el
//      content levanta el ticket -> resultado TICKET.
//   5. Reportamos el resultado a la API (ahi la web del usuario lo muestra y
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
  GUIA_NO_IDENTIFICADA,
  HELP_HOST,
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

/** Tramo del flujo que transcurre en la mesa de ayuda. */
const FASES_DE_TICKET = [FASE.AYUDA, FASE.SOPORTE, FASE.TICKET, FASE.CONFIRMACION];

/**
 * Adopta como pestana de trabajo la que abre el enlace "Centro de ayuda".
 *
 * Ese enlace NO navega la pestana actual: abre la mesa de ayuda en una **pestana
 * nueva**. Como el service worker solo da trabajo a `run.tabId`, sin esto el
 * content script que arranca alli pregunta por su job, se le responde que no le
 * toca, y la gestion se queda muda hasta que salta el watchdog de 8 minutos.
 *
 * Se adopta solo si la abrio nuestra propia pestana y el job va camino del
 * ticket: cualquier otra pestana que el usuario abra por su cuenta no puede
 * quedarse con el puesto.
 */
async function adoptarPestanaDeAyuda(tab) {
  if (!tab || tab.id == null) return;

  const run = await getRun();
  if (!run?.active || run.currentId == null || run.tabId == null) return;

  const job = findJob(run, run.currentId);
  if (!job || isJobDone(job) || !FASES_DE_TICKET.includes(job.fase)) return;

  // La abrio la pestana de trabajo, o —si el navegador no informa del origen—
  // va a la mesa de ayuda justo cuando la estabamos buscando.
  const url = tab.pendingUrl || tab.url || '';
  const laAbrioLaNuestra = tab.openerTabId === run.tabId;
  const vaALaMesaDeAyuda = url.includes(HELP_HOST);

  if (!laAbrioLaNuestra && !(tab.openerTabId == null && vaALaMesaDeAyuda)) return;

  await updateRun((r) => (r ? { ...r, tabId: tab.id } : r));

  trazaInfo('runner', 'La mesa de ayuda se abrio en otra pestana: se adopta', {
    orden: job.orden,
    fase: job.fase,
    pestanaAnterior: run.tabId,
    pestanaNueva: tab.id,
    porQue: laAbrioLaNuestra ? 'la abrio la pestana de trabajo' : 'va al host de la mesa de ayuda',
    url,
  });

  pedirDespacho(tab.id);
}

/** URL actual de una pestana (cadena vacia si ya no existe). */
async function urlDePestana(tabId) {
  if (tabId == null) return '';

  try {
    const tab = await chrome.tabs.get(tabId);
    return tab?.url || tab?.pendingUrl || '';
  } catch {
    return '';
  }
}

/**
 * Adopta la pestana que ACABA de llegar a la mesa de ayuda.
 *
 * `chrome.tabs.onCreated` no siempre basta: el salto pasa por el SSO del portal,
 * asi que al nacer la pestana su URL todavia no es la de la mesa de ayuda, y si
 * el enlace va con `rel="noopener"` tampoco llega el `openerTabId`. Resultado
 * medido en vivo: la pestana nueva cargaba el centro de ayuda y el service
 * worker seguia dandole trabajo a la vieja — la gestion se quedaba muda hasta el
 * watchdog aunque el salto hubiera funcionado.
 *
 * Aqui se mira el destino, no el origen: si estamos camino del ticket y una
 * pestana entra en el host de la mesa de ayuda, esa es la nuestra. La pestana de
 * trabajo actual solo se cede si ella misma NO esta ya en la mesa de ayuda, para
 * no robarle el puesto a una que el usuario tuviera abierta por su cuenta.
 */
async function adoptarPorNavegacion(tabId, url) {
  if (tabId == null || !String(url || '').includes(HELP_HOST)) return;

  const run = await getRun();
  if (!run?.active || run.currentId == null || run.tabId === tabId) return;

  const job = findJob(run, run.currentId);
  if (!job || isJobDone(job) || !FASES_DE_TICKET.includes(job.fase)) return;

  if ((await urlDePestana(run.tabId)).includes(HELP_HOST)) return;

  await updateRun((r) => (r ? { ...r, tabId } : r));

  trazaInfo('runner', 'Una pestana llego a la mesa de ayuda: se adopta', {
    orden: job.orden,
    fase: job.fase,
    pestanaAnterior: run.tabId,
    pestanaNueva: tabId,
    url,
  });

  pedirDespacho(tabId);
}

/**
 * Le pide al content script de esa pestana que vuelva a preguntar por su job.
 *
 * Sin esto, una pestana adoptada DESPUES de que su content script preguntara se
 * quedaba esperando para siempre: nadie vuelve a despachar por su cuenta salvo
 * que la pagina navegue.
 */
function pedirDespacho(tabId) {
  if (tabId == null) return;

  try {
    chrome.tabs.sendMessage(tabId, { type: GESTION_MESSAGES.DISPATCH }).catch(() => { /* aun sin content script */ });
  } catch {
    /* la pestana pudo cerrarse */
  }
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

    // 2. El folio de la guia lo manda el claim, no la copia que se hizo al
    //    armar la cola: el usuario puede haberlo escrito mientras la orden
    //    esperaba turno (en la web o en el panel de gestion). Sin folio no se
    //    bloquea nada —el ticket va con GUIA_NO_IDENTIFICADA— pero tiene que
    //    quedar dicho en la bitacora, que es donde se mira despues.
    const guia = claim.data?.numero_guia || '';

    await updateRun((r) => patchJob(r, job.id, {
      numero_guia: guia,
      numero_guia_origen: claim.data?.numero_guia_origen ?? null,
    }));

    if (guia !== job.numero_guia) {
      trazaInfo('runner', 'El folio de la guia cambio desde que se armo la cola', {
        orden: job.orden,
        antes: job.numero_guia || null,
        ahora: guia || null,
        origen: claim.data?.numero_guia_origen ?? null,
      });
    }

    if (!guia) {
      await appendLog({
        level: 'warn',
        message: `Orden ${job.orden}: sin numero de guia, si hay que levantar ticket ira con "${GUIA_NO_IDENTIFICADA}".`,
      });
    }

    // 3. A buscar la orden en el modulo de devoluciones.
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

  // El motivo viaja en la respuesta, no solo al registro del service worker: asi
  // el "sin trabajo para esta pestana" del content script dice en la misma linea
  // POR QUE no le toca (que pestana es la del run, si el run sigue vivo…).
  const motivo = {
    pestanaQuePregunta: tabId,
    pestanaDelRun: run?.tabId ?? null,
    runActivo: Boolean(run?.active),
    jobEnCurso: run?.currentId ?? null,
  };

  // Este es el punto donde un "no pasa nada" se explica: la pestana que
  // pregunta no es la del run, el run ya termino, o no hay job en curso.
  if (!run?.active || run.tabId !== tabId || run.currentId == null) {
    traza('runner', 'GET_JOB sin respuesta', motivo);

    return { job: null, motivo };
  }

  const job = findJob(run, run.currentId);

  if (!job || isJobDone(job)) {
    traza('runner', 'GET_JOB: el job ya no esta vivo', {
      jobEnCurso: run.currentId,
      resultado: job?.resultado ?? null,
    });

    return { job: null, motivo: { ...motivo, resultado: job?.resultado ?? null } };
  }

  return { job, prueba: Boolean(run.prueba), motivo: null };
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

  // El salto a la mesa de ayuda abre pestana nueva; hay que seguirla. Se mira
  // tanto al nacer (por quien la abrio) como al navegar (por su destino): con el
  // SSO por medio, al nacer la URL todavia no es la de la mesa de ayuda.
  chrome.tabs.onCreated.addListener((tab) => {
    adoptarPestanaDeAyuda(tab).catch((err) => log.warn?.('adoptarPestana', new Error(toMessage(err))));
  });

  chrome.tabs.onUpdated.addListener((tabId, cambios, tab) => {
    const url = cambios?.url || (cambios?.status === 'complete' ? tab?.url : null);
    if (!url) return;

    adoptarPorNavegacion(tabId, url).catch((err) => log.warn?.('adoptarPorNavegacion', new Error(toMessage(err))));
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
