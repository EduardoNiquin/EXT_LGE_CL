// Comandos de depuracion: __extLgeCl.registroAcciones.*
//
// Se registra en los dos contextos donde sirve, y cada comando funciona en el
// que tenga sentido: los de DOM (describir, inventario) solo valen en el content
// script; los de estado hablan con el service worker por mensaje, asi que
// responden igual desde la consola del popup.

import { cmd, register } from '../../shared/debug/index.js';
import { sendMessage } from '../../shared/messaging/messaging.js';
import { cssPath, describeElement, rutaSelector } from '../../shared/dom/describe.js';
import { inventarioPagina } from '../../shared/dom/inventario.js';
import { MESSAGES } from './constants.js';
import { crearPolitica, motivoSensible } from './privacidad.js';
import { duracionEfectiva, getOpciones, getRun } from './state.js';
import { resumirEvento } from './resumen.js';

const hayDom = () => typeof document !== 'undefined' && Boolean(document.body);

function soloEnLaPagina() {
  return 'Este comando corre en el content script: abre la consola de la pestana (contexto de la extension).';
}

/**
 * Los comandos se guardan en este objeto para poder ampliarlos despues sin
 * pisar los que ya estaban: el content script agrega los suyos (los que hablan
 * del frame) llamando a `ampliarDebug`.
 *
 * Esto NO se resuelve con un `import()` dinamico del content: los imports
 * dinamicos estan prohibidos dentro de un service worker
 * (ServiceWorkerGlobalScope), y este mismo archivo se carga alli.
 */
const comandos = {
  estado: cmd(async () => {
    const respuesta = await sendMessage({ type: MESSAGES.ESTADO });
    return respuesta?.ok ? respuesta : { error: respuesta?.reason || 'sin respuesta del service worker' };
  }, 'Estado de la grabacion: run, eventos guardados y memoria del service worker'),

  run: cmd(async () => {
    const run = await getRun();
    if (!run) return null;
    return { ...run, duracionEfectivaMs: duracionEfectiva(run) };
  }, 'El run persistido tal cual, con la duracion sin contar las pausas'),

  opciones: cmd(() => getOpciones(), 'Opciones de grabacion vigentes'),

  ultimos: cmd(async (cantidad = 20) => {
    const respuesta = await sendMessage({ type: MESSAGES.ULTIMOS, cantidad });
    if (!respuesta?.ok) return { error: respuesta?.reason || 'sin respuesta' };
    return respuesta.eventos.map((evento) => ({
      id: evento.id,
      tipo: evento.tipo,
      resumen: resumirEvento(evento),
      url: evento.url,
      pestanaId: evento.pestanaId,
      accionId: evento.accionId,
    }));
  }, 'Los ultimos N eventos guardados, resumidos (ej: ultimos(50))'),

  crudo: cmd(async (cantidad = 5) => {
    const respuesta = await sendMessage({ type: MESSAGES.ULTIMOS, cantidad });
    return respuesta?.ok ? respuesta.eventos : { error: respuesta?.reason || 'sin respuesta' };
  }, 'Los ultimos N eventos completos, sin resumir'),

  iniciar: cmd(() => sendMessage({ type: MESSAGES.INICIAR }), 'Inicia una grabacion'),
  pausar: cmd(() => sendMessage({ type: MESSAGES.PAUSAR }), 'Pausa la grabacion'),
  reanudar: cmd(() => sendMessage({ type: MESSAGES.REANUDAR }), 'Reanuda la grabacion'),

  detener: cmd((exportar = true) => sendMessage({ type: MESSAGES.DETENER, exportar }),
    'Detiene la grabacion; detener(false) termina sin generar archivos'),

  exportar: cmd(() => sendMessage({ type: MESSAGES.EXPORTAR }),
    'Vuelve a generar y descargar los archivos de la ultima sesion'),

  descartar: cmd(() => sendMessage({ type: MESSAGES.DESCARTAR }),
    'Borra los eventos guardados y el run'),

  // --- Solo en la pagina -----------------------------------------------------

  describir: cmd((selector) => {
    if (!hayDom()) return soloEnLaPagina();
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return `No se encontro ${selector}`;
    return describeElement(el, { valor: crearPolitica() });
  }, 'Como se guardaria ese elemento: describir("#boton")'),

  selector: cmd((selector) => {
    if (!hayDom()) return soloEnLaPagina();
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return `No se encontro ${selector}`;
    return { selector: cssPath(el), tramos: rutaSelector(el) };
  }, 'El selector que se generaria para ese elemento (y sus tramos de shadow DOM)'),

  inventario: cmd(() => {
    if (!hayDom()) return soloEnLaPagina();
    return inventarioPagina(document, { valor: crearPolitica() });
  }, 'Radiografia de la pagina actual, como quedaria en el archivo'),

  sensible: cmd((selector) => {
    if (!hayDom()) return soloEnLaPagina();
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return `No se encontro ${selector}`;
    const motivo = motivoSensible(el, el.value || '');
    return motivo ? `Se enmascara (${motivo})` : 'Se guarda el valor tal cual';
  }, 'Dice si el valor de ese campo se guardaria oculto y por que'),

  diagnose: cmd(async () => {
    const run = await getRun();
    return {
      contexto: hayDom() ? 'content' : 'service-worker / popup',
      grabando: Boolean(run?.active),
      pausado: Boolean(run?.paused),
      sesionId: run?.sesionId || null,
      eventos: run?.contadores?.total || 0,
      // El content script suma aca el detalle de su frame (ver ampliarDebug).
    };
  }, 'Diagnostico del contexto actual'),
};

register('registroAcciones', comandos);

/**
 * Suma comandos al namespace ya registrado. Lo usa el content script para
 * aportar los que solo tienen sentido dentro de una pagina.
 */
export function ampliarDebug(extra) {
  Object.assign(comandos, extra);
  register('registroAcciones', comandos);
}

export { cmd };
