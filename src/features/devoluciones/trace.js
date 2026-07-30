// Traza de diagnostico del apartado Devoluciones.
//
// El problema que resuelve: la gestion automatica corre repartida entre tres
// contextos (popup, service worker y el content script de CADA frame de la
// pagina del portal), asi que cuando algo se queda a medias no hay una sola
// consola donde mirar — y la bitacora del run solo cuenta los hitos, no el
// detalle de que selector encontro que cosa.
//
// Esto es un ring buffer en chrome.storage.local que recoge el paso a paso de
// los tres contextos y lo publica en la pestana "Registro" del popup. Solo
// graba con el **Modo Dev** activo (shared/dev-mode): en uso normal no cuesta
// nada, ni en storage ni en escrituras.
//
// Cada entrada:
//   { ts, nivel, contexto, ambito, evento, datos, url, frame }
//
//   · contexto: 'popup' | 'service-worker' | 'content'
//   · ambito:   de que parte del flujo viene ('buscar', 'apelar', 'runner'…)
//   · evento:   que paso, en una frase corta
//   · datos:    lo medible (selector que encajo, filas de la tabla, valor leido)
//
// Las escrituras van coalescidas: un flujo puede trazar muchas veces seguidas y
// no queremos un `storage.set` por linea.

import { isDevMode, whenDevModeReady } from '../../shared/dev-mode/index.js';

// El flag del Modo Dev se lee de storage, asi que al arrancar un contexto aun
// no se sabe si esta activo. Sin esto, TODA traza emitida en ese instante — las
// de arranque, justo las que dicen que frames despertaron — se perdia en
// silencio. Se guardan aparte y se sueltan (o se tiran) al resolverse el flag.
let devResuelto = false;
const enEspera = [];

whenDevModeReady().then(() => {
  devResuelto = true;

  if (isDevMode()) {
    for (const entrada of enEspera) anotar(entrada);
  }

  enEspera.length = 0;
});

export const TRACE_STORAGE_KEY = 'devoluciones:trace';
export const TRACE_CAP = 400;

/** De donde sale la traza. Se deduce sola, pero se puede forzar. */
export const CONTEXTOS = {
  POPUP: 'popup',
  SW: 'service-worker',
  CONTENT: 'content',
};

let buffer = null;          // Array | null mientras carga
const pendientes = [];      // trazas emitidas antes de que cargara el buffer
const listeners = new Set();
let contextoPorDefecto = null;

function safeGet(keys) {
  try { return chrome.storage.local.get(keys); } catch { return Promise.resolve({}); }
}
function safeSet(obj) {
  try { return chrome.storage.local.set(obj); } catch { return Promise.resolve(); }
}

safeGet([TRACE_STORAGE_KEY]).then((res) => {
  buffer = Array.isArray(res[TRACE_STORAGE_KEY]) ? res[TRACE_STORAGE_KEY] : [];

  if (pendientes.length) {
    buffer.push(...pendientes.splice(0));
    recortar();
    programarGuardado();
  }

  emitir();
});

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[TRACE_STORAGE_KEY]) return;
    buffer = Array.isArray(changes[TRACE_STORAGE_KEY].newValue) ? changes[TRACE_STORAGE_KEY].newValue : [];
    emitir();
  });
} catch { /* contexto sin chrome.storage */ }

function emitir() {
  const copia = buffer || [];
  for (const l of listeners) {
    try { l(copia); } catch { /* noop */ }
  }
}

function recortar() {
  if (buffer.length > TRACE_CAP) buffer.splice(0, buffer.length - TRACE_CAP);
}

let guardadoProgramado = false;
function programarGuardado() {
  if (guardadoProgramado) return;
  guardadoProgramado = true;
  Promise.resolve().then(() => {
    guardadoProgramado = false;
    if (buffer) safeSet({ [TRACE_STORAGE_KEY]: buffer });
  });
}

/** Adivina en que contexto corremos, para no tener que repetirlo en cada llamada. */
function contextoActual() {
  if (contextoPorDefecto) return contextoPorDefecto;

  try {
    if (typeof window === 'undefined') return CONTEXTOS.SW;
    if (window.location?.protocol === 'chrome-extension:') return CONTEXTOS.POPUP;
    return CONTEXTOS.CONTENT;
  } catch {
    return CONTEXTOS.SW;
  }
}

/** Fija el contexto de este entorno (lo llama cada punto de entrada). */
export function fijarContextoDeTraza(contexto) {
  contextoPorDefecto = contexto;
}

/** Donde ocurrio: URL y si es el frame superior (clave con portales con iframes). */
function ubicacion() {
  try {
    if (typeof window === 'undefined' || !window.location) return {};

    return {
      url: window.location.href,
      frame: window === window.top ? 'top' : 'iframe',
    };
  } catch {
    return {};
  }
}

/**
 * Apunta un paso del flujo. No hace nada sin Modo Dev.
 *
 * @param {string} ambito   parte del flujo ('buscar', 'apelar', 'runner'…)
 * @param {string} evento   que paso, en una frase corta
 * @param {object} [datos]  lo medible; se serializa tal cual (mantenlo plano)
 * @param {'debug'|'info'|'warn'|'error'} [nivel]
 */
export function traza(ambito, evento, datos = null, nivel = 'debug') {
  // Con el flag ya resuelto y apagado no hay nada que hacer; si aun no se sabe,
  // la entrada espera (ver `enEspera` arriba).
  if (devResuelto && !isDevMode()) return;

  const entrada = {
    ts: Date.now(),
    nivel,
    contexto: contextoActual(),
    ambito,
    evento,
    datos: datos ?? null,
    ...ubicacion(),
  };

  if (!devResuelto) {
    enEspera.push(entrada);
    return;
  }

  anotar(entrada);
}

/** Mete una entrada en el buffer (o la deja pendiente si aun no cargo). */
function anotar(entrada) {
  if (buffer === null) {
    pendientes.push(entrada);
    return;
  }

  buffer.push(entrada);
  recortar();
  programarGuardado();
  emitir();
}

/** Atajos por nivel, para que el sitio de llamada se lea de un vistazo. */
export const trazaInfo = (ambito, evento, datos) => traza(ambito, evento, datos, 'info');
export const trazaAviso = (ambito, evento, datos) => traza(ambito, evento, datos, 'warn');
export const trazaError = (ambito, evento, datos) => traza(ambito, evento, datos, 'error');

/** Snapshot sincrono (mas viejas primero). */
export function getTrazas() {
  return (buffer || []).slice();
}

/** Vacia el registro. */
export function limpiarTrazas() {
  buffer = [];
  pendientes.length = 0;
  programarGuardado();
  emitir();
}

/** Subscribirse a cambios. Devuelve la desuscripcion. */
export function subscribeTrazas(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Espera a saber si el Modo Dev esta activo (util al arrancar un contexto). */
export function trazaLista() {
  return whenDevModeReady();
}
