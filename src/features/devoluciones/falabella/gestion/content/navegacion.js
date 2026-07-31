// Camino hasta el formulario de ticket, saltando por la navbar.
//
// A la mesa de ayuda NO se puede entrar por su URL: hacerlo cae en otro login y
// pide credenciales distintas. Hay que llegar desde SellerCenter, ya con la
// sesion puesta, y dejar que la propia web haga el salto:
//
//   SellerCenter  --[menu Ayuda > Centro de ayuda]-->  ayudaseller.../s/
//                 --[navbar > Soporte]-------------->  .../s/soporteseller
//                 --[pestana Nuevo caso]------------>  formulario del ticket
//
// Cada salto es una navegacion completa, asi que cada uno vive en su propia
// fase del job: este documento muere en el camino y el siguiente retoma.

import {
  HELP_HOST,
  HELP_SUPPORT_PATH,
  PAGE_TIMEOUT_MS,
  SEL,
  SELLERCENTER_HOST,
  TEXTOS,
} from '../constants.js';
import { buscarPorTexto, clickReal, normalizar, pasarElRaton, primero, todos } from './dom.js';
import { traza, trazaAviso, trazaInfo } from '../../../trace.js';
import { sleep, waitFor } from '../../../../../shared/dom/wait.js';

/** ¿Estamos en SellerCenter (cualquier pantalla con su navbar)? */
export function esSellerCenter() {
  return location.hostname.includes(SELLERCENTER_HOST);
}

/** ¿Estamos en la mesa de ayuda, pero aun no en la pantalla de soporte? */
export function esAyudaInicio() {
  return location.hostname.includes(HELP_HOST) && !location.pathname.includes(HELP_SUPPORT_PATH);
}

/** ¿Estamos en la pantalla de soporte (donde vive el formulario del ticket)? */
export function esAyudaSoporte() {
  return location.hostname.includes(HELP_HOST) && location.pathname.includes(HELP_SUPPORT_PATH);
}

/** Anclaje para saltar al centro de ayuda: el menu "Ayuda" de la navbar. */
export function anclaMenuAyuda() {
  return menuAyuda();
}

/**
 * Anclaje de la mesa de ayuda: el enlace "Soporte" de su navbar.
 *
 * Salesforce Communities monta la navbar con **shadow DOM nativo**: el `<nav>`
 * no cuelga del documento, asi que `document.querySelector` no lo ve nunca.
 */
export function anclaSoporte() {
  return primero(SEL.navegacion.soporte)
    || buscarPorTexto(document, 'nav a', 'Soporte');
}

/**
 * Menu "Ayuda" de la navbar de SellerCenter. Se localiza por su clase propia y,
 * si el portal la cambia, por el texto del propio menu.
 */
function menuAyuda() {
  const porClase = primero(SEL.navegacion.menuAyuda);
  if (porClase) return porClase;

  return todos(['nav div', 'header div']).find((el) => {
    const texto = normalizar(el.textContent);
    return texto === 'ayuda' || texto.startsWith('ayuda centro de ayuda');
  }) || null;
}

/**
 * El enlace "Centro de ayuda", si el submenu esta desplegado.
 *
 * Se busca primero dentro del menu y despues en TODO el documento: el submenu
 * puede montarse fuera de su contenedor (portales) o existir pero estar oculto
 * por CSS. Da igual que no se vea — un clic por codigo dispara su manejador
 * igual, y ese camino es el unico que funciona cuando el despliegue depende del
 * `:hover` de CSS, que ningun evento sintetico puede activar.
 */
function enlaceCentroDeAyuda(menu) {
  return buscarPorTexto(menu, SEL.navegacion.enlaceAyuda, TEXTOS.centroAyuda)
    || buscarPorTexto(document, SEL.navegacion.enlaceAyuda, TEXTOS.centroAyuda);
}

/** Elementos "pulsables" dentro del menu: a veces el manejador esta en un hijo. */
function interiorDelMenu(menu) {
  return todos(['a', 'button', 'span', 'div', 'svg'], menu).slice(0, 6);
}

/**
 * Formas de desplegar el menu, de la mas parecida a un usuario a la mas
 * insistente. Se prueban en orden y entre cada una se mira si aparecio el
 * enlace: asi la que funcione queda anotada en el registro y la proxima
 * investigacion empieza sabiendo cual es.
 */
const ESTRATEGIAS_MENU = [
  { nombre: 'raton encima', aplicar: (menu) => pasarElRaton(menu) },
  { nombre: 'clic en el menu', aplicar: (menu) => clickReal(menu) },
  { nombre: 'raton sobre su interior', aplicar: (menu) => interiorDelMenu(menu).forEach((el) => pasarElRaton(el)) },
  { nombre: 'clic nativo', aplicar: (menu) => menu.click?.() },
  {
    nombre: 'teclado',
    aplicar: (menu) => {
      try { menu.focus?.({ preventScroll: true }); } catch { /* sin foco */ }
      for (const tipo of ['keydown', 'keyup']) {
        menu.dispatchEvent(new KeyboardEvent(tipo, {
          key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true, composed: true,
        }));
      }
    },
  },
];

/** Cuanto se espera al enlace despues de cada intento de desplegar el menu. */
const ESPERA_POR_ESTRATEGIA_MS = 1500;

/**
 * Despliega el menu "Ayuda" y devuelve el enlace "Centro de ayuda".
 *
 * Aqui era donde la gestion se quedaba parada: el submenu no llegaba a existir y
 * habia que abrirlo a mano. En vez de un unico intento, se prueban varias formas
 * de activarlo y, si ninguna sirve, **se pide ayuda por la bitacora y se sigue
 * esperando**: en cuanto el usuario pasa el raton, el enlace aparece y la
 * gestion continua sola. Nunca se entra por la URL de la mesa de ayuda, que cae
 * en otro login.
 */
async function abrirMenuAyuda(menu, { signal, onLog, esperaManualMs = PAGE_TIMEOUT_MS } = {}) {
  // Si ya estuviera desplegado, no se toca: un clic de mas lo cerraria.
  const yaAbierto = enlaceCentroDeAyuda(menu);
  if (yaAbierto) {
    traza('navegacion', 'El menu "Ayuda" ya estaba desplegado');
    return yaAbierto;
  }

  for (const estrategia of ESTRATEGIAS_MENU) {
    try { estrategia.aplicar(menu); } catch { /* la siguiente lo intenta */ }

    const enlace = await waitFor(
      () => enlaceCentroDeAyuda(menu),
      { timeout: ESPERA_POR_ESTRATEGIA_MS, signal, description: `el enlace "${TEXTOS.centroAyuda}"` },
    ).catch(() => null);

    if (enlace) {
      trazaInfo('navegacion', 'El menu "Ayuda" se desplego', {
        con: estrategia.nombre,
        dentroDelMenu: menu.contains(enlace),
      });

      return enlace;
    }
  }

  trazaAviso('navegacion', 'Ninguna estrategia desplego el menu "Ayuda"', {
    estrategias: ESTRATEGIAS_MENU.map((e) => e.nombre),
    textoDelMenu: normalizar(menu.textContent).slice(0, 80),
    seEsperaAlUsuario: esperaManualMs > 0,
  });

  // Sin espera manual devolvemos las manos vacias: quien llama reintentara el
  // salto entero, que es mejor que quedarse mirando este menu.
  if (esperaManualMs <= 0) return null;

  onLog?.('No pude desplegar el menu "Ayuda" solo: abrelo tu (Ayuda › Centro de ayuda) y la gestion sigue.');

  const enlace = await waitFor(
    () => enlaceCentroDeAyuda(menu),
    { timeout: esperaManualMs, signal, description: `el enlace "${TEXTOS.centroAyuda}"` },
  );

  trazaAviso('navegacion', 'El menu lo abrio el usuario');

  return enlace;
}

/**
 * Abre el menu "Ayuda" y pulsa "Centro de ayuda".
 *
 * Ojo: el enlace no navega esta pestana — su manejador abre la mesa de ayuda en
 * una **pestana nueva y de fondo**. Desde aqui no hay forma de ver si prendio
 * (ni la URL cambia ni este documento se oculta), asi que la comprobacion la
 * hace quien llama preguntandole al service worker, que si ve nacer la pestana.
 *
 * @returns {Promise<boolean>} si se llego a pulsar el enlace.
 */
export async function irACentroDeAyuda({ signal, onLog, esperaManualMs = PAGE_TIMEOUT_MS } = {}) {
  const menu = await waitFor(menuAyuda, {
    timeout: PAGE_TIMEOUT_MS,
    signal,
    description: 'el menu "Ayuda" de la navbar',
  });

  const enlace = await abrirMenuAyuda(menu, { signal, onLog, esperaManualMs });
  if (!enlace) return false;

  onLog?.('Entrando al centro de ayuda desde la navbar de SellerCenter…');
  traza('navegacion', 'Se pulsa "Centro de ayuda"', {
    href: enlace.getAttribute?.('href') || null,
    destino: enlace.getAttribute?.('target') || null,
  });

  clickReal(enlace);

  // La navegacion la hace la propia web; solo dejamos que arranque.
  await sleep(800, signal);

  return true;
}

/** En la mesa de ayuda, pulsa "Soporte" en su navbar. */
export async function irASoporte({ signal, onLog } = {}) {
  const enlace = await waitFor(
    anclaSoporte,
    { timeout: PAGE_TIMEOUT_MS, signal, description: 'el enlace "Soporte" de la mesa de ayuda' },
  );

  onLog?.('Abriendo la pantalla de soporte…');
  clickReal(enlace);

  await sleep(800, signal);
}

/**
 * Pestana "Nuevo caso": es un cambio de pestana dentro de la misma pagina (no
 * navega), y hasta pulsarla el formulario del ticket ni siquiera existe.
 */
export async function abrirNuevoCaso({ signal, onLog } = {}) {
  // Las pestanas tambien viven en el shadow DOM de Salesforce; `buscarPorTexto`
  // ya lo cruza.
  const pestana = await waitFor(
    () => buscarPorTexto(document, SEL.navegacion.pestana, TEXTOS.nuevoCaso),
    { timeout: PAGE_TIMEOUT_MS, signal, description: `la pestana "${TEXTOS.nuevoCaso}"` },
  );

  if (pestana.getAttribute('aria-selected') !== 'true') {
    onLog?.('Abriendo la pestana "Nuevo caso"…');
    clickReal(pestana);
  }

  return pestana;
}
