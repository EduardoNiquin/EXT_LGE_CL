// "Ventas en vivo" en el service worker: alarma -> ciclo -> estado + historial.
//
// Patron de e-promoters (el trabajo corre en el SW y el popup solo refleja el
// estado de storage) + las alarmas de Revisar Destacados (lgcom). No necesita
// una pestana abierta mientras el fetch del SW lleve la cookie del admin.
//
// Si el SW ve el login (sesion caducada, o porque su fetch no lleva la cookie:
// todavia sin medir), le pide el CSV a una pestana del admin abierta (mensaje
// TICK al content script) y el POST al portal lo hace igual el SW: desde el
// content script el fetch sale con el origen de la pagina y el portal no
// responde CORS. Despues del POST le pide a esa misma pestana que borre el
// archivo del export (mensaje BORRAR): el SW no tiene la sesion del admin.
//
// tick() nunca lanza.

import {
  ADMIN_BASE_RE,
  ALARM,
  BADGE_COLOR,
  BADGE_TEXTO,
  MAX_FALLOS_BADGE,
  MESSAGES,
  PESTANA_BORRAR_TIMEOUT_MS,
  PESTANA_TIMEOUT_MS,
  RESULTADO,
  STORAGE_KEYS,
  TOKEN_DEFAULT,
  VIA,
} from '../constants.js';
import {
  actualizarConfig,
  actualizarEstado,
  agregarHistorial,
  aplicarResultado,
  entradaHistorial,
  getConfig,
} from '../state.js';
import { correrCiclo, terminarEnvio } from '../ciclo.js';
import { registrarDebug } from '../debug.js';
import { cmd } from '../../../../shared/debug/index.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('magento/ventas-en-vivo');

const swFetch = (url, opciones) => fetch(url, opciones);

/**
 * Pausa entre sondeos de la lista de exports. Toca una API de la extension al
 * despertar: eso reinicia el contador de inactividad del SW (Chrome 110+), asi
 * no se duerme a mitad de una espera de hasta `esperaArchivoMaxMs`.
 */
async function swSleep(ms) {
  await new Promise((resolve) => { setTimeout(resolve, ms); });
  try { await chrome.runtime.getPlatformInfo(); } catch { /* solo es un latido */ }
}

let enCurso = null; // promesa del tick en vuelo (no se solapan)
// URLs del export y de la lista + form_key resueltas por el SW (se pierden al
// dormir: se resuelven de nuevo).
let cache = null;

// -----------------------------------------------------------------------------
// Badge
// -----------------------------------------------------------------------------

async function actualizarBadge(estado) {
  try {
    const mostrar = estado?.activo !== false
      && (estado?.sesionCaducada || (estado?.fallosSeguidos || 0) >= MAX_FALLOS_BADGE);
    if (mostrar) {
      await chrome.action.setBadgeText({ text: BADGE_TEXTO });
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
      return;
    }
    // Solo se limpia el badge propio: Registro de acciones usa el mismo (REC/II).
    const actual = await chrome.action.getBadgeText({});
    if (actual === BADGE_TEXTO) await chrome.action.setBadgeText({ text: '' });
  } catch { /* la accion puede no estar disponible */ }
}

// -----------------------------------------------------------------------------
// Fallback: una pestana del admin abierta
// -----------------------------------------------------------------------------

function conTimeout(promesa, ms) {
  let timer = null;
  return Promise.race([
    promesa,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('La pestana no respondio a tiempo.')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function pestanasDelAdmin() {
  const tabs = await chrome.tabs.query({ url: ['*://*/*obsadm*'] });
  return tabs
    .filter((tab) => tab.id != null && ADMIN_BASE_RE.test(tab.url || ''))
    .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
}

/**
 * Pide el CSV a una pestana del admin y lo manda al portal desde el SW.
 * @returns {Promise<object|null>} resultado del ciclo, o null si no hay pestana que responda
 */
async function cicloPorPestana({ config, token, tickN, inicio }) {
  let tabs = [];
  try { tabs = await pestanasDelAdmin(); } catch (err) { log.warn('no se pudieron listar las pestanas', toMessage(err)); }
  let ultimo = null;
  for (const tab of tabs) {
    try {
      const resp = await conTimeout(
        chrome.tabs.sendMessage(tab.id, { type: MESSAGES.TICK, config, tickN, ahora: Date.now() }, { frameId: 0 }),
        PESTANA_TIMEOUT_MS + (config.esperaArchivoMaxMs || 0),
      );
      if (!resp || !resp.resultado) continue;
      if (resp.resultado === 'csv') {
        const r = await terminarEnvio(resp, { config, token, fetchPortal: swFetch, inicio });
        const borrado = await borrarPorPestana(tab.id, resp, config);
        return { ...r, ...borrado, via: VIA.TAB, ms: Date.now() - inicio };
      }
      ultimo = { ...resp, via: VIA.TAB, ms: Date.now() - inicio };
      if (resp.resultado !== RESULTADO.SESION_CADUCADA) return ultimo;
    } catch (err) {
      log.debug('la pestana no respondio', { tabId: tab.id, error: toMessage(err) });
    }
  }
  return ultimo;
}

/** Tras el POST: la pestana que saco el CSV borra el archivo (tiene la sesion). */
async function borrarPorPestana(tabId, resp, config) {
  if (config.borrarArchivo === false || !resp.archivo) return { borrado: null };
  try {
    const b = await conTimeout(
      chrome.tabs.sendMessage(tabId, {
        type: MESSAGES.BORRAR,
        archivo: resp.archivo,
        formKey: resp.cache?.formKey || '',
      }, { frameId: 0 }),
      PESTANA_BORRAR_TIMEOUT_MS,
    );
    return b?.borrado ? { borrado: true } : { borrado: false, errorBorrado: b?.error || 'La pestana no confirmo el borrado.' };
  } catch (err) {
    return { borrado: false, errorBorrado: toMessage(err) };
  }
}

// -----------------------------------------------------------------------------
// Tick
// -----------------------------------------------------------------------------

/** Sin el CSV ni el cache (form_key): no se guardan ni viajan al popup. */
function sinCsv(r) {
  if (!r) return r;
  const { csv: _csv, cache: _cache, ...resto } = r;
  return resto;
}

async function tickInterno(origen) {
  const config = await getConfig();
  if (origen === 'alarma' && !config.activo) {
    await chrome.alarms.clear(ALARM);
    return { resultado: RESULTADO.ERROR, error: 'Ventas en vivo esta desactivado.' };
  }
  const previo = await actualizarEstado((e) => ({ ...e, activo: config.activo, enCurso: true, tickN: (e.tickN || 0) + 1 }));
  const tickN = previo.tickN;
  const token = config.token || TOKEN_DEFAULT;
  const inicio = Date.now();

  let r = await correrCiclo({ config, token, fetchImpl: swFetch, cache, tickN, sleep: swSleep });
  r = { ...r, via: VIA.SW };
  if (r.resultado === RESULTADO.SESION_CADUCADA) {
    cache = null;
    const porPestana = await cicloPorPestana({ config, token, tickN, inicio });
    if (porPestana) r = porPestana;
  } else if (r.via === VIA.SW && 'cache' in r) {
    cache = r.cache || null;
  }

  const ahora = Date.now();
  // Se relee: si lo apagaron a mitad del tick, el estado no debe volver a "activo".
  const { activo } = await getConfig();
  const estado = await actualizarEstado((e) => aplicarResultado({ ...e, activo }, r, ahora));
  await agregarHistorial(entradaHistorial(r, ahora));
  await actualizarBadge(estado);

  if (r.resultado === RESULTADO.OK) {
    log.info('ciclo ok', {
      origen, via: r.via, rango: r.rango, filas: r.filas, carga: r.carga, archivo: r.archivo?.nombre, borrado: r.borrado, ms: r.ms,
    });
  } else {
    log.warn('ciclo sin exito', { origen, via: r.via, resultado: r.resultado, error: r.error, status: r.status });
  }
  return sinCsv(r);
}

/**
 * Un ciclo completo. No se solapan: si ya hay uno en vuelo devuelve ese.
 * @param {'alarma'|'start'|'manual'|'debug'} [origen]
 */
export function tick(origen = 'manual') {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    try {
      return await tickInterno(origen);
    } catch (err) {
      log.error('tick fallo', err instanceof Error ? err : new Error(toMessage(err)));
      try {
        await actualizarEstado((e) => ({ ...e, enCurso: false, error: toMessage(err) }));
      } catch { /* sin storage */ }
      return { resultado: RESULTADO.ERROR, error: toMessage(err) };
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}

// -----------------------------------------------------------------------------
// Alarma y mensajes
// -----------------------------------------------------------------------------

/** Crea / limpia la alarma segun la config. Idempotente: no reinicia el ciclo si ya esta bien. */
export async function reconciliarAlarma() {
  try {
    const config = await getConfig();
    if (!config.activo) {
      await chrome.alarms.clear(ALARM);
      return;
    }
    const actual = await chrome.alarms.get(ALARM);
    if (actual && actual.periodInMinutes === config.intervaloMin) return;
    await chrome.alarms.create(ALARM, { periodInMinutes: config.intervaloMin });
    log.debug('alarma activa', { minutos: config.intervaloMin });
  } catch (err) {
    log.warn('no se pudo reconciliar la alarma', toMessage(err));
  }
}

async function iniciar(cambio) {
  await actualizarConfig({ ...(cambio || {}), activo: true });
  await actualizarEstado((e) => ({ ...e, activo: true, tickN: 0, fallosSeguidos: 0 }));
  await reconciliarAlarma();
  tick('start');
}

async function detener() {
  await actualizarConfig({ activo: false });
  await chrome.alarms.clear(ALARM);
  const estado = await actualizarEstado((e) => ({ ...e, activo: false }));
  await actualizarBadge(estado);
}

// Se llama una vez desde el service worker.
export function wireVentasEnVivoBackground() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === MESSAGES.START) {
      iniciar(msg.config).then(
        () => sendResponse({ ok: true }),
        (err) => sendResponse({ ok: false, reason: toMessage(err) }),
      );
      return true;
    }
    if (msg?.type === MESSAGES.STOP) {
      detener().then(
        () => sendResponse({ ok: true }),
        (err) => sendResponse({ ok: false, reason: toMessage(err) }),
      );
      return true;
    }
    if (msg?.type === MESSAGES.TICK_NOW) {
      tick('manual').then((r) => sendResponse({ ok: true, resultado: r }));
      return true;
    }
    return false;
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === ALARM) tick('alarma');
  });

  // Cambio de intervalo (o activo) desde el popup -> recrear la alarma.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.CONFIG]) reconciliarAlarma();
  });

  // Las alarmas pueden no sobrevivir a un reinicio del navegador.
  chrome.runtime.onStartup?.addListener(() => reconciliarAlarma());
  chrome.runtime.onInstalled?.addListener(() => reconciliarAlarma());
  reconciliarAlarma();

  // En el SW el tick se corre directo (un sendMessage al propio SW no llega).
  registrarDebug({
    tick: cmd(() => tick('debug'), 'Corre un ciclo ahora en el service worker (export -> portal)'),
  });
}
