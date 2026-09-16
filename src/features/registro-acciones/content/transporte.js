// Transporte de eventos: del frame al service worker.
//
// Por que un Port y no `sendMessage`:
//   1. Al navegar, el documento muere. Lo que se postea por un port en
//      `pagehide` se despacha antes del teardown; un `sendMessage` se pierde — y
//      justo ahi esta el clic que causo la navegacion, el evento mas valioso.
//   2. Un port abierto mantiene vivo al service worker mientras se graba, asi
//      que no hace falta keep-alive artificial.
//   3. El SW recibe `port.sender.tab.id` y `frameId` gratis: la identidad del
//      frame la pone quien la conoce de verdad, no el content.
//
// Los eventos van en lotes (LIMITES.loteMs / loteEventos) para no despertar al
// SW en cada clic, pero las acciones que pueden causar una navegacion se mandan
// al instante (`urgente`), porque quiza no haya un proximo lote.

import { connectToBackground } from '../../../shared/messaging/messaging.js';
import { logger } from '../../../shared/utils/logger.js';
import { LIMITES, PORTS } from '../constants.js';

const log = logger('registro-acciones');

/** Identifica a este documento dentro de la sesion (para deduplicar y correlacionar). */
const FRAME_TOKEN = `f${Math.random().toString(36).slice(2, 10)}`;

let port = null;
let cola = [];
let enVuelo = null;
let temporizador = null;
let seqLocal = 0;
let descartados = 0;

// Freno ante rafagas: una pagina puede disparar cientos de eventos por segundo.
let ventanaInicio = 0;
let ventanaContador = 0;

export function frameToken() {
  return FRAME_TOKEN;
}

/** Referencia local de un evento, que el SW traduce a la id global. */
export function refDe(seq) {
  return `${FRAME_TOKEN}:${seq}`;
}

function abrirPort() {
  if (port) return port;

  port = connectToBackground(PORTS.EVENTOS);
  if (!port) return null;

  port.onMessage.addListener((mensaje) => {
    if (mensaje?.tipo === 'ok') {
      enVuelo = null;
      return;
    }
    if (mensaje?.tipo === 'detener') {
      // El SW avisa que la grabacion termino: se suelta lo que quedaba.
      cola = [];
      enVuelo = null;
    }
  });

  port.onDisconnect.addListener(() => {
    port = null;
    // El lote que estaba en vuelo no llego a confirmarse: vuelve al frente de la
    // cola. Duplicar un evento es preferible a perder el que explica el flujo.
    if (enVuelo) {
      cola = [...enVuelo, ...cola];
      enVuelo = null;
    }
  });

  return port;
}

/** Suelta lo acumulado. Devuelve true si se pudo entregar. */
export function vaciar() {
  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  if (!cola.length) return true;

  const canal = abrirPort();
  if (!canal) return false;     // sin runtime: se reintenta en el proximo lote

  const lote = cola;
  cola = [];
  enVuelo = lote;

  try {
    canal.postMessage({ tipo: 'eventos', frameToken: FRAME_TOKEN, eventos: lote, descartados });
    descartados = 0;
    return true;
  } catch (err) {
    // El contexto se invalido (recarga de la extension). No se puede hacer nada
    // util con estos eventos, pero tampoco se los puede acumular para siempre.
    log.debug('no se pudo enviar el lote', { error: String(err) });
    port = null;
    enVuelo = null;
    return false;
  }
}

function programar() {
  if (temporizador) return;
  temporizador = setTimeout(() => {
    temporizador = null;
    vaciar();
  }, LIMITES.loteMs);
}

/** Cuenta un evento contra el freno por segundo. Devuelve false si hay que soltarlo. */
function pasaElFreno() {
  const ahora = Date.now();
  if (ahora - ventanaInicio >= 1000) {
    ventanaInicio = ahora;
    ventanaContador = 0;
  }
  ventanaContador++;
  return ventanaContador <= LIMITES.eventosPorSegundo;
}

/**
 * Encola un evento. Devuelve su REFERENCIA (`frameToken:seq`) o `null` si se
 * descarto.
 *
 * Tiene que ser la referencia completa y no el numero de secuencia: es la clave
 * con la que el service worker traduce "esto lo causo aquella accion" a la id
 * global del evento, y el numero suelto se repite en cada frame.
 *
 * @param {object} evento
 * @param {{ urgente?: boolean }} [opciones]  urgente = se manda ya, sin esperar el lote
 */
export function encolar(evento, { urgente = false } = {}) {
  if (!evento) return null;

  if (!pasaElFreno()) {
    descartados++;
    return null;
  }

  if (cola.length >= LIMITES.colaMaxima) {
    descartados++;
    return null;
  }

  seqLocal++;
  const ref = refDe(seqLocal);
  cola.push({ ...evento, seqLocal, ref });

  if (urgente || cola.length >= LIMITES.loteEventos) vaciar();
  else programar();

  return ref;
}

/** Cierra el canal y olvida lo pendiente (al detener la grabacion). */
export function reiniciar() {
  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  cola = [];
  enVuelo = null;
  descartados = 0;
  seqLocal = 0;
  if (port) {
    try { port.disconnect(); } catch { /* ya estaba cerrado */ }
    port = null;
  }
}

/** Estado interno, para la Debug API. */
export function estadoTransporte() {
  return {
    frameToken: FRAME_TOKEN,
    conectado: Boolean(port),
    enCola: cola.length,
    enVuelo: enVuelo ? enVuelo.length : 0,
    seqLocal,
    descartados,
  };
}
