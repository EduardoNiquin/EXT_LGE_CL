// Content script de la gestion automatica (Falabella).
//
// En cada carga de pagina pregunta al service worker que job le toca a ESTA
// pestana. Si hay uno, espera a ver el anclaje de su fase (el elemento que
// identifica la pantalla) y solo entonces actua. El estado no vive aqui: el
// flujo cruza navegaciones y este documento muere en cada una.
//
// Recorrido completo cuando la devolucion NO esta en el modulo:
//   listado --[navbar Ayuda]--> mesa de ayuda --[navbar Soporte]--> soporte
//           --[pestana Nuevo caso]--> formulario --[Enviar]--> n° de caso
//
// Dos cosas que el portal impone y que este archivo tiene que respetar:
//
//   · Corre en TODOS los frames. El modulo de devoluciones puede vivir dentro
//     de un iframe, y ahi el frame superior tiene la URL correcta pero no el
//     formulario. Cada frame espera su anclaje; el que no lo encuentra se
//     calla — y sobre todo NO reporta un fallo, o mataria el trabajo del frame
//     que si lo tiene.
//
//   · No todo cambio de pantalla es una carga nueva. El portal es una SPA: a
//     veces cambia la URL y el contenido sin recargar. Un latido vigila la URL
//     y vuelve a despachar, abortando lo que estuviera esperando.
//
// Nada se automatiza en pestanas que el usuario abrio por su cuenta: el SW solo
// responde a la pestana de trabajo del run.

import {
  ANCLA_TIMEOUT_MS,
  FASE,
  GESTION_MESSAGES,
  NAVEGACION_TICK_MS,
  RESULTADO,
} from '../constants.js';
import { abrirApelacion, anclaListado, buscarOrden } from './buscar.js';
import { anclaApelacion, apelar } from './apelar.js';
import { anclaTicket, leerConfirmacion, levantarTicket } from './ticket.js';
import {
  anclaMenuAyuda,
  anclaSoporte,
  esAyudaInicio,
  esAyudaSoporte,
  esSellerCenter,
  irACentroDeAyuda,
  irASoporte,
} from './navegacion.js';
import { CONTEXTOS, fijarContextoDeTraza, traza, trazaAviso, trazaError, trazaInfo } from '../../../trace.js';
import { isAbortError, toMessage } from '../../../../../shared/errors/index.js';
import { waitFor } from '../../../../../shared/dom/wait.js';
import { logger } from '../../../../../shared/utils/logger.js';

const log = logger('devoluciones-gestion');

let corriendo = false;
let controlador = null;

// Se fija en init(), no al importar: asi el modulo se puede cargar fuera de un
// navegador (tests) sin tocar `location`.
let ultimaUrl = '';

/** Veces que este frame ha mirado sin encontrar su pantalla. */
let intentosSinAncla = 0;
const MAX_INTENTOS_SIN_ANCLA = 3;
const REINTENTO_MS = 10_000;

function enviar(mensaje) {
  return chrome.runtime.sendMessage(mensaje).catch(() => null);
}

function bitacora(message, level = 'info') {
  enviar({ type: GESTION_MESSAGES.LOG, level, message });
}

function avanzar(id, fase) {
  return enviar({ type: GESTION_MESSAGES.ADVANCE, id, fase });
}

/** Pide al service worker los PDF de la orden (llegan en base64). */
async function pedirArchivos(id, scope) {
  const res = await enviar({ type: GESTION_MESSAGES.FILES, id, scope });
  if (!res?.ok) throw new Error(res?.error || 'No se pudieron obtener los archivos de la orden');
  return res.archivos;
}

/** ¿Alguno de los portales que automatizamos? Evita preguntar en cada web. */
function paginaRelevante() {
  return esSellerCenter() || esAyudaInicio() || esAyudaSoporte();
}

/**
 * Este frame no tiene la pantalla que toca. No es un fallo de la gestion: puede
 * estar en otro frame o tardar mas en montar, asi que se sale en silencio y se
 * reintenta — reportar un error aqui mataria el trabajo del frame correcto.
 */
class SinAncla extends Error {
  constructor() {
    super('La pantalla de la gestion no esta en este frame');
    this.name = 'SinAncla';
  }
}

/**
 * Espera a que aparezca el anclaje de una pantalla (el elemento que la
 * identifica) y lo devuelve. Si no llega, lanza SinAncla.
 */
async function ancla(buscarAncla, { signal } = {}) {
  const inicio = Date.now();

  const el = await waitFor(buscarAncla, {
    timeout: ANCLA_TIMEOUT_MS,
    signal,
    description: 'la pantalla de la gestion',
  }).catch(() => null);

  if (!el) {
    trazaAviso('despachador', 'Este frame NO tiene la pantalla: se calla', {
      esperado: buscarAncla.name,
      esperoMs: Date.now() - inicio,
    });
    throw new SinAncla();
  }

  traza('despachador', 'Pantalla localizada en este frame', {
    esperado: buscarAncla.name,
    tardoMs: Date.now() - inicio,
  });

  return el;
}

/**
 * Reporta el resultado de un ticket. Se usa tanto si la confirmacion aparecio
 * sin recargar como si llego en una pagina nueva.
 */
function reportarTicket(id, { enviado, ticket, mensaje }) {
  return enviar({
    type: GESTION_MESSAGES.REPORT,
    id,
    resultado: enviado ? RESULTADO.TICKET : RESULTADO.ERROR,
    ticket: enviado ? ticket : null,
    mensaje,
  });
}

async function despachar() {
  if (corriendo || !paginaRelevante()) return;

  const res = await enviar({ type: GESTION_MESSAGES.GET_JOB });
  const job = res?.job;

  if (!job) {
    // Lo mas comun cuando "no pasa nada": esta pestana no es la del run, o el
    // service worker ya no tiene trabajo pendiente.
    traza('despachador', 'Sin trabajo para esta pestana', {
      respondio: Boolean(res),
      motivo: res ? 'el service worker no asigno job a esta pestana' : 'el service worker no respondio',
    });
    return;
  }

  corriendo = true;
  controlador = new AbortController();

  trazaInfo('despachador', 'Job recibido', {
    orden: job.orden,
    fase: job.fase,
    prueba: Boolean(res.prueba),
    tieneReembolso: Boolean(job.reembolso),
    guia: job.numero_guia || null,
  });

  const opciones = {
    prueba: Boolean(res.prueba),
    signal: controlador.signal,
    pedirArchivos: (scope) => pedirArchivos(job.id, scope),
    onLog: (message) => bitacora(message),
  };

  try {
    switch (job.fase) {
      case FASE.BUSCAR: {
        await ancla(anclaListado, opciones);

        const siguiente = await buscarOrden(job, opciones);

        // La fase se avisa ANTES de navegar: el clic mata este documento y la
        // pagina siguiente tiene que saber ya en que va la gestion.
        await avanzar(job.id, siguiente);

        if (siguiente === FASE.APELAR) await abrirApelacion(job, opciones);
        else await irACentroDeAyuda(opciones);
        break;
      }

      case FASE.APELAR: {
        await ancla(anclaApelacion, opciones);

        const { enviado } = await apelar(job, opciones);
        await enviar({
          type: GESTION_MESSAGES.REPORT,
          id: job.id,
          resultado: enviado ? RESULTADO.OK : RESULTADO.ERROR,
          mensaje: enviado ? 'Apelada en el modulo de devoluciones' : 'Modo prueba: no se envio la apelacion',
        });
        break;
      }

      // Camino a la mesa de ayuda. Cada rama cubre tambien el caso de que el
      // clic anterior no llegara a navegar (se reintenta desde donde estemos).
      case FASE.AYUDA:
      case FASE.SOPORTE: {
        await caminoAlTicket(job, opciones);
        break;
      }

      case FASE.TICKET: {
        await ancla(anclaTicket, opciones);
        await gestionarTicket(job, opciones);
        break;
      }

      // El envio recargo la pagina: solo queda leer el numero de caso.
      case FASE.CONFIRMACION: {
        await ancla(anclaTicket, opciones);
        await reportarTicket(job.id, await leerConfirmacion(opciones));
        break;
      }

      default:
        break;
    }

    intentosSinAncla = 0;
  } catch (err) {
    // Una navegacion esperada aborta lo que estuvieramos esperando: no es un
    // fallo de la gestion, la retoma la pantalla siguiente.
    if (isAbortError(err, controlador?.signal)) {
      traza('despachador', 'Flujo abortado por navegacion', { fase: job.fase });
      return;
    }

    // Esta pantalla no esta aqui (otro frame, o aun montandose): callar y
    // volver a mirar dentro de un rato.
    if (err instanceof SinAncla) {
      programarReintento();
      return;
    }

    const motivo = toMessage(err);
    trazaError('despachador', 'La fase fallo', { fase: job.fase, orden: job.orden, motivo });
    log.error('gestion', err instanceof Error ? err : new Error(motivo));
    await enviar({
      type: GESTION_MESSAGES.REPORT,
      id: job.id,
      resultado: RESULTADO.ERROR,
      mensaje: motivo,
    });
  } finally {
    corriendo = false;
  }
}

/**
 * Fases AYUDA y SOPORTE: se decide por DONDE estamos, no solo por la fase. Si
 * un clic no llego a navegar, se reintenta desde la pantalla actual en vez de
 * quedarse encallado.
 */
async function caminoAlTicket(job, opciones) {
  if (esAyudaSoporte()) {
    await ancla(anclaTicket, opciones);
    await avanzar(job.id, FASE.TICKET);
    await gestionarTicket(job, opciones);
    return;
  }

  if (esAyudaInicio()) {
    await ancla(anclaSoporte, opciones);
    await avanzar(job.id, FASE.SOPORTE);
    await irASoporte(opciones);
    return;
  }

  await ancla(anclaMenuAyuda, opciones);
  await irACentroDeAyuda(opciones);
}

/** Rellena, envia y reporta el ticket (la confirmacion puede llegar aqui o tras recargar). */
async function gestionarTicket(job, opciones) {
  const resultado = await levantarTicket(job, {
    ...opciones,
    antesDeEnviar: () => avanzar(job.id, FASE.CONFIRMACION),
  });

  await reportarTicket(job.id, {
    ...resultado,
    mensaje: resultado.mensaje ?? (resultado.enviado ? null : 'Modo prueba: no se envio el ticket'),
  });
}

/**
 * Vuelve a mirar dentro de un rato: la pantalla puede estar aun montandose (el
 * listado carga tres meses de devoluciones y no es rapido). Acotado, para que
 * los frames que nunca la tendran dejen de insistir.
 */
function programarReintento() {
  if (++intentosSinAncla > MAX_INTENTOS_SIN_ANCLA) {
    trazaAviso('despachador', 'Este frame deja de intentarlo', { intentos: intentosSinAncla - 1 });
    return;
  }

  traza('despachador', 'Se reintentara buscar la pantalla', {
    intento: intentosSinAncla,
    de: MAX_INTENTOS_SIN_ANCLA,
    enMs: REINTENTO_MS,
  });

  setTimeout(() => { despachar().catch(() => { /* no-op */ }); }, REINTENTO_MS);
}

/**
 * La SPA cambia de pantalla sin recargar. Un content script vive en un mundo
 * aislado y no ve los pushState de la pagina, asi que la via fiable es mirar la
 * URL cada tanto (popstate cubre ademas atras/adelante).
 */
function vigilarNavegacion() {
  ultimaUrl = location.href;

  const revisar = () => {
    if (location.href === ultimaUrl) return;

    traza('navegacion', 'La pagina cambio sin recargar', { de: ultimaUrl, a: location.href });

    ultimaUrl = location.href;

    // Lo que se estuviera esperando pertenece a la pantalla anterior.
    controlador?.abort();
    corriendo = false;
    intentosSinAncla = 0;

    setTimeout(() => { despachar().catch(() => { /* no-op */ }); }, 500);
  };

  window.addEventListener('popstate', revisar);
  setInterval(revisar, NAVEGACION_TICK_MS);
}

export function init() {
  fijarContextoDeTraza(CONTEXTOS.CONTENT);

  if (!paginaRelevante()) return;

  // Una linea por frame: con portales que montan el modulo en un iframe, saber
  // cuantos frames despertaron y cual es cual es media investigacion.
  trazaInfo('despachador', 'Content script activo en esta pantalla', {
    esTop: window === window.top,
    iframes: document.querySelectorAll('iframe').length,
  });

  vigilarNavegacion();

  // Las pantallas montan su DOM despues del load; el despacho reintenta una vez
  // antes de rendirse (los flujos tienen sus propias esperas, esto solo cubre
  // el arranque tardio de la SPA).
  despachar().catch((err) => log.warn?.('despachar', err));
  setTimeout(() => { despachar().catch(() => { /* no-op */ }); }, 2500);
}
