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
  PAGE_TIMEOUT_MS,
  RESULTADO,
} from '../constants.js';
import { abrirApelacion, anclaListado, buscarOrden } from './buscar.js';
import { anclaApelacion, apelar } from './apelar.js';
import { contarShadowRoots, todos } from './dom.js';
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
import { sleep, waitFor } from '../../../../../shared/dom/wait.js';
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

/**
 * Veces que se ha preguntado por trabajo sin que el service worker lo diera.
 * Existe por el salto a la mesa de ayuda: la pestana nueva pregunta nada mas
 * cargar, y el service worker puede tardar en darse cuenta de que ESA es ahora
 * la pestana de trabajo (el SSO hace que al nacer todavia no este en el host de
 * la ayuda). Sin repreguntar, la pestana correcta se quedaba muda para siempre.
 */
let intentosSinTrabajo = 0;
const MAX_INTENTOS_SIN_TRABAJO = 12;
const REPREGUNTA_MS = 2500;

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

/**
 * ¿Este documento nos interesa? Evita preguntar por trabajo en cada web que
 * abra el usuario.
 *
 * No basta con mirar el host: el portal monta sus pantallas en **iframes que no
 * siempre estan en el mismo dominio**, y ese frame es justo el que tiene el
 * formulario. Por eso tambien vale con que el documento contenga alguna de las
 * pantallas, venga del host que venga.
 */
function paginaRelevante() {
  return esSellerCenter() || esAyudaInicio() || esAyudaSoporte()
    || Boolean(anclaListado() || anclaApelacion() || anclaTicket());
}

/**
 * Radiografia del documento para cuando NO se encuentra la pantalla. Es lo que
 * convierte un "no aparecio" en un diagnostico: dice si hay iframes (y de
 * donde), y que campos hay de verdad en este documento.
 */
function queHayEnEsteDocumento() {
  const iframes = Array.from(document.querySelectorAll('iframe'));

  // Los campos y las tablas se cuentan CRUZANDO los shadow roots. Mirar solo el
  // documento decia "aqui no hay nada" justo en la pantalla que si tenia el
  // formulario — el modulo de devoluciones lo monta entero dentro de un shadow
  // root, asi que ese cero era la pista equivocada.
  const campos = todos('input, textarea');

  return {
    titulo: document.title,
    esTop: window === window.top,
    iframes: iframes.length,
    iframesSrc: iframes.map((f) => f.src || '(sin src)').slice(0, 6),
    campos: campos
      .map((c) => c.placeholder || c.name || c.type || '(sin rotulo)')
      .slice(0, 15),
    tablas: todos('table').length,
    // Distingue "la pantalla esta en un iframe" de "esta encapsulada en un web
    // component": si hay campos pero ninguno cuelga del documento, es lo segundo.
    camposEnElDocumento: document.querySelectorAll('input, textarea').length,
    shadowRoots: contarShadowRoots(),
  };
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
async function ancla(buscarAncla, etiqueta, { signal } = {}) {
  const inicio = Date.now();

  const el = await waitFor(buscarAncla, {
    timeout: ANCLA_TIMEOUT_MS,
    signal,
    description: `la pantalla "${etiqueta}"`,
  }).catch(() => null);

  if (!el) {
    // Con la radiografia del documento no hace falta otra ronda de preguntas:
    // se ve si el formulario esta en un iframe y que hay en este frame.
    trazaAviso('despachador', 'Este frame NO tiene la pantalla: se calla', {
      esperaba: etiqueta,
      esperoMs: Date.now() - inicio,
      ...queHayEnEsteDocumento(),
    });

    throw new SinAncla();
  }

  traza('despachador', 'Pantalla localizada en este frame', {
    pantalla: etiqueta,
    tardoMs: Date.now() - inicio,
  });

  return el;
}

// Cuantas veces se reintenta el salto a la mesa de ayuda y cuanto se espera a
// que el service worker confirme que la pestana nueva nacio.
const INTENTOS_SALTO_AYUDA = 3;
const ESPERA_SALTO_MS = 12_000;

/** ¿El service worker nos sigue dando ESTE job en ESTA pestana? */
async function seguimosConElJob(id) {
  const res = await enviar({ type: GESTION_MESSAGES.GET_JOB });
  return res?.job?.id === id;
}

/**
 * Salto al centro de ayuda, con reintentos.
 *
 * Es el unico paso del recorrido que no deja rastro en esta pagina: el enlace no
 * navega, su manejador abre la mesa de ayuda en OTRA pestana (y de fondo). Si el
 * clic no prende, este documento se queda exactamente igual, ningun content
 * script nuevo arranca y nadie lo reintenta — ahi era donde la gestion se
 * quedaba parada hasta que el usuario abria el menu a mano.
 *
 * El acuse de recibo lo da el service worker: cuando adopta la pestana nueva,
 * `run.tabId` cambia y GET_JOB deja de darnos trabajo. Esa es la señal de que
 * salto; mientras siga contestando, se vuelve a intentar. En el ultimo intento
 * se pide ayuda al usuario en vez de rendirse con el formulario a medias.
 */
async function saltarAlCentroDeAyuda(job, opciones) {
  for (let intento = 1; intento <= INTENTOS_SALTO_AYUDA; intento++) {
    const ultimo = intento === INTENTOS_SALTO_AYUDA;

    const pulsado = await irACentroDeAyuda({
      ...opciones,
      esperaManualMs: ultimo ? PAGE_TIMEOUT_MS : 0,
    });

    const hasta = Date.now() + (pulsado ? ESPERA_SALTO_MS : 2000);
    while (Date.now() < hasta) {
      await sleep(1000, opciones.signal);
      if (!await seguimosConElJob(job.id)) {
        traza('navegacion', 'El salto a la mesa de ayuda prendio', { intento });
        return;
      }
    }

    trazaAviso('navegacion', 'La mesa de ayuda no se abrio: se reintenta', {
      intento,
      de: INTENTOS_SALTO_AYUDA,
      seLlegoAPulsar: pulsado,
    });
  }

  throw new Error('No se pudo entrar al centro de ayuda desde la navbar de SellerCenter');
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
    // service worker ya no tiene trabajo pendiente. El detalle lo manda el
    // propio service worker (que pestana es la suya, si el run sigue vivo…).
    traza('despachador', 'Sin trabajo para esta pestana', {
      respondio: Boolean(res),
      motivo: res ? 'el service worker no asigno job a esta pestana' : 'el service worker no respondio',
      ...(res?.motivo || {}),
    });

    // Con un run vivo esta pestana todavia puede ser adoptada (es lo que pasa al
    // saltar a la mesa de ayuda: el content pregunta antes de que el service
    // worker se entere de que la pestana nueva es la de trabajo). Se vuelve a
    // preguntar un rato; sin run activo no hay nada que esperar.
    if (res?.motivo?.runActivo) programarRepregunta();

    return;
  }

  intentosSinTrabajo = 0;

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
        await ancla(anclaListado, 'listado de devoluciones', opciones);

        const siguiente = await buscarOrden(job, opciones);

        // La fase se avisa ANTES de navegar: el clic mata este documento y la
        // pagina siguiente tiene que saber ya en que va la gestion.
        await avanzar(job.id, siguiente);

        if (siguiente === FASE.APELAR) await abrirApelacion(job, opciones);
        else await saltarAlCentroDeAyuda(job, opciones);
        break;
      }

      case FASE.APELAR: {
        await ancla(anclaApelacion, 'formulario de apelacion', opciones);

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
        await ancla(anclaTicket, 'pantalla de soporte', opciones);
        await gestionarTicket(job, opciones);
        break;
      }

      // El envio recargo la pagina: solo queda leer el numero de caso.
      case FASE.CONFIRMACION: {
        await ancla(anclaTicket, 'confirmacion del ticket', opciones);
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

    // Si mientras esperabamos el trabajo se mudo a otra pestana (el usuario dio
    // el salto a mano, o el service worker adopto la de la mesa de ayuda), esto
    // ya no es un fallo NUESTRO: reportarlo mataria una orden que sigue viva.
    if (!await seguimosConElJob(job.id)) {
      trazaAviso('despachador', 'La fase fallo, pero el trabajo ya paso a otra pestana', {
        fase: job.fase,
        orden: job.orden,
        motivo,
      });
      return;
    }

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
    await ancla(anclaTicket, 'pantalla de soporte', opciones);
    await avanzar(job.id, FASE.TICKET);
    await gestionarTicket(job, opciones);
    return;
  }

  if (esAyudaInicio()) {
    await ancla(anclaSoporte, 'navbar de la mesa de ayuda', opciones);
    await avanzar(job.id, FASE.SOPORTE);
    await irASoporte(opciones);
    return;
  }

  await ancla(anclaMenuAyuda, 'menu Ayuda de SellerCenter', opciones);
  await saltarAlCentroDeAyuda(job, opciones);
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
 * Vuelve a preguntar por trabajo dentro de un rato. Es la red de seguridad del
 * salto a la mesa de ayuda: si el service worker adopta esta pestana justo
 * despues de que preguntara, aqui se entera sin esperar a que la pagina navegue.
 * Acotado: una pestana que el usuario abrio por su cuenta deja de insistir.
 */
function programarRepregunta() {
  if (++intentosSinTrabajo > MAX_INTENTOS_SIN_TRABAJO) {
    traza('despachador', 'Esta pestana deja de preguntar por trabajo', {
      intentos: intentosSinTrabajo - 1,
    });
    return;
  }

  setTimeout(() => { despachar().catch(() => { /* no-op */ }); }, REPREGUNTA_MS);
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

/**
 * El service worker avisa a una pestana recien adoptada de que ya tiene trabajo.
 * Es lo que hace que el salto a la mesa de ayuda continue solo en vez de esperar
 * a la siguiente navegacion.
 */
function escucharDespachos() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== GESTION_MESSAGES.DISPATCH) return;

    traza('despachador', 'El service worker pide despachar en esta pestana');

    intentosSinTrabajo = 0;
    despachar().catch(() => { /* no-op */ });
  });
}

export function init() {
  fijarContextoDeTraza(CONTEXTOS.CONTENT);

  escucharDespachos();

  let arrancado = false;

  // Un frame puede volverse relevante DESPUES del load: el portal monta sus
  // pantallas (y sus iframes) cuando le viene bien, asi que se comprueba varias
  // veces en vez de decidirlo de una y para siempre en el `document_idle`.
  const intentar = () => {
    if (arrancado || !paginaRelevante()) return;

    arrancado = true;

    // Una linea por frame: con portales que montan el modulo en un iframe,
    // saber cuantos frames despertaron y cual es cual es media investigacion.
    trazaInfo('despachador', 'Content script activo en esta pantalla', queHayEnEsteDocumento());

    vigilarNavegacion();
    despachar().catch((err) => log.warn?.('despachar', err));
  };

  intentar();

  for (const ms of [1500, 4000, 10_000]) {
    setTimeout(intentar, ms);
  }
}
