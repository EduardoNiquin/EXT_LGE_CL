// La pagina en si: donde esta parado el usuario y que hay disponible ahi.
//
// El inventario (la radiografia de formularios, botones y tablas) se calcula UNA
// vez por visita y en tiempo ocioso: es el recorrido mas caro de la feature y no
// puede competir con el render de la pagina.
//
// El cambio de URL lo detecta el service worker con `webNavigation`, que es lo
// unico que ve los `pushState`. Aqui solo se escuchan `popstate` y `hashchange`
// como refuerzo (el SW deduplica): sirven para que el frame recalcule su
// inventario cuando la SPA cambia de pantalla sin recargar.

import { inventarioPagina } from '../../../shared/dom/inventario.js';
import { limpiar } from '../../../shared/dom/describe.js';
import { crearPolitica } from '../privacidad.js';
import { LIMITES, TIPOS } from '../constants.js';

let emitir = null;
let opciones = {};
let politica = crearPolitica();
let temporizadorInventario = null;
let ultimaUrl = '';
let enganchado = false;

/** Un iframe de publicidad no merece inventario; uno con un formulario, si. */
function frameConTrabajo() {
  try {
    if (window === window.top) return true;
    return Boolean(document.querySelector('form, table, input, select, button'));
  } catch {
    return false;
  }
}

function anunciarVisita() {
  if (!emitir) return;
  ultimaUrl = location.href;

  emitir({
    tipo: TIPOS.PAGINA_VISITA,
    datos: {
      titulo: limpiar(document.title, 160),
      referente: document.referrer || null,
      estadoCarga: document.readyState,
      idioma: document.documentElement?.lang || null,
      ancho: window.innerWidth,
      alto: window.innerHeight,
      urlFramePadre: window === window.top ? null : (document.referrer || null),
    },
  });
}

function tomarInventario() {
  if (!emitir || opciones.inventario === false) return;
  if (!frameConTrabajo()) return;

  try {
    const inventario = inventarioPagina(document, { valor: politica });
    if (!inventario) return;
    emitir({ tipo: TIPOS.PAGINA_INVENTARIO, datos: inventario });
  } catch { /* una pagina rara no puede tumbar la grabacion */ }
}

/** Agenda el inventario para cuando el navegador no tenga nada mejor que hacer. */
function programarInventario(espera = LIMITES.inventarioEsperaMs) {
  if (temporizadorInventario) clearTimeout(temporizadorInventario);

  temporizadorInventario = setTimeout(() => {
    temporizadorInventario = null;
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => tomarInventario(), { timeout: 2000 });
    } else {
      tomarInventario();
    }
  }, espera);
}

/**
 * La SPA cambio de pantalla sin recargar.
 *
 * El evento de navegacion NO se emite aca: lo emite el service worker con
 * `webNavigation.onHistoryStateUpdated`, que ademas ve los `pushState` que este
 * mundo aislado no puede ver. Duplicarlo daria dos entradas para un solo salto.
 * Lo que si corresponde a este frame es volver a presentarse (titulo y URL
 * nuevos) y rehacer su radiografia, porque la pantalla es otra.
 */
function alCambiarHistorial() {
  if (!emitir) return;
  const url = location.href;
  if (url === ultimaUrl) return;

  anunciarVisita();
  programarInventario(LIMITES.inventarioDebounceMs);
}

/**
 * @param {object} config
 * @param {(evento:object, opciones?:object)=>string|null} config.emitir
 * @param {object} [config.opciones]
 */
export function iniciarPagina(config) {
  emitir = config.emitir;
  opciones = config.opciones || {};
  politica = crearPolitica({ enmascararContacto: opciones.enmascararContacto });

  anunciarVisita();
  programarInventario();

  if (enganchado) return;
  enganchado = true;
  window.addEventListener('popstate', alCambiarHistorial, { passive: true });
  window.addEventListener('hashchange', alCambiarHistorial, { passive: true });
}

export function detenerPagina() {
  if (temporizadorInventario) {
    clearTimeout(temporizadorInventario);
    temporizadorInventario = null;
  }
  if (!enganchado) return;
  enganchado = false;
  window.removeEventListener('popstate', alCambiarHistorial);
  window.removeEventListener('hashchange', alCambiarHistorial);
}

/** Fuerza un inventario ahora (Debug API). */
export function inventarioAhora() {
  const inventario = inventarioPagina(document, { valor: politica });
  if (emitir && inventario) emitir({ tipo: TIPOS.PAGINA_INVENTARIO, datos: inventario });
  return inventario;
}
