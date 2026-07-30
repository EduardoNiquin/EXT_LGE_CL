// Content script de la gestion automatica (Falabella).
//
// En cada carga de pagina pregunta al service worker que job le toca a ESTA
// pestana. Si hay uno y la pagina es la que espera su fase, corre el flujo
// correspondiente y reporta el desenlace. El estado no vive aqui: el flujo
// cruza navegaciones y este documento muere en cada una.
//
// Recorrido completo cuando la devolucion NO esta en el modulo:
//   listado --[navbar Ayuda]--> mesa de ayuda --[navbar Soporte]--> soporte
//           --[pestana Nuevo caso]--> formulario --[Enviar]--> n° de caso
//
// Nada se automatiza en pestanas que el usuario abrio por su cuenta: el SW solo
// responde a la pestana de trabajo del run.

import { FASE, GESTION_MESSAGES, RESULTADO } from '../constants.js';
import { abrirApelacion, buscarOrden, esPaginaListado } from './buscar.js';
import { apelar, esPaginaApelacion } from './apelar.js';
import { esPaginaTicket, leerConfirmacion, levantarTicket } from './ticket.js';
import {
  esAyudaInicio,
  esAyudaSoporte,
  esSellerCenter,
  irACentroDeAyuda,
  irASoporte,
} from './navegacion.js';
import { toMessage } from '../../../../../shared/errors/index.js';
import { logger } from '../../../../../shared/utils/logger.js';

const log = logger('devoluciones-gestion');

let corriendo = false;

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

/** ¿Alguna de las paginas que automatizamos? Evita preguntar en cada web. */
function paginaRelevante() {
  return esPaginaListado() || esPaginaApelacion() || esSellerCenter()
    || esAyudaInicio() || esAyudaSoporte();
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
  if (corriendo || window !== window.top || !paginaRelevante()) return;

  const res = await enviar({ type: GESTION_MESSAGES.GET_JOB });
  const job = res?.job;
  if (!job) return;

  corriendo = true;
  const opciones = {
    prueba: Boolean(res.prueba),
    pedirArchivos: (scope) => pedirArchivos(job.id, scope),
    onLog: (message) => bitacora(message),
  };

  try {
    switch (job.fase) {
      case FASE.BUSCAR: {
        if (!esPaginaListado()) break;

        const siguiente = await buscarOrden(job, opciones);

        // La fase se avisa ANTES de navegar: el clic mata este documento y la
        // pagina siguiente tiene que saber ya en que va la gestion.
        await avanzar(job.id, siguiente);

        if (siguiente === FASE.APELAR) await abrirApelacion(job, opciones);
        else await irACentroDeAyuda(opciones);
        break;
      }

      case FASE.APELAR: {
        if (!esPaginaApelacion()) break;

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
      case FASE.AYUDA: {
        if (esAyudaSoporte()) {
          await avanzar(job.id, FASE.TICKET);
          await gestionarTicket(job, opciones);
        } else if (esAyudaInicio()) {
          await avanzar(job.id, FASE.SOPORTE);
          await irASoporte(opciones);
        } else if (esSellerCenter()) {
          await irACentroDeAyuda(opciones);
        }
        break;
      }

      case FASE.SOPORTE: {
        if (esAyudaSoporte()) {
          await avanzar(job.id, FASE.TICKET);
          await gestionarTicket(job, opciones);
        } else if (esAyudaInicio()) {
          await irASoporte(opciones);
        }
        break;
      }

      case FASE.TICKET: {
        if (!esPaginaTicket()) break;
        await gestionarTicket(job, opciones);
        break;
      }

      // El envio recargo la pagina: solo queda leer el numero de caso.
      case FASE.CONFIRMACION: {
        if (!esPaginaTicket()) break;
        await reportarTicket(job.id, await leerConfirmacion(opciones));
        break;
      }

      default:
        break;
    }
  } catch (err) {
    const motivo = toMessage(err);
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

export function init() {
  if (window !== window.top || !paginaRelevante()) return;

  // Las pantallas de SellerCenter y Salesforce montan su DOM despues del load;
  // el despacho reintenta una vez antes de rendirse (los flujos tienen sus
  // propias esperas, esto solo cubre el arranque tardio de la SPA).
  despachar().catch((err) => log.warn?.('despachar', err));
  setTimeout(() => { despachar().catch(() => { /* no-op */ }); }, 2500);
}
