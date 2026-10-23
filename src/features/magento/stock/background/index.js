// "Stock" en el service worker: alarmas -> portal OBS -> notificaciones.
//
// Patron de Ventas en vivo: el trabajo corre en el SW y el popup solo refleja
// lo que hay en storage y pide cosas por mensaje.
//
//   magento:stock:poll     cada `intervaloMin`: alertas nuevas -> notificacion(es)
//   magento:stock:resumen  una vez al dia a `horaResumen` (Chile): resumen del estado
//
// Badge: NO se usa. Ventas en vivo (`!`) y Registro de acciones (REC/II) ya se
// lo disputan; la cuenta de alertas sin ver va en la tarjeta del modulo y en el
// popup.
//
// Ninguna funcion exportada lanza.

import {
  ALARMS,
  MESSAGES,
  NOTIF,
  ICONO_NOTIFICACION,
  STORAGE_KEYS,
  TOKEN_DEFAULT,
} from '../constants.js';
import {
  actualizarAlertas,
  actualizarConfig,
  actualizarEstado,
  agregarAlertas,
  aplicarConsulta,
  aplicarError,
  aplicarSondeo,
  getAlertas,
  getConfig,
  marcarVistas,
  setFoto,
} from '../state.js';
import { armarResumen, revisar, sondear } from '../ciclo.js';
import { getStock } from '../api.js';
import { notificacionPrueba, planNotificaciones } from '../notificaciones.js';
import { proximoDisparo } from '../tiempo.js';
import { registrarDebug } from '../debug.js';
import {
  abrirPestana,
  abrirPopup,
  alClicNotificacion,
  mostrarNotificacion,
  nivelDePermiso,
} from '../../../../shared/notifications/index.js';
import { cmd } from '../../../../shared/debug/index.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('magento/stock');

const swFetch = (url, opciones) => fetch(url, opciones);
const tokenDe = (config) => config.token || TOKEN_DEFAULT;

// Sondeo y "Revisar ahora" van en fila: los dos leen y avanzan `ultimoIdVisto`.
let filaAlertas = Promise.resolve();
function enFilaAlertas(tarea) {
  const r = filaAlertas.then(tarea, tarea);
  filaAlertas = r.catch(() => {});
  return r;
}

let sondeoPendiente = null;
let revisionPendiente = null;
let consultaPendiente = null;

function unaVez(getter, setter, tarea) {
  const actual = getter();
  if (actual) return actual;
  const p = Promise.resolve()
    .then(tarea)
    .catch((err) => {
      log.error('operacion fallo', err instanceof Error ? err : new Error(toMessage(err)));
      return { ok: false, error: toMessage(err) };
    })
    .finally(() => setter(null));
  setter(p);
  return p;
}

// -----------------------------------------------------------------------------
// Notificaciones
// -----------------------------------------------------------------------------

async function notificar(alertas) {
  const plan = planNotificaciones(alertas);
  for (const n of plan) {
    await mostrarNotificacion(n.id, { ...n.opciones, iconUrl: ICONO_NOTIFICACION });
  }
  return plan.length;
}

async function alClic(id) {
  if (id.startsWith(NOTIF.ALERTA)) {
    const alertaId = Number(id.slice(NOTIF.ALERTA.length));
    const alerta = (await getAlertas()).find((a) => a.id === alertaId);
    await actualizarAlertas((l) => marcarVistas(l, [alertaId]));
    if (alerta?.url && await abrirPestana(alerta.url)) return;
  }
  // Agrupada, resumen, prueba (o una alerta sin ficha): el popup, si se deja.
  await abrirPopup();
}

// -----------------------------------------------------------------------------
// Operaciones
// -----------------------------------------------------------------------------

/** Sin la lista completa de alertas (no hace falta en la respuesta al popup). */
function compacto(r) {
  if (!r) return r;
  const { alertas: _a, aGuardar: _g, alertasRevision: _r, aNotificar, ...resto } = r;
  return { ...resto, notificadas: aNotificar?.length ?? 0 };
}

async function sondeoInterno(origen) {
  const config = await getConfig();
  if (origen === 'alarma' && !config.activo) {
    await chrome.alarms.clear(ALARMS.POLL);
    return { ok: false, error: 'Stock esta desactivado.' };
  }
  const estado = await actualizarEstado((e) => ({ ...e, sondeando: true }));
  const r = await sondear({
    ultimoIdVisto: estado.ultimoIdVisto,
    config,
    token: tokenDe(config),
    fetchImpl: swFetch,
    guardadas: await getAlertas(),
  });
  const ahora = Date.now();
  if (!r.ok) {
    await actualizarEstado((e) => aplicarError(e, 'sondeo', r, ahora));
    log.warn('sondeo sin exito', { origen, error: r.error, code: r.code, status: r.status });
    return r;
  }
  if (r.aGuardar.length) {
    await actualizarAlertas((l) => agregarAlertas(l, r.aGuardar, { vistas: r.primeraVez, ahora }));
  }
  await notificar(r.aNotificar);
  await actualizarEstado((e) => aplicarSondeo(e, r, ahora));
  if (r.primeraVez) log.info('primer sondeo: se guarda el ultimo id sin notificar', { ultimoIdVisto: r.ultimoIdVisto });
  else if (r.reinicio) log.warn('el portal numera desde mas abajo: se reinicia el ultimo id', { ultimoIdVisto: r.ultimoIdVisto });
  else log.debug('sondeo ok', { origen, nuevas: r.alertas.length, notificadas: r.aNotificar.length, paginas: r.paginas });
  return compacto(r);
}

/** Un sondeo de alertas. No se solapan. */
export function sondeo(origen = 'manual') {
  return unaVez(() => sondeoPendiente, (v) => { sondeoPendiente = v; }, () => enFilaAlertas(() => sondeoInterno(origen)));
}

async function consultaInterna(origen) {
  const config = await getConfig();
  await actualizarEstado((e) => ({ ...e, consultando: true }));
  const r = await getStock({ fetchImpl: swFetch, endpoint: config.endpoint, token: tokenDe(config) });
  const ahora = Date.now();
  if (!r.ok) {
    await actualizarEstado((e) => aplicarError(e, 'consulta', r, ahora));
    log.warn('consulta sin exito', { origen, error: r.error, code: r.code, status: r.status });
    return r;
  }
  await setFoto({ ...r.foto, consultadaEn: ahora });
  await actualizarEstado((e) => aplicarConsulta(e, r.foto, ahora));
  log.debug('consulta ok', { origen, productos: r.foto.productos.length });
  return { ok: true, resumen: r.foto.resumen, revision: r.foto.revision, productos: r.foto.productos.length };
}

/** GET /stock -> foto en storage. No se solapan. */
export function consultar(origen = 'manual') {
  return unaVez(() => consultaPendiente, (v) => { consultaPendiente = v; }, () => consultaInterna(origen));
}

async function revisionInterna() {
  const config = await getConfig();
  const estado = await actualizarEstado((e) => ({ ...e, revisando: true }));
  const r = await revisar({
    ultimoIdVisto: estado.ultimoIdVisto,
    config,
    token: tokenDe(config),
    fetchImpl: swFetch,
    guardadas: await getAlertas(),
  });
  const ahora = Date.now();
  if (!r.ok) {
    await actualizarEstado((e) => ({
      ...aplicarError(e, 'revision', r, ahora),
      ultimaRevisionManual: { ts: ahora, ok: false, error: r.error, code: r.code || null },
    }));
    log.warn('revision sin exito', { error: r.error, code: r.code, status: r.status });
    return r;
  }
  if (r.aGuardar.length) await actualizarAlertas((l) => agregarAlertas(l, r.aGuardar, { ahora }));
  await notificar(r.aNotificar);
  await actualizarEstado((e) => ({
    ...e,
    revisando: false,
    ultimoIdVisto: r.ultimoIdVisto ?? e.ultimoIdVisto,
    revision: r.revision || e.revision,
    notificadas: (e.notificadas || 0) + r.aNotificar.length,
    ultimaRevisionManual: {
      ts: ahora, ok: true, alertas: r.alertasRevision.length, notificadas: r.aNotificar.length,
    },
    ...(e.fase === 'revision' ? { error: null, code: null, status: null, fase: null, fallosSeguidos: 0 } : {}),
  }));
  log.info('revision ok', { revision: r.revision?.id, alertas: r.alertasRevision.length, notificadas: r.aNotificar.length });
  // La revision cambio la foto: se vuelve a pedir para el popup.
  await consultar('revision');
  return compacto(r);
}

/** "Revisar ahora": POST /revisar y notificar lo nuevo. No se solapan. */
export function revisarAhora() {
  return unaVez(() => revisionPendiente, (v) => { revisionPendiente = v; }, () => enFilaAlertas(revisionInterna));
}

async function resumenInterno(origen) {
  const config = await getConfig();
  if (origen === 'alarma' && (!config.activo || !config.resumenActivo)) {
    await reconciliarAlarmas();
    return { ok: false, error: 'Resumen diario desactivado.' };
  }
  const ahora = Date.now();
  const r = await armarResumen({ config, token: tokenDe(config), fetchImpl: swFetch, ahora });
  if (r.stock.ok) {
    await setFoto({ ...r.stock.foto, consultadaEn: ahora });
    await actualizarEstado((e) => aplicarConsulta(e, r.stock.foto, ahora));
  } else {
    await actualizarEstado((e) => aplicarError(e, 'resumen', r.stock, ahora));
  }
  await mostrarNotificacion(r.notificacion.id, { ...r.notificacion.opciones, iconUrl: ICONO_NOTIFICACION });
  await actualizarEstado((e) => ({ ...e, ultimoResumen: ahora }));
  log.info('resumen diario', { origen, ok: r.stock.ok, atrasado: r.notificacion.atrasado, alertas24h: r.alertas24h.length });
  if (origen === 'alarma') await reconciliarAlarmas(); // programa el de manana
  return { ok: r.stock.ok, atrasado: r.notificacion.atrasado, notificacion: r.notificacion.opciones };
}

export function resumen(origen = 'manual') {
  return resumenInterno(origen).catch((err) => ({ ok: false, error: toMessage(err) }));
}

async function probarNotificacion() {
  const n = notificacionPrueba();
  const id = await mostrarNotificacion(n.id, { ...n.opciones, iconUrl: ICONO_NOTIFICACION });
  const permiso = await nivelDePermiso();
  return id
    ? { ok: true, id, permiso }
    : { ok: false, permiso, reason: 'El navegador no mostro la notificacion (revisa que las notificaciones esten permitidas para el navegador en Windows).' };
}

// -----------------------------------------------------------------------------
// Alarmas
// -----------------------------------------------------------------------------

/** Crea / limpia las dos alarmas segun la config. Idempotente. */
export async function reconciliarAlarmas() {
  try {
    const config = await getConfig();
    if (!config.activo) {
      await chrome.alarms.clear(ALARMS.POLL);
      await chrome.alarms.clear(ALARMS.RESUMEN);
      await actualizarEstado((e) => (e.proximoResumen == null ? e : { ...e, proximoResumen: null }));
      return;
    }
    const poll = await chrome.alarms.get(ALARMS.POLL);
    if (!poll || poll.periodInMinutes !== config.intervaloMin) {
      await chrome.alarms.create(ALARMS.POLL, { periodInMinutes: config.intervaloMin, delayInMinutes: config.intervaloMin });
      log.debug('alarma de sondeo', { minutos: config.intervaloMin });
    }

    let proximo = null;
    if (config.resumenActivo) {
      proximo = proximoDisparo(config.horaResumen);
      const actual = await chrome.alarms.get(ALARMS.RESUMEN);
      if (proximo != null && (!actual || Math.abs(actual.scheduledTime - proximo) > 60000)) {
        await chrome.alarms.create(ALARMS.RESUMEN, { when: proximo });
        log.debug('alarma del resumen', { hora: config.horaResumen, when: new Date(proximo).toISOString() });
      }
    } else {
      await chrome.alarms.clear(ALARMS.RESUMEN);
    }
    await actualizarEstado((e) => (e.proximoResumen === proximo ? e : { ...e, proximoResumen: proximo }));
  } catch (err) {
    log.warn('no se pudieron reconciliar las alarmas', toMessage(err));
  }
}

async function iniciar(cambio) {
  await actualizarConfig({ ...(cambio || {}), activo: true });
  // Al activar, el primer sondeo vuelve a ser "primera vez": no se notifica lo
  // que se acumulo mientras estuvo apagado.
  await actualizarEstado((e) => ({ ...e, activo: true, ultimoIdVisto: null, fallosSeguidos: 0, notificadas: 0 }));
  await reconciliarAlarmas();
  sondeo('start');
  consultar('start');
}

async function detener() {
  await actualizarConfig({ activo: false });
  await chrome.alarms.clear(ALARMS.POLL);
  await chrome.alarms.clear(ALARMS.RESUMEN);
  await actualizarEstado((e) => ({ ...e, activo: false, proximoResumen: null }));
}

function responder(promesa, sendResponse) {
  promesa.then(
    (r) => sendResponse(r && typeof r === 'object' && 'ok' in r ? r : { ok: true, resultado: r }),
    (err) => sendResponse({ ok: false, reason: toMessage(err) }),
  );
  return true;
}

// Se llama una vez desde el service worker.
export function wireStockBackground() {
  // Un SW recien levantado no tiene nada en vuelo: si murio a mitad de una
  // operacion, sus banderas quedaron prendidas en storage.
  actualizarEstado((e) => (e.sondeando || e.consultando || e.revisando
    ? { ...e, sondeando: false, consultando: false, revisando: false }
    : e)).catch(() => {});

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case MESSAGES.START: return responder(iniciar(msg.config).then(() => ({ ok: true })), sendResponse);
      case MESSAGES.STOP: return responder(detener().then(() => ({ ok: true })), sendResponse);
      case MESSAGES.CONSULTAR: return responder(consultar('manual'), sendResponse);
      case MESSAGES.REVISAR: return responder(revisarAhora(), sendResponse);
      case MESSAGES.PROBAR_NOTIFICACION: return responder(probarNotificacion(), sendResponse);
      case MESSAGES.MARCAR_VISTAS:
        return responder(actualizarAlertas((l) => marcarVistas(l, msg.ids || null)).then(() => ({ ok: true })), sendResponse);
      default: return false;
    }
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === ALARMS.POLL) sondeo('alarma');
    else if (alarm?.name === ALARMS.RESUMEN) resumen('alarma');
  });

  alClicNotificacion(NOTIF.PREFIJO, alClic);

  // Cambio de intervalo, hora del resumen o activo desde el popup -> alarmas.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.CONFIG]) reconciliarAlarmas();
  });

  // Las alarmas pueden no sobrevivir a un reinicio del navegador.
  chrome.runtime.onStartup?.addListener(() => reconciliarAlarmas());
  chrome.runtime.onInstalled?.addListener(() => reconciliarAlarmas());
  reconciliarAlarmas();

  registrarDebug({
    consultar: cmd(() => consultar('debug'), 'GET /stock ahora (en el service worker)'),
    revisar: cmd(() => revisarAhora(), 'POST /revisar ahora y notificar lo nuevo (en el service worker)'),
    notificarPrueba: cmd(() => probarNotificacion(), 'Muestra una notificacion de prueba'),
    sondeo: cmd(() => sondeo('debug'), 'Un sondeo de alertas ahora (GET /alertas?desde_id=)'),
    resumen: cmd(() => resumen('debug'), 'Notificacion del resumen diario ahora'),
  });
}
