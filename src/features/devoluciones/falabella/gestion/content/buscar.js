// Fase BUSCAR: ¿esta la orden en el modulo de devoluciones de SellerCenter?
//
// No todas las devoluciones aparecen aqui. Si esta, se apela desde la propia
// tabla ("No, rechazar"); si no, hay que levantar un ticket de soporte. Esta
// decision es la bifurcacion de todo el flujo, asi que se toma mirando la tabla
// ya filtrada por el numero de orden, nunca por un vistazo parcial.

import { FASE, SEL, STEP_TIMEOUT_MS } from '../constants.js';
import { escribirEn, normalizar, primero, raizDe, todos } from './dom.js';
import { traza, trazaAviso, trazaInfo } from '../../../trace.js';
import { clickEl } from '../../../../../shared/dom/events.js';
import { sleep, waitFor } from '../../../../../shared/dom/wait.js';

/** Solo los digitos: los numeros de orden se comparan sin formato. */
function digitos(valor) {
  return String(valor ?? '').replace(/\D+/g, '');
}

/**
 * Busca la orden y devuelve la fase siguiente:
 *   - FASE.APELAR si aparece (se apela desde la propia tabla).
 *   - FASE.AYUDA si la tabla queda vacia (hay que ir a levantar un ticket, y a
 *     la mesa de ayuda se llega por la navbar, no por URL).
 *
 * @returns {Promise<string>} la fase siguiente.
 */
export async function buscarOrden(job, { signal, onLog } = {}) {
  const numero = digitos(job.orden);
  if (!numero) throw new Error('La orden no tiene numero utilizable');

  // El anclaje ya lo esperó el despachador: si estamos aquí, esta pantalla es
  // la del listado y el buscador existe. La raiz se resuelve UNA vez y se pasa a
  // todo lo demas: el modulo vive en un shadow root, y ademas asi no se recorre
  // el arbol entero en cada vuelta de las esperas.
  const raiz = raizModulo();
  const input = anclaListado();
  if (!input) throw new Error('El buscador de ordenes desaparecio de la pantalla');

  trazaInfo('buscar', 'Empieza la busqueda de la orden', {
    orden: numero,
    selectorQueEncajo: selectorDelBuscador(raiz),
    placeholder: input.placeholder || null,
    enShadowDom: raiz !== document,
  });

  await waitFor(() => raiz.querySelector(SEL.buscar.tabla), {
    timeout: STEP_TIMEOUT_MS,
    signal,
    description: 'la tabla de devoluciones',
  });

  traza('buscar', 'Tabla presente antes de escribir', radiografiaDeLaTabla(raiz));

  escribirEn(input, numero);

  // Lo que de verdad quedo en el campo: si React no se entero, aqui se ve.
  traza('buscar', 'Numero escrito en el buscador', {
    pedido: numero,
    enElCampo: input.value,
    coincide: input.value === numero,
  });

  dispararBusqueda(input, raiz);

  onLog?.(`Buscando la orden ${numero} en el modulo de devoluciones…`);

  // La tabla se repinta de forma asincrona. Esperamos a un desenlace claro: o
  // una fila con NUESTRO numero, o el cartel de "sin datos". Un timeout aqui no
  // se interpreta como "no esta" — seria levantar un ticket por error.
  let ultimaRadiografia = null;

  const desenlace = await waitFor(() => {
    // Se apunta como va cambiando la tabla: es lo unico que explica por que un
    // desenlace tarda (o por que no llega).
    const radiografia = radiografiaDeLaTabla(raiz);

    if (JSON.stringify(radiografia) !== JSON.stringify(ultimaRadiografia)) {
      ultimaRadiografia = radiografia;
      traza('buscar', 'La tabla cambio', radiografia);
    }

    const fila = filaDeLaOrden(numero, raiz);
    if (fila) return { fila };

    const vacio = raiz.querySelector(SEL.buscar.vacio);
    const sinFilas = todos(SEL.buscar.filas, raiz).length === 0;
    if (vacio || sinFilas) return { vacia: true };

    return null;
  }, {
    timeout: STEP_TIMEOUT_MS,
    signal,
    description: `el resultado de buscar la orden ${numero}`,
  }).catch((err) => {
    // El timeout aqui es informativo de verdad: dice que habia en pantalla.
    trazaAviso('buscar', 'Sin desenlace claro al buscar', {
      orden: numero,
      enElCampo: input.value,
      ...radiografiaDeLaTabla(raiz),
    });
    throw err;
  });

  if (desenlace.vacia) {
    trazaInfo('buscar', 'La orden NO esta en el modulo: se ira a ticket', { orden: numero });
    onLog?.(`La orden ${numero} no esta en el modulo de devoluciones: se levantara un ticket.`);
    return FASE.AYUDA;
  }

  const boton = Array.from(desenlace.fila.querySelectorAll(SEL.buscar.acciones))
    .find((b) => normalizar(b.textContent).includes('rechazar'));

  if (!boton) {
    trazaAviso('buscar', 'Fila encontrada pero sin boton de rechazo', {
      orden: numero,
      botones: Array.from(desenlace.fila.querySelectorAll(SEL.buscar.acciones)).map((b) => b.textContent.trim()),
    });
    throw new Error('La fila no ofrece el boton "No, rechazar"');
  }

  trazaInfo('buscar', 'La orden SI esta en el modulo: se apelara', { orden: numero });
  onLog?.(`La orden ${numero} esta en el modulo: se abre la apelacion.`);

  // El aviso de fase va ANTES del clic: el clic navega y este documento muere.
  return FASE.APELAR;
}

/**
 * Lanza la busqueda. El campo NO esta dentro de un `<form>` y su unico manejador
 * de teclado es `onKeyPress`, asi que ni un "Enter" por keydown ni
 * `requestSubmit()` disparan nada: la tabla se queda mostrando la primera pagina
 * y la orden buscada parece no existir. El disparador de verdad es la lupa.
 */
function dispararBusqueda(input, raiz) {
  const lupa = primero(SEL.buscar.lupa, raiz);

  if (lupa) {
    clickEl(lupa);
    traza('buscar', 'Busqueda lanzada con la lupa', { via: 'lupa' });
    return;
  }

  // Respaldo por si el portal se lleva la lupa. `keypress` es el evento que
  // escucha el campo (no `keydown`), asi que va primero.
  for (const tipo of ['keypress', 'keydown', 'keyup']) {
    input.dispatchEvent(new KeyboardEvent(tipo, {
      bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
    }));
  }

  trazaAviso('buscar', 'No se encontro la lupa: se probo con Enter', { via: 'teclado' });
}

/** Cual de los selectores alternativos encontro el buscador. */
function selectorDelBuscador(raiz = document) {
  return [].concat(SEL.buscar.input).find((s) => raiz.querySelector(s)) || null;
}

/**
 * Foto del estado de la tabla: cuantas filas, que ordenes se ven y si esta el
 * cartel de "sin datos". Es lo que permite distinguir "la busqueda no filtro"
 * de "filtro y no hay resultados".
 */
function radiografiaDeLaTabla(raiz = document) {
  const filas = todos(SEL.buscar.filas, raiz);

  return {
    filas: filas.length,
    ordenesVisibles: filas
      .map((fila) => Array.from(fila.querySelectorAll(SEL.buscar.celdaOrden))
        .map((c) => digitos(c.textContent))
        .find(Boolean) || null)
      .filter(Boolean)
      .slice(0, 10),
    carteldeVacio: raiz.querySelector(SEL.buscar.vacio)?.textContent?.trim() || null,
  };
}

/** Pulsa "No, rechazar" en la fila de la orden (provoca la navegacion). */
export async function abrirApelacion(job, { signal } = {}) {
  const numero = digitos(job.orden);
  const fila = filaDeLaOrden(numero, raizModulo());
  if (!fila) throw new Error('La fila de la orden desaparecio antes de abrir la apelacion');

  const boton = Array.from(fila.querySelectorAll(SEL.buscar.acciones))
    .find((b) => normalizar(b.textContent).includes('rechazar'));

  if (!boton) throw new Error('No se encontro el boton "No, rechazar"');

  clickEl(boton);
  await sleep(500, signal);
}

/** Fila cuya celda de "Nº de orden" coincide exactamente con el numero. */
function filaDeLaOrden(numero, raiz = document) {
  return todos(SEL.buscar.filas, raiz).find((fila) => {
    const celdas = fila.querySelectorAll(SEL.buscar.celdaOrden);
    return Array.from(celdas).some((celda) => digitos(celda.textContent) === numero);
  }) || null;
}

/**
 * Raiz donde el portal monta el listado: el shadow root de la micro-app de
 * devoluciones (`#return-app-container`) o el propio documento si algun dia deja
 * de encapsularla.
 */
export function raizModulo() {
  return raizDe(SEL.buscar.input) || raizDe(SEL.buscar.tabla) || document;
}

/**
 * Anclaje del listado: el buscador de órdenes. Es lo que decide si ESTE
 * documento es el del módulo de devoluciones — el portal lo monta a veces
 * dentro de un iframe, así que mirar solo la URL del frame superior no basta.
 */
export function anclaListado() {
  return primero(SEL.buscar.input);
}

/** ¿Estamos en el listado de devoluciones? */
export function esPaginaListado() {
  return location.href.includes('/order/return/returns_pending_review')
    || Boolean(anclaListado());
}
