// Que paso DESPUES de cada accion.
//
// Esto es lo que convierte el registro en algo automatizable: no basta con
// "aprete Guardar", hace falta "y entonces aparecio la mascara de carga, y
// despues el mensaje 'You saved the rule'". Quien automatice ese paso necesita
// saber que esperar.
//
// El MutationObserver **no vive permanentemente**: se conecta durante una
// ventana de LIMITES.ventanaCausaMs despues de un clic / submit / Enter y se
// desconecta sola. Un observer con `subtree:true` corriendo siempre en todos los
// frames de todos los sitios degradaria paginas pesadas (Salesforce LWC, las
// grillas TUI de PIM), que es justo lo que no podemos permitirnos.

import { describeBreve, limpiar } from '../../../shared/dom/describe.js';
import { LIMITES, TIPOS } from '../constants.js';

const SELECTOR_DIALOGO = 'dialog, [role=dialog], [role=alertdialog], .modal, .ui-dialog';
const SELECTOR_CARGANDO = '.loading-mask, .loader, .spinner, [aria-busy=true], .admin__data-grid-loading-mask';
const SELECTOR_MENSAJE = '[role=alert], [role=status], .message, .alert, .toast, .notification, .growl, .validation-advice, .mage-error';

/** Cuantos nodos se miran por tanda: una mutacion puede traer cientos. */
const NODOS_POR_TANDA = 30;

let emitir = null;
let observador = null;
let cierre = null;
let accionRef = null;
let accionTs = 0;
let anotadas = 0;
let pendientes = [];
let cuadroPedido = false;

export function configurar(opciones = {}) {
  emitir = typeof opciones.emitir === 'function' ? opciones.emitir : null;
}

function clasificar(el) {
  try {
    if (!el || el.nodeType !== 1) return null;
    if (el.matches?.(SELECTOR_CARGANDO) || el.querySelector?.(SELECTOR_CARGANDO)) return 'cargando';
    if (el.matches?.(SELECTOR_DIALOGO) || el.querySelector?.(SELECTOR_DIALOGO)) return 'dialogo';
    if (el.matches?.(SELECTOR_MENSAJE) || el.querySelector?.(SELECTOR_MENSAJE)) return 'mensaje';
    if (el.matches?.('table') || el.querySelector?.('table')) return 'tabla';
    return null;
  } catch {
    return null;
  }
}

/** Afina la clase del mensaje segun lo que diga su clase CSS. */
function matizMensaje(el) {
  try {
    const clases = String(el.className || '').toLowerCase();
    if (/error|danger|invalid|advice/.test(clases)) return 'error';
    if (/success|exito|ok\b/.test(clases)) return 'exito';
  } catch { /* no-op */ }
  return 'mensaje';
}

/** El elemento concreto que encaja con la clase, no su contenedor. */
function elementoRelevante(el, clase) {
  try {
    const selector = clase === 'cargando' ? SELECTOR_CARGANDO
      : clase === 'dialogo' ? SELECTOR_DIALOGO
        : clase === 'mensaje' ? SELECTOR_MENSAJE
          : 'table';
    if (el.matches?.(selector)) return el;
    return el.querySelector?.(selector) || el;
  } catch {
    return el;
  }
}

function anotar(tipo, el, clase) {
  if (!emitir || anotadas >= LIMITES.consecuenciasMax) return;

  const objetivo = elementoRelevante(el, clase);
  const claseFinal = clase === 'mensaje' ? matizMensaje(objetivo) : clase;

  anotadas++;
  emitir({
    tipo,
    accionRef,
    datos: {
      clase: claseFinal,
      elemento: describeBreve(objetivo),
      texto: limpiar(objetivo.textContent, 160),
      msDesdeAccion: Date.now() - accionTs,
    },
  });
}

function procesarPendientes() {
  cuadroPedido = false;
  const mutaciones = pendientes;
  pendientes = [];

  let mirados = 0;

  for (const mutacion of mutaciones) {
    if (anotadas >= LIMITES.consecuenciasMax) break;

    for (const nodo of mutacion.addedNodes || []) {
      if (mirados++ > NODOS_POR_TANDA) return;
      const clase = clasificar(nodo);
      if (clase) anotar(TIPOS.APARECIO, nodo, clase);
    }

    for (const nodo of mutacion.removedNodes || []) {
      if (mirados++ > NODOS_POR_TANDA) return;
      const clase = clasificar(nodo);
      // Que se vaya una tabla o un mensaje no dice nada; que se cierre un modal
      // o termine una carga, si: es la senal de "ya puedes seguir".
      if (clase === 'dialogo' || clase === 'cargando') anotar(TIPOS.DESAPARECIO, nodo, clase);
    }
  }
}

function alMutar(mutaciones) {
  pendientes.push(...mutaciones);
  if (cuadroPedido) return;
  cuadroPedido = true;

  const agendar = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16);
  agendar(procesarPendientes);
}

/**
 * Abre (o reinicia) la ventana de observacion despues de una accion.
 *
 * @param {string} ref  referencia local de la accion que la provoca
 */
export function observarTras(ref) {
  if (!emitir || typeof MutationObserver !== 'function') return;

  accionRef = ref;
  accionTs = Date.now();
  anotadas = 0;

  if (cierre) clearTimeout(cierre);
  cierre = setTimeout(cerrar, LIMITES.ventanaCausaMs);

  if (observador) return;   // ya estaba mirando: solo se reinicio el reloj

  try {
    observador = new MutationObserver(alMutar);
    observador.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      // Sin `attributes` ni `characterData`: son los que disparan miles de
      // mutaciones por segundo en las SPA y no aportan a "que aparecio".
    });
  } catch {
    observador = null;
  }
}

/** Cierra la ventana y suelta el observer. */
export function cerrar() {
  if (cierre) {
    clearTimeout(cierre);
    cierre = null;
  }
  if (observador) {
    try { observador.disconnect(); } catch { /* no-op */ }
    observador = null;
  }
  pendientes = [];
  cuadroPedido = false;
  accionRef = null;
  anotadas = 0;
}

export function estadoConsecuencias() {
  return { observando: Boolean(observador), accionRef, anotadas };
}
