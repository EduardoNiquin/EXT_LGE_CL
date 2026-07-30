// Fase BUSCAR: ¿esta la orden en el modulo de devoluciones de SellerCenter?
//
// No todas las devoluciones aparecen aqui. Si esta, se apela desde la propia
// tabla ("No, rechazar"); si no, hay que levantar un ticket de soporte. Esta
// decision es la bifurcacion de todo el flujo, asi que se toma mirando la tabla
// ya filtrada por el numero de orden, nunca por un vistazo parcial.

import { FASE, SEL, STEP_TIMEOUT_MS } from '../constants.js';
import { escribirEn, normalizar, primero } from './dom.js';
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
  // la del listado y el buscador existe.
  const input = anclaListado();
  if (!input) throw new Error('El buscador de ordenes desaparecio de la pantalla');

  trazaInfo('buscar', 'Empieza la busqueda de la orden', {
    orden: numero,
    selectorQueEncajo: selectorDelBuscador(),
    placeholder: input.placeholder || null,
  });

  await waitFor(() => document.querySelector(SEL.buscar.tabla), {
    timeout: STEP_TIMEOUT_MS,
    signal,
    description: 'la tabla de devoluciones',
  });

  traza('buscar', 'Tabla presente antes de escribir', radiografiaDeLaTabla());

  escribirEn(input, numero);

  // Lo que de verdad quedo en el campo: si React no se entero, aqui se ve.
  traza('buscar', 'Numero escrito en el buscador', {
    pedido: numero,
    enElCampo: input.value,
    coincide: input.value === numero,
  });

  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
  input.form?.requestSubmit?.();

  traza('buscar', 'Enter enviado al buscador', { tieneForm: Boolean(input.form) });

  onLog?.(`Buscando la orden ${numero} en el modulo de devoluciones…`);

  // La tabla se repinta de forma asincrona. Esperamos a un desenlace claro: o
  // una fila con NUESTRO numero, o el cartel de "sin datos". Un timeout aqui no
  // se interpreta como "no esta" — seria levantar un ticket por error.
  let ultimaRadiografia = null;

  const desenlace = await waitFor(() => {
    // Se apunta como va cambiando la tabla: es lo unico que explica por que un
    // desenlace tarda (o por que no llega).
    const radiografia = radiografiaDeLaTabla();

    if (JSON.stringify(radiografia) !== JSON.stringify(ultimaRadiografia)) {
      ultimaRadiografia = radiografia;
      traza('buscar', 'La tabla cambio', radiografia);
    }

    const fila = filaDeLaOrden(numero);
    if (fila) return { fila };

    const vacio = document.querySelector(SEL.buscar.vacio);
    const sinFilas = document.querySelectorAll(SEL.buscar.filas).length === 0;
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
      ...radiografiaDeLaTabla(),
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

/** Cual de los selectores alternativos encontro el buscador. */
function selectorDelBuscador() {
  return [].concat(SEL.buscar.input).find((s) => document.querySelector(s)) || null;
}

/**
 * Foto del estado de la tabla: cuantas filas, que ordenes se ven y si esta el
 * cartel de "sin datos". Es lo que permite distinguir "la busqueda no filtro"
 * de "filtro y no hay resultados".
 */
function radiografiaDeLaTabla() {
  const filas = Array.from(document.querySelectorAll(SEL.buscar.filas));

  return {
    filas: filas.length,
    ordenesVisibles: filas
      .map((fila) => Array.from(fila.querySelectorAll(SEL.buscar.celdaOrden))
        .map((c) => digitos(c.textContent))
        .find(Boolean) || null)
      .filter(Boolean)
      .slice(0, 10),
    carteldeVacio: document.querySelector(SEL.buscar.vacio)?.textContent?.trim() || null,
  };
}

/** Pulsa "No, rechazar" en la fila de la orden (provoca la navegacion). */
export async function abrirApelacion(job, { signal } = {}) {
  const numero = digitos(job.orden);
  const fila = filaDeLaOrden(numero);
  if (!fila) throw new Error('La fila de la orden desaparecio antes de abrir la apelacion');

  const boton = Array.from(fila.querySelectorAll(SEL.buscar.acciones))
    .find((b) => normalizar(b.textContent).includes('rechazar'));

  if (!boton) throw new Error('No se encontro el boton "No, rechazar"');

  clickEl(boton);
  await sleep(500, signal);
}

/** Fila cuya celda de "Nº de orden" coincide exactamente con el numero. */
function filaDeLaOrden(numero) {
  return Array.from(document.querySelectorAll(SEL.buscar.filas)).find((fila) => {
    const celdas = fila.querySelectorAll(SEL.buscar.celdaOrden);
    return Array.from(celdas).some((celda) => digitos(celda.textContent) === numero);
  }) || null;
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
