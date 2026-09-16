// El grabador vive en el service worker.
//
// Por que aca y no en el content: el documento muere en cada navegacion y el
// usuario salta entre pestanas. El unico contexto que sobrevive a todo eso es el
// service worker — y ademas es el que sabe de que pestana y de que frame viene
// cada mensaje (`port.sender`), asi que la identidad la pone quien la conoce.
//
// Reparto de la persistencia:
//   · IndexedDB  -> los eventos (append-only, miles, se leen por cursor)
//   · storage.local -> el run (chico: estado, contadores, feed de los ultimos 60)
//
// Los contadores y el feed NO se escriben en cada lote: se acumulan en memoria y
// se vuelcan cada LIMITES.feedMs. Cada escritura del run dispara un
// storage.onChanged en el popup y en el content de cada frame de cada pestana;
// hacerlo 3 veces por segundo durante 20 minutos no aporta nada.

import { crearEventStore } from '../../../shared/event-store/index.js';
import { logger } from '../../../shared/utils/logger.js';
import { toMessage } from '../../../shared/errors/index.js';
import { EXPORTACION, LIMITES, MESSAGES, MOTIVO_FIN, PORTS, TIPOS } from '../constants.js';
import {
  clearRun,
  conContadores,
  conUltimos,
  getOpciones,
  getRun,
  makeRun,
  nuevoSesionId,
  setRun,
  updateRun,
} from '../state.js';
import { resumenParaFeed } from '../resumen.js';
import { wireNavegacion } from './navegacion.js';
import { exportarSesion } from './exportar.js';

const log = logger('registro-acciones');

export const store = crearEventStore({ nombre: 'registro-acciones' });

const ALARMA = 'registro-acciones:watchdog';
const REF_CAP = 400;

const memoria = {
  activo: false,
  pausado: false,
  sesionId: null,
  contadores: { total: 0, descartados: 0, porTipo: {} },
  feed: [],
  refAId: new Map(),        // ref local del frame -> id global en IndexedDB
  ultimaAccion: new Map(),  // pestanaId -> accion que puede haber causado una navegacion
  volcadoPendiente: null,
  panel: null,
};

// -----------------------------------------------------------------------------
// Utilidades de estado
// -----------------------------------------------------------------------------

export function estaGrabando() {
  return memoria.activo && !memoria.pausado;
}

function badge(texto, color) {
  try {
    chrome.action.setBadgeText({ text: texto });
    if (color) chrome.action.setBadgeBackgroundColor({ color });
  } catch { /* la accion puede no estar disponible en algunos contextos */ }
}

/**
 * El service worker MV3 se duerme y vuelve a arrancar de cero. Al despertar, su
 * memoria esta vacia hasta que se lee el run de storage — y lo que lo despierta
 * suele ser justamente un lote de eventos. Sin esta promesa, esos primeros
 * eventos se descartarian por "no hay grabacion activa" cuando en realidad si la
 * hay. Todo lo que dependa del estado espera aca primero.
 */
let rehidratado = null;

function listo() {
  if (!rehidratado) rehidratado = rehidratar();
  return rehidratado;
}

async function rehidratar() {
  try {
    const run = await getRun();
    memoria.activo = Boolean(run?.active);
    memoria.pausado = Boolean(run?.paused);
    memoria.sesionId = run?.sesionId || null;

    if (memoria.activo) {
      badge(memoria.pausado ? 'II' : 'REC', memoria.pausado ? '#b26a00' : '#c0392b');
      await asegurarAlarma();
    }
  } catch (err) {
    log.warn('no se pudo rehidratar el estado', { error: toMessage(err) });
  }
}

async function asegurarAlarma() {
  try {
    await chrome.alarms.create(ALARMA, { periodInMinutes: 1 });
  } catch { /* no-op */ }
}

async function quitarAlarma() {
  try { await chrome.alarms.clear(ALARMA); } catch { /* no-op */ }
}

// -----------------------------------------------------------------------------
// Entrada de eventos
// -----------------------------------------------------------------------------

function recordarRef(ref, id) {
  if (!ref) return;
  memoria.refAId.set(ref, id);
  if (memoria.refAId.size > REF_CAP) {
    // Map conserva el orden de insercion: el mas viejo es el primero.
    const primera = memoria.refAId.keys().next();
    if (!primera.done) memoria.refAId.delete(primera.value);
  }
}

/** Acciones que pueden desembocar en una navegacion, para atribuirsela despues. */
function recordarAccion(evento, id) {
  const esNavegable = evento.tipo === TIPOS.CLIC
    || evento.tipo === TIPOS.ENVIO_FORMULARIO
    || (evento.tipo === TIPOS.TECLA && evento.datos?.tecla === 'Enter');
  if (!esNavegable || evento.pestanaId == null) return;

  memoria.ultimaAccion.set(evento.pestanaId, { id, tipo: evento.tipo, ts: evento.ts });
}

/**
 * Busca que accion causo lo que acaba de pasar en esa pestana. Si no hay
 * candidata dentro de la ventana, se devuelve null y el registro lo dira: es
 * preferible un hueco honesto a una causa inventada.
 */
export function causaDe(pestanaId, ts = Date.now()) {
  const accion = memoria.ultimaAccion.get(pestanaId);
  if (!accion) return null;
  if (ts - accion.ts > LIMITES.ventanaCausaMs) return null;
  return accion.id;
}

/** Guarda un lote ya sellado y actualiza contadores/feed. */
async function persistir(eventos) {
  if (!eventos.length) return [];

  let ids = [];
  try {
    ids = await store.agregarLote(eventos);
  } catch (err) {
    log.error('no se pudieron guardar los eventos', err);
    return [];
  }

  eventos.forEach((evento, indice) => {
    const id = ids[indice];
    if (id != null) {
      evento.id = id;
      recordarRef(evento.ref, id);
      recordarAccion(evento, id);
    }
  });

  memoria.contadores = conContadores(memoria.contadores, eventos.map((e) => e.tipo));
  memoria.feed.push(...eventos.map(resumenParaFeed));
  if (memoria.feed.length > LIMITES.ringUltimos) {
    memoria.feed.splice(0, memoria.feed.length - LIMITES.ringUltimos);
  }

  avisarAlPanel();
  programarVolcado();

  if (memoria.contadores.total >= LIMITES.eventosMaximos) {
    await detener({ motivo: MOTIVO_FIN.TOPE, exportar: true });
  }

  return ids;
}

/** Evento nacido en el service worker (navegacion, pestanas, sesion). */
export async function emitirDelSw(evento) {
  await listo();
  if (!memoria.activo) return null;
  if (memoria.pausado && !evento.forzar) return null;

  const { forzar: _forzar, ...limpio } = evento;
  const [id] = await persistir([{
    ts: Date.now(),
    origen: 'service-worker',
    sesionId: memoria.sesionId,
    datos: {},
    ...limpio,
  }]);

  return id ?? null;
}

/** Lote que llega de un frame. */
async function recibirLote(mensaje, sender) {
  await listo();
  if (!memoria.activo || memoria.pausado) return;

  const pestanaId = sender?.tab?.id ?? null;
  const frameId = sender?.frameId ?? 0;

  const eventos = (mensaje.eventos || []).map((crudo) => ({
    ts: crudo.ts,
    tipo: crudo.tipo,
    origen: 'content',
    sesionId: memoria.sesionId,
    pestanaId,
    frameId,
    esFramePrincipal: frameId === 0,
    url: crudo.url || sender?.url || null,
    titulo: crudo.titulo || null,
    ref: crudo.ref || null,
    // Un efecto (aparecio/desaparecio) viene con la referencia local de la
    // accion que lo provoco; aca se traduce a la id global.
    accionId: crudo.accionRef ? (memoria.refAId.get(crudo.accionRef) ?? null) : null,
    datos: crudo.datos || {},
  }));

  if (mensaje.descartados) {
    memoria.contadores.descartados += mensaje.descartados;
  }

  await persistir(eventos);
}

// -----------------------------------------------------------------------------
// Volcado del run (contadores + feed)
// -----------------------------------------------------------------------------

function programarVolcado() {
  if (memoria.volcadoPendiente) return;
  memoria.volcadoPendiente = setTimeout(() => {
    memoria.volcadoPendiente = null;
    volcar().catch((err) => log.debug('volcado fallido', { error: toMessage(err) }));
  }, LIMITES.feedMs);
}

async function volcar() {
  if (memoria.volcadoPendiente) {
    clearTimeout(memoria.volcadoPendiente);
    memoria.volcadoPendiente = null;
  }

  const feed = memoria.feed.splice(0);
  const contadores = memoria.contadores;

  await updateRun((run) => {
    if (!run) return run;
    return {
      ...run,
      contadores: {
        ...run.contadores,
        total: contadores.total,
        descartados: contadores.descartados,
        porTipo: contadores.porTipo,
      },
      ultimos: feed.length ? conUltimos(run, feed) : run.ultimos,
    };
  });
}

/** El popup abierto recibe el feed por su propio port, sin pasar por storage. */
function avisarAlPanel() {
  if (!memoria.panel) return;
  try {
    memoria.panel.postMessage({
      tipo: 'estado',
      activo: memoria.activo,
      pausado: memoria.pausado,
      contadores: memoria.contadores,
      ultimos: memoria.feed.slice(-LIMITES.ringUltimos),
    });
  } catch {
    memoria.panel = null;
  }
}

// -----------------------------------------------------------------------------
// Ordenes del popup
// -----------------------------------------------------------------------------

async function iniciar() {
  const previo = await getRun();
  if (previo?.active) return { ok: false, reason: 'Ya hay una grabacion en curso.' };

  try {
    await store.limpiar();
  } catch (err) {
    return { ok: false, reason: `No se pudo preparar el almacen: ${toMessage(err)}` };
  }

  const sesionId = nuevoSesionId();
  memoria.activo = true;
  memoria.pausado = false;
  memoria.sesionId = sesionId;
  memoria.contadores = { total: 0, descartados: 0, porTipo: {} };
  memoria.feed = [];
  memoria.refAId.clear();
  memoria.ultimaAccion.clear();

  const run = makeRun({ sesionId });
  await setRun(run);

  badge('REC', '#c0392b');
  await asegurarAlarma();

  const opciones = await getOpciones();
  await emitirDelSw({
    tipo: TIPOS.SESION_INICIO,
    datos: {
      sesionId,
      version: chrome.runtime.getManifest?.()?.version || null,
      navegador: navigator.userAgent,
      plataforma: navigator.platform || null,
      zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone,
      opciones,
      pestanasAbiertas: await pestanasAbiertas(),
    },
  });

  log.info('grabacion iniciada', { sesionId });
  return { ok: true, run };
}

async function pestanasAbiertas() {
  try {
    const pestanas = await chrome.tabs.query({});
    return pestanas.slice(0, 30).map((t) => ({
      pestanaId: t.id, url: t.url, titulo: t.title, activa: t.active,
    }));
  } catch {
    return [];
  }
}

async function pausar() {
  if (!memoria.activo || memoria.pausado) return { ok: false, reason: 'No hay una grabacion activa.' };

  await emitirDelSw({ tipo: TIPOS.SESION_PAUSA, datos: { motivo: 'usuario' } });
  memoria.pausado = true;

  await updateRun((run) => (run ? { ...run, paused: true, pausedAt: Date.now() } : run));
  await volcar();

  badge('II', '#b26a00');
  avisarAlPanel();
  log.info('grabacion en pausa');
  return { ok: true };
}

async function reanudar() {
  if (!memoria.activo || !memoria.pausado) return { ok: false, reason: 'La grabacion no esta en pausa.' };

  memoria.pausado = false;
  const ahora = Date.now();

  await updateRun((run) => {
    if (!run) return run;
    const pausaMs = run.pausedAt ? ahora - run.pausedAt : 0;
    return {
      ...run,
      paused: false,
      pausedAt: null,
      pausaAcumuladaMs: (run.pausaAcumuladaMs || 0) + pausaMs,
    };
  });

  const run = await getRun();
  await emitirDelSw({
    tipo: TIPOS.SESION_REANUDAR,
    datos: { pausaMs: run?.pausaAcumuladaMs || 0 },
  });

  badge('REC', '#c0392b');
  avisarAlPanel();
  log.info('grabacion reanudada');
  return { ok: true };
}

/**
 * Detiene y (por defecto) genera los archivos.
 *
 * El orden importa: primero se marca el fin en el run — eso hace que cada frame
 * suelte lo que tenga acumulado — y recien despues se exporta, para no dejar
 * afuera los ultimos eventos.
 */
async function detener({ motivo = MOTIVO_FIN.USUARIO, exportar = true } = {}) {
  if (!memoria.activo) return { ok: false, reason: 'No hay una grabacion activa.' };

  const ahora = Date.now();
  const run = await getRun();

  await emitirDelSw({
    tipo: TIPOS.SESION_FIN,
    forzar: true,   // se anota aunque la sesion estuviera en pausa
    datos: {
      motivo,
      totalEventos: memoria.contadores.total,
      duracionMs: run?.startedAt ? ahora - run.startedAt : null,
    },
  });

  memoria.activo = false;
  memoria.pausado = false;

  await updateRun((r) => (r ? {
    ...r,
    active: false,
    paused: false,
    finishedAt: ahora,
    finishReason: motivo,
    exportacion: {
      ...r.exportacion,
      estado: exportar ? EXPORTACION.GENERANDO : EXPORTACION.PENDIENTE,
    },
  } : r));

  await volcar();
  badge('', null);
  await quitarAlarma();
  cerrarPuertosDeEventos();
  avisarAlPanel();

  log.info('grabacion detenida', { motivo, total: memoria.contadores.total });

  if (!exportar) return { ok: true };

  const resultado = await exportarSesion({ store, log });
  avisarAlPanel();
  return { ok: true, exportacion: resultado };
}

async function descartar() {
  if (memoria.activo) await detener({ motivo: MOTIVO_FIN.USUARIO, exportar: false });

  try {
    await store.limpiar();
  } catch (err) {
    log.warn('no se pudo limpiar el almacen', { error: toMessage(err) });
  }

  memoria.contadores = { total: 0, descartados: 0, porTipo: {} };
  memoria.feed = [];
  memoria.refAId.clear();
  memoria.ultimaAccion.clear();
  memoria.sesionId = null;

  await clearRun();
  badge('', null);
  avisarAlPanel();
  return { ok: true };
}

/** Cuando termina la grabacion, los frames no tienen nada mas que decir. */
const puertosDeEventos = new Set();

function cerrarPuertosDeEventos() {
  for (const port of puertosDeEventos) {
    try { port.postMessage({ tipo: 'detener' }); } catch { /* ya se fue */ }
  }
}

// -----------------------------------------------------------------------------
// Conexiones y mensajes
// -----------------------------------------------------------------------------

function alConectar(port) {
  if (port.name === PORTS.EVENTOS) {
    puertosDeEventos.add(port);

    port.onMessage.addListener((mensaje) => {
      if (mensaje?.tipo !== 'eventos') return;
      recibirLote(mensaje, port.sender)
        .then(() => {
          try { port.postMessage({ tipo: 'ok' }); } catch { /* el frame ya se fue */ }
        })
        .catch((err) => log.warn('lote rechazado', { error: toMessage(err) }));
    });

    port.onDisconnect.addListener(() => puertosDeEventos.delete(port));
    return;
  }

  if (port.name === PORTS.PANEL) {
    memoria.panel = port;
    port.onDisconnect.addListener(() => {
      if (memoria.panel === port) memoria.panel = null;
    });
    avisarAlPanel();
  }
}

function alMensaje(mensaje, _sender, sendResponse) {
  switch (mensaje?.type) {
    case MESSAGES.INICIAR:
      iniciar().then(sendResponse).catch((err) => sendResponse({ ok: false, reason: toMessage(err) }));
      return true;

    case MESSAGES.PAUSAR:
      pausar().then(sendResponse).catch((err) => sendResponse({ ok: false, reason: toMessage(err) }));
      return true;

    case MESSAGES.REANUDAR:
      reanudar().then(sendResponse).catch((err) => sendResponse({ ok: false, reason: toMessage(err) }));
      return true;

    case MESSAGES.DETENER:
      detener({ exportar: mensaje.exportar !== false })
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, reason: toMessage(err) }));
      return true;

    case MESSAGES.DESCARTAR:
      descartar().then(sendResponse).catch((err) => sendResponse({ ok: false, reason: toMessage(err) }));
      return true;

    case MESSAGES.EXPORTAR:
      exportarSesion({ store, log })
        .then((resultado) => sendResponse({ ok: true, exportacion: resultado }))
        .catch((err) => sendResponse({ ok: false, reason: toMessage(err) }));
      return true;

    case MESSAGES.ESTADO:
      Promise.all([getRun(), store.contar().catch(() => 0)])
        .then(([run, guardados]) => sendResponse({
          ok: true, run, guardados, memoria: resumenDeMemoria(),
        }))
        .catch((err) => sendResponse({ ok: false, reason: toMessage(err) }));
      return true;

    case MESSAGES.ULTIMOS:
      store.ultimos(mensaje.cantidad || 20)
        .then((eventos) => sendResponse({ ok: true, eventos }))
        .catch((err) => sendResponse({ ok: false, reason: toMessage(err) }));
      return true;

    default:
      return false;   // no es para nosotros: que lo atienda otro listener
  }
}

function resumenDeMemoria() {
  return {
    activo: memoria.activo,
    pausado: memoria.pausado,
    sesionId: memoria.sesionId,
    contadores: memoria.contadores,
    frames: puertosDeEventos.size,
    refs: memoria.refAId.size,
  };
}

/**
 * La alarma no es keep-alive: es reconciliacion. Si el navegador se cerro con
 * una grabacion activa, al volver hay que cerrarla en vez de dejarla colgada
 * para siempre; y de paso se reafirma el badge y se sincronizan los contadores
 * con lo que hay realmente en IndexedDB.
 */
async function reconciliar() {
  const run = await getRun();
  if (!run?.active) {
    if (memoria.activo) memoria.activo = false;
    badge('', null);
    await quitarAlarma();
    return;
  }

  badge(run.paused ? 'II' : 'REC', run.paused ? '#b26a00' : '#c0392b');

  try {
    const guardados = await store.contar();
    if (guardados !== run.contadores?.total) {
      memoria.contadores.total = guardados;
      await volcar();
    }
  } catch { /* se reintenta en el proximo tick */ }
}

export function wireRegistroAccionesBackground() {
  chrome.runtime.onConnect.addListener(alConectar);
  chrome.runtime.onMessage.addListener(alMensaje);

  chrome.alarms.onAlarm.addListener((alarma) => {
    if (alarma?.name !== ALARMA) return;
    reconciliar().catch((err) => log.debug('reconciliacion fallida', { error: toMessage(err) }));
  });

  wireNavegacion({
    emitir: emitirDelSw,
    activo: estaGrabando,
    causaDe,
    alCerrarPestana: (tabId) => memoria.ultimaAccion.delete(tabId),
  });

  listo();
}

/** Para la Debug API del service worker. */
export const __grabador = { memoria, detener, descartar, volcar, reconciliar };
