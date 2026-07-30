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
  STEP_TIMEOUT_MS,
  TEXTOS,
} from '../constants.js';
import { buscarPorTexto, normalizar } from './dom.js';
import { clickEl } from '../../../../../shared/dom/events.js';
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

/**
 * Menu "Ayuda" de la navbar de SellerCenter. Se localiza por su clase propia y,
 * si el portal la cambia, por el texto del propio menu.
 */
function menuAyuda() {
  const porClase = document.querySelector(SEL.navegacion.menuAyuda);
  if (porClase) return porClase;

  return Array.from(document.querySelectorAll('nav div, header div')).find((el) => {
    const texto = normalizar(el.textContent);
    return texto === 'ayuda' || texto.startsWith('ayuda centro de ayuda');
  }) || null;
}

/**
 * Abre el menu "Ayuda" y pulsa "Centro de ayuda". El submenu se despliega al
 * pasar el raton, asi que hay que simular el hover antes de que el enlace sea
 * pulsable.
 */
export async function irACentroDeAyuda({ signal, onLog } = {}) {
  const menu = await waitFor(menuAyuda, {
    timeout: PAGE_TIMEOUT_MS,
    signal,
    description: 'el menu "Ayuda" de la navbar',
  });

  for (const tipo of ['pointerover', 'mouseover', 'mouseenter']) {
    menu.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true, view: window }));
  }

  const enlace = await waitFor(
    () => buscarPorTexto(menu, SEL.navegacion.enlaceAyuda, TEXTOS.centroAyuda),
    { timeout: STEP_TIMEOUT_MS, signal, description: `el enlace "${TEXTOS.centroAyuda}"` },
  );

  onLog?.('Entrando al centro de ayuda desde la navbar de SellerCenter…');
  clickEl(enlace);

  // La navegacion la hace la propia web; solo dejamos que arranque.
  await sleep(800, signal);
}

/** En la mesa de ayuda, pulsa "Soporte" en su navbar. */
export async function irASoporte({ signal, onLog } = {}) {
  const enlace = await waitFor(
    () => document.querySelector(SEL.navegacion.soporte)
      || buscarPorTexto(document, 'nav a', 'Soporte'),
    { timeout: PAGE_TIMEOUT_MS, signal, description: 'el enlace "Soporte" de la mesa de ayuda' },
  );

  onLog?.('Abriendo la pantalla de soporte…');
  clickEl(enlace);

  await sleep(800, signal);
}

/**
 * Pestana "Nuevo caso": es un cambio de pestana dentro de la misma pagina (no
 * navega), y hasta pulsarla el formulario del ticket ni siquiera existe.
 */
export async function abrirNuevoCaso({ signal, onLog } = {}) {
  const pestana = await waitFor(
    () => buscarPorTexto(document, SEL.navegacion.pestana, TEXTOS.nuevoCaso),
    { timeout: PAGE_TIMEOUT_MS, signal, description: `la pestana "${TEXTOS.nuevoCaso}"` },
  );

  if (pestana.getAttribute('aria-selected') !== 'true') {
    onLog?.('Abriendo la pestana "Nuevo caso"…');
    clickEl(pestana);
  }

  return pestana;
}
