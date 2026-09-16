// Navegacion y pestanas, vistas desde el service worker.
//
// Por que `webNavigation` y no mirarlo desde el content:
//   · `onHistoryStateUpdated` es la unica forma de ver los `pushState` de una
//     SPA. Un content script aislado no ve esa llamada, y la alternativa seria
//     un setInterval mirando `location.href` en cada frame de cada sitio.
//   · `onCommitted` trae `transitionType` (link, form_submit, typed, reload) y
//     `transitionQualifiers` (server_redirect, client_redirect) calculados por el
//     navegador. Es literalmente "que llevo al usuario hasta aca".
//   · `onCreatedNavigationTarget` dice que pestana abrio a que otra pestana, que
//     es como se sigue un `target="_blank"` o el popup de un pago.
//
// Solo se registra el frame principal (`frameId === 0`): los iframes navegan
// solos todo el tiempo (anuncios, widgets) y llenarian el registro de ruido. Lo
// que pasa dentro de un iframe que importa ya lo cuenta su content script.

import { logger } from '../../../shared/utils/logger.js';
import { toMessage } from '../../../shared/errors/index.js';
import { TIPOS } from '../constants.js';

const log = logger('registro-acciones');

/**
 * Solo se registran paginas web de verdad.
 *
 * Sin este filtro, al arrancar la grabacion entran todas las pestanas vacias
 * (`about:blank`), las paginas internas del navegador y — peor — el propio popup
 * de la extension, que ademas es donde el usuario aprieta Iniciar. Es ruido puro
 * y encima delata cosas que no son del flujo que se quiere documentar.
 */
function esPaginaDeTrabajo(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

/** Ultimo estado conocido de cada pestana: al cerrarse ya no se puede consultar. */
const pestanas = new Map();

/** Pestanas abiertas por otra, para poder decir "esto salio de aquel clic". */
const aperturas = new Map();

let enganchado = false;

function recordar(tabId, datos) {
  if (tabId == null) return;
  const previo = pestanas.get(tabId) || {};
  pestanas.set(tabId, { ...previo, ...datos });
}

export function olvidarPestana(tabId) {
  pestanas.delete(tabId);
  aperturas.delete(tabId);
}

export function estadoPestana(tabId) {
  return pestanas.get(tabId) || null;
}

/**
 * @param {object} config
 * @param {(evento:object)=>Promise<number|null>} config.emitir
 * @param {()=>boolean} config.activo
 * @param {(pestanaId:number, ts:number)=>number|null} [config.causaDe]
 * @param {(pestanaId:number)=>void} [config.alCerrarPestana]
 */
export function wireNavegacion(config) {
  if (enganchado) return;
  enganchado = true;

  const { emitir, activo, causaDe = () => null, alCerrarPestana = () => {} } = config;

  const grabando = () => {
    try { return activo(); } catch { return false; }
  };

  const anotar = (evento) => {
    Promise.resolve(emitir(evento)).catch((err) => (
      log.debug('no se pudo anotar el evento de navegacion', { error: toMessage(err) })
    ));
  };

  // --- Pestanas ---------------------------------------------------------------

  chrome.tabs.onCreated.addListener((pestana) => {
    recordar(pestana.id, { url: pestana.url, titulo: pestana.title });
    if (!grabando()) return;
    if (pestana.url && !esPaginaDeTrabajo(pestana.url)) return;

    const abiertaPor = pestana.openerTabId ?? aperturas.get(pestana.id) ?? null;
    anotar({
      tipo: TIPOS.PESTANA_ABIERTA,
      pestanaId: pestana.id,
      url: pestana.url || null,
      titulo: pestana.title || null,
      accionId: abiertaPor != null ? causaDe(abiertaPor, Date.now()) : null,
      datos: {
        abiertaPor,
        enSegundoPlano: pestana.active === false,
      },
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, cambios, pestana) => {
    // Se mantiene el cache aunque no se este grabando: cuando arranque la
    // grabacion ya sabemos donde estaba parada cada pestana.
    if (cambios.url || cambios.title) {
      recordar(tabId, { url: pestana.url, titulo: pestana.title });
    }
  });

  chrome.tabs.onActivated.addListener((info) => {
    if (!grabando()) return;
    const conocida = pestanas.get(info.tabId) || {};
    if (conocida.url && !esPaginaDeTrabajo(conocida.url)) return;

    anotar({
      tipo: TIPOS.PESTANA_ACTIVADA,
      pestanaId: info.tabId,
      url: conocida.url || null,
      titulo: conocida.titulo || null,
      datos: { ventanaId: info.windowId },
    });

    // El titulo puede haber cambiado desde la ultima vez; se refresca sin
    // bloquear el evento (que ya se anoto con lo que habia).
    chrome.tabs.get(info.tabId)
      .then((pestana) => recordar(info.tabId, { url: pestana.url, titulo: pestana.title }))
      .catch(() => { /* la pestana pudo cerrarse */ });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    const conocida = pestanas.get(tabId) || {};
    if (grabando() && esPaginaDeTrabajo(conocida.url)) {
      anotar({
        tipo: TIPOS.PESTANA_CERRADA,
        pestanaId: tabId,
        url: conocida.url || null,
        titulo: conocida.titulo || null,
        datos: {},
      });
    }
    alCerrarPestana(tabId);
    olvidarPestana(tabId);
  });

  // --- Navegacion -------------------------------------------------------------

  if (!chrome.webNavigation) {
    log.warn('webNavigation no esta disponible: la navegacion se registrara solo por los content scripts');
    return;
  }

  chrome.webNavigation.onCreatedNavigationTarget.addListener((detalle) => {
    // Llega ANTES que tabs.onCreated en muchos casos: se guarda para que el
    // evento de pestana nueva sepa de donde salio.
    aperturas.set(detalle.tabId, detalle.sourceTabId);
  });

  chrome.webNavigation.onCommitted.addListener((detalle) => {
    if (detalle.frameId !== 0) return;
    if (!grabando()) return;
    if (!esPaginaDeTrabajo(detalle.url)) return;

    // `urlCommit` es la ultima pagina que ESTE listener vio comprometerse. No
    // sirve `url` a secas: `tabs.onUpdated` ya la actualizo a la pagina nueva
    // antes de que llegue este evento, y el registro diria "de X hacia X".
    const anterior = pestanas.get(detalle.tabId)?.urlCommit || null;
    const calificadores = detalle.transitionQualifiers || [];
    recordar(detalle.tabId, { url: detalle.url, urlCommit: detalle.url });

    anotar({
      tipo: TIPOS.NAVEGACION,
      pestanaId: detalle.tabId,
      frameId: 0,
      url: detalle.url,
      accionId: causaDe(detalle.tabId, detalle.timeStamp || Date.now()),
      datos: {
        urlAnterior: anterior,
        tipo: detalle.transitionType || null,
        calificadores,
        esRedireccion: calificadores.some((q) => q.endsWith('redirect')),
      },
    });
  });

  chrome.webNavigation.onHistoryStateUpdated.addListener((detalle) => {
    if (detalle.frameId !== 0) return;
    if (!grabando()) return;
    if (!esPaginaDeTrabajo(detalle.url)) return;

    const anterior = pestanas.get(detalle.tabId)?.urlCommit || null;
    if (anterior === detalle.url) return;   // replaceState que no cambia nada
    recordar(detalle.tabId, { url: detalle.url, urlCommit: detalle.url });

    anotar({
      tipo: TIPOS.NAVEGACION_SPA,
      pestanaId: detalle.tabId,
      frameId: 0,
      url: detalle.url,
      accionId: causaDe(detalle.tabId, detalle.timeStamp || Date.now()),
      datos: { urlAnterior: anterior, tipo: detalle.transitionType || 'pushState' },
    });
  });

  chrome.webNavigation.onErrorOccurred.addListener((detalle) => {
    if (detalle.frameId !== 0) return;
    if (!grabando()) return;
    if (!esPaginaDeTrabajo(detalle.url)) return;

    anotar({
      tipo: TIPOS.NAVEGACION_ERROR,
      pestanaId: detalle.tabId,
      url: detalle.url,
      datos: { error: detalle.error || null },
    });
  });

  // --- Descargas --------------------------------------------------------------

  if (chrome.downloads?.onCreated) {
    chrome.downloads.onCreated.addListener((descarga) => {
      if (!grabando()) return;
      // Las descargas que genera la propia extension al exportar no cuentan.
      if (descarga.byExtensionId && descarga.byExtensionId === chrome.runtime.id) return;

      anotar({
        tipo: TIPOS.DESCARGA,
        url: descarga.url || null,
        datos: {
          nombreArchivo: descarga.filename || null,
          mime: descarga.mime || null,
        },
      });
    });
  }
}
