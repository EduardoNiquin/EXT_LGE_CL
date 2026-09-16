// Content script del Registro de acciones.
//
// Corre en TODOS los frames de TODAS las paginas (el content script global ya
// esta declarado asi en el manifest), pero no hace nada hasta que el usuario
// aprieta Iniciar: mientras no haya grabacion, esto es un listener de
// `storage.onChanged` y nada mas.
//
// El estado (activo / en pausa) se cachea en memoria y se refresca por
// storage.onChanged. Ningun handler de eventos consulta storage: a 40 eventos
// por segundo eso seria insostenible.

import { logger } from '../../../shared/utils/logger.js';
import { toMessage } from '../../../shared/errors/index.js';
import { STORAGE_KEYS } from '../constants.js';
import { getOpciones, getRun } from '../state.js';
import {
  detenerCaptura,
  estadoCaptura,
  iniciarCaptura,
  pausarCaptura,
  reanudarCaptura,
} from './captura.js';
import { cerrar as cerrarConsecuencias, configurar as configurarConsecuencias } from './consecuencias.js';
import { detenerPagina, iniciarPagina, inventarioAhora } from './pagina.js';
import { encolar, estadoTransporte, reiniciar as reiniciarTransporte, vaciar } from './transporte.js';
import { ampliarDebug, cmd } from '../debug.js';

const log = logger('registro-acciones');

const estado = {
  grabando: false,
  pausado: false,
  sesionId: null,
  arrancado: false,
};

/**
 * Punto unico por el que sale todo evento de este frame. Agrega lo comun (hora,
 * url) y delega en el transporte; devuelve la referencia local para poder
 * correlacionar un efecto con su causa.
 */
function emitir(evento, opcionesEnvio) {
  if (!estado.grabando || estado.pausado) return null;
  return encolar({
    ts: Date.now(),
    url: location.href,
    titulo: document.title || null,
    ...evento,
  }, opcionesEnvio);
}

async function arrancar() {
  if (estado.arrancado) return;
  estado.arrancado = true;

  const opciones = await getOpciones();

  configurarConsecuencias({ emitir });
  iniciarCaptura({ emitir, opciones });
  iniciarPagina({ emitir, opciones });

  log.debug('grabando en este frame', { url: location.href, esTop: window === window.top });
}

function parar({ soltarCola = true } = {}) {
  if (!estado.arrancado) return;
  estado.arrancado = false;

  detenerCaptura();
  detenerPagina();
  cerrarConsecuencias();

  if (soltarCola) reiniciarTransporte();
  else vaciar();
}

/** Aplica el run que venga de storage (o su ausencia). */
function aplicar(run) {
  const grabando = Boolean(run?.active);
  const pausado = Boolean(run?.paused);
  const cambioSesion = run?.sesionId && run.sesionId !== estado.sesionId;

  if (grabando && cambioSesion) {
    // Sesion nueva: el frame puede venir de una anterior a medias.
    parar();
    estado.sesionId = run.sesionId;
  }

  const estabaGrabando = estado.grabando;
  estado.grabando = grabando;
  estado.pausado = pausado;

  if (!grabando) {
    if (estabaGrabando) {
      vaciar();      // lo ultimo que se alcanzo a juntar antes del stop
      parar();
    }
    estado.sesionId = null;
    return;
  }

  estado.sesionId = run.sesionId || estado.sesionId;

  if (pausado) {
    pausarCaptura();
    cerrarConsecuencias();
    vaciar();
    return;
  }

  if (!estado.arrancado) {
    arrancar().catch((err) => log.warn('no se pudo arrancar la captura', { error: toMessage(err) }));
  } else {
    reanudarCaptura();
  }
}

/**
 * Antes de que el documento muera hay que soltar lo acumulado: ahi esta el clic
 * que causo la navegacion, que es el evento que explica el salto de pagina.
 * `pagehide` es el unico que dispara de forma fiable en todos los casos
 * (navegacion, cierre de pestana, bfcache).
 */
function alIrse() {
  if (!estado.grabando || estado.pausado) return;
  vaciar();
}

export function init() {
  // Guard de idempotencia: si el content script se inyectara dos veces en el
  // mismo documento, se duplicarian todos los eventos.
  try {
    if (window.__extLgeClRegistroAcciones) return;
    window.__extLgeClRegistroAcciones = true;
  } catch { /* algunos frames no dejan escribir en window */ }

  chrome.storage.onChanged.addListener((cambios, area) => {
    if (area !== 'local' || !cambios[STORAGE_KEYS.RUN]) return;
    try {
      aplicar(cambios[STORAGE_KEYS.RUN].newValue || null);
    } catch (err) {
      log.warn('no se pudo aplicar el estado', { error: toMessage(err) });
    }
  });

  window.addEventListener('pagehide', alIrse, { capture: true });

  // Los comandos que solo tienen sentido dentro de una pagina se suman aca, no
  // en debug.js: ese archivo tambien se carga en el service worker, donde no hay
  // DOM (ni se puede importar este modulo con un import dinamico).
  ampliarDebug({
    frame: cmd(() => diagnose(), 'Estado de la grabacion en ESTE frame (captura, cola, transporte)'),
  });

  // Una pestana abierta a mitad de grabacion tiene que sumarse sola.
  getRun()
    .then((run) => aplicar(run))
    .catch((err) => log.debug('no se pudo leer el run inicial', { error: toMessage(err) }));
}

/** Para la Debug API. */
export function diagnose() {
  return {
    url: location.href,
    esTop: window === window.top,
    ...estado,
    captura: estadoCaptura(),
    transporte: estadoTransporte(),
  };
}

export { inventarioAhora };
