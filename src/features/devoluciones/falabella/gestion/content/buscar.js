// Fase BUSCAR: ¿esta la orden en el modulo de devoluciones de SellerCenter?
//
// No todas las devoluciones aparecen aqui. Si esta, se apela desde la propia
// tabla ("No, rechazar"); si no, hay que levantar un ticket de soporte. Esta
// decision es la bifurcacion de todo el flujo, asi que se toma mirando la tabla
// ya filtrada por el numero de orden, nunca por un vistazo parcial.

import { FASE, SEL, STEP_TIMEOUT_MS } from '../constants.js';
import { clickReal, escribirEn, normalizar, primero, raizDe, todos } from './dom.js';
import { traza, trazaAviso, trazaInfo } from '../../../trace.js';
import { sleep, waitFor } from '../../../../../shared/dom/wait.js';

/** Solo los digitos: los numeros de orden se comparan sin formato. */
function digitos(valor) {
  return String(valor ?? '').replace(/\D+/g, '');
}

// Veces que se reescribe el numero y se vuelve a disparar la busqueda. El clic
// sobre la lupa se pierde de vez en cuando (el portal repinta la barra mientras
// se escribe) y el sintoma era un timeout con la pantalla perfectamente bien:
// reintentar cuesta segundos, y no hacerlo cuesta la orden entera.
const INTENTOS_BUSQUEDA = 3;

/** Plazo de cada intento. La consulta del modulo no es rapida. */
const BUSQUEDA_TIMEOUT_MS = 20_000;

/**
 * Cuanto tiene que sostenerse la tabla vacia para darla por buena.
 *
 * Al filtrar, la tabla pasa por un instante SIN filas mientras se repinta. Si
 * ese instante se toma por "la orden no esta", se levanta un ticket por una
 * devolucion que si estaba en el modulo — el error mas caro de todo el flujo.
 */
const VACIO_ESTABLE_MS = 2500;

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

  // El listado tiene que haber TERMINADO de cargar antes de escribir nada. Si no,
  // se busca sobre una pantalla a medio montar: el "No data available" que
  // enseña mientras trae los datos se confundia con "la orden no esta" y la
  // devolucion se iba a ticket sin haberla buscado de verdad.
  let listadoCargado = await esperarListado(raiz, { signal });

  // Medido en vivo: el listado puede quedarse en "No data available" para
  // siempre (pasa al entrar recien logueado) y **una recarga lo cura al
  // instante**. Se recarga una sola vez por orden: si de verdad no hay ninguna
  // devolucion pendiente, la segunda vuelta sigue adelante y la busqueda
  // decidira.
  if (!listadoCargado && recargarUnaVez(job)) {
    onLog?.('El listado de devoluciones no cargo: recargo la pagina y lo reintento.');
    trazaAviso('buscar', 'Listado vacio al cargar: se recarga la pagina', { orden: numero });

    location.reload();

    // Este documento muere con la recarga; la pagina siguiente retoma el job.
    await new Promise(() => {});
  }

  listadoCargado = listadoCargado || todos(SEL.buscar.filas, raiz).length > 0;

  traza('buscar', 'Tabla lista antes de escribir', {
    ...radiografiaDeLaTabla(raiz),
    listadoConDatos: listadoCargado,
  });

  onLog?.(`Buscando la orden ${numero} en el modulo de devoluciones…`);

  let desenlace = null;

  for (let intento = 1; intento <= INTENTOS_BUSQUEDA && !desenlace; intento++) {
    escribirEn(input, numero);

    // Lo que de verdad quedo en el campo: si React no se entero, aqui se ve.
    traza('buscar', 'Numero escrito en el buscador', {
      pedido: numero,
      enElCampo: input.value,
      coincide: input.value === numero,
      intento,
    });

    dispararBusqueda(input, raiz, intento);

    desenlace = await esperarDesenlace(numero, raiz, {
      signal,
      listadoCargado,
      descripcion: `el resultado de buscar la orden ${numero}`,
    });

    if (!desenlace && intento < INTENTOS_BUSQUEDA) {
      trazaAviso('buscar', 'La busqueda no dio resultado: se reintenta', {
        orden: numero,
        intento,
        de: INTENTOS_BUSQUEDA,
        enElCampo: input.value,
        ...radiografiaDeLaTabla(raiz),
      });
    }
  }

  if (!desenlace) {
    // Sin desenlace no se concluye nada: decir "no esta" aqui levantaria un
    // ticket por una devolucion que quiza si estaba.
    trazaAviso('buscar', 'Sin desenlace claro al buscar', {
      orden: numero,
      enElCampo: input.value,
      ...radiografiaDeLaTabla(raiz),
    });

    throw new Error(`No se pudo leer el resultado de buscar la orden ${numero} en el modulo`);
  }

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
 * ¿Se puede gastar la recarga de rescate con esta orden?
 *
 * Una sola vez por orden y solo en el documento superior (recargar un iframe
 * suelto no arregla nada). La marca vive en `sessionStorage` porque tiene que
 * sobrevivir justo a lo que provoca: la recarga.
 */
function recargarUnaVez(job) {
  if (window !== window.top) return false;

  const clave = `devoluciones:recarga:${job.id}`;

  try {
    if (sessionStorage.getItem(clave)) return false;
    sessionStorage.setItem(clave, String(Date.now()));
    return true;
  } catch {
    // Sin sessionStorage no hay forma de acordarse: mejor no recargar que
    // arriesgarse a un bucle.
    return false;
  }
}

/**
 * Espera a que el listado termine de cargar antes de tocarlo.
 *
 * El modulo arranca pidiendo tres meses de devoluciones y, mientras tanto,
 * enseña su cartel de "No data available" con la tabla vacia — exactamente el
 * mismo aspecto que "no hay ninguna devolucion". Buscar en ese momento traia dos
 * problemas: React podia descartar lo tecleado al repintar, y el desenlace se
 * leia como "la orden no esta" en el mismo milisegundo (visto en un registro
 * real: cartel de vacio 1 ms despues de pulsar la lupa).
 *
 * @returns {Promise<boolean>} si el listado llego con filas.
 */
async function esperarListado(raiz, { signal } = {}) {
  const conFilas = await waitFor(
    () => todos(SEL.buscar.filas, raiz).length > 0,
    { timeout: STEP_TIMEOUT_MS, signal, description: 'que el listado de devoluciones cargue' },
  ).catch(() => false);

  if (conFilas) return true;

  // Puede que de verdad no haya ninguna devolucion pendiente. No es un fallo:
  // se sigue adelante, pero el desenlace de la busqueda se exigira mas despacio.
  trazaAviso('buscar', 'El listado no llego a mostrar filas', radiografiaDeLaTabla(raiz));

  return false;
}

/**
 * Espera el resultado de la busqueda: la fila de NUESTRA orden, o la tabla
 * vacia de forma sostenida.
 *
 * Lo delicado es el vacio. Al filtrar, la tabla pasa por un instante sin filas
 * mientras se repinta, y el cartel de "No data available" tambien esta ahi
 * mientras el modulo consulta. Por eso el vacio solo cuenta si **se sostiene**, y
 * si el listado nunca llego a tener filas se le exige ademas un margen mayor: es
 * la unica forma de distinguir "no esta" de "todavia esta cargando", y
 * equivocarse ahi levanta un ticket de una devolucion que si estaba.
 *
 * @returns {Promise<{fila: Element}|{vacia: true}|null>} null si no hubo desenlace.
 */
function esperarDesenlace(numero, raiz, { signal, listadoCargado, descripcion } = {}) {
  const gracia = listadoCargado ? VACIO_ESTABLE_MS : VACIO_ESTABLE_MS * 4;

  let ultimaRadiografia = null;
  let vacioDesde = null;

  return waitFor(() => {
    // Se apunta como va cambiando la tabla: es lo unico que explica por que un
    // desenlace tarda (o por que no llega).
    const radiografia = radiografiaDeLaTabla(raiz);

    if (JSON.stringify(radiografia) !== JSON.stringify(ultimaRadiografia)) {
      ultimaRadiografia = radiografia;
      traza('buscar', 'La tabla cambio', radiografia);
    }

    const fila = filaDeLaOrden(numero, raiz);
    if (fila) return { fila };

    const vacia = Boolean(raiz.querySelector(SEL.buscar.vacio)) || radiografia.filas === 0;

    if (!vacia) {
      // Hay filas, pero ninguna es la nuestra: la tabla aun esta con el
      // resultado anterior. Se sigue esperando.
      vacioDesde = null;
      return null;
    }

    vacioDesde ??= Date.now();

    if (Date.now() - vacioDesde < gracia) return null;

    traza('buscar', 'Vacio sostenido: la orden no esta', {
      sostenidoMs: Date.now() - vacioDesde,
      exigido: gracia,
      ...radiografia,
    });

    return { vacia: true };
  }, {
    timeout: BUSQUEDA_TIMEOUT_MS,
    signal,
    description: descripcion,
  }).catch(() => null);
}

/**
 * Lanza la busqueda. El campo NO esta dentro de un `<form>` y su unico manejador
 * de teclado es `onKeyPress`, asi que ni un "Enter" por keydown ni
 * `requestSubmit()` disparan nada: la tabla se queda mostrando la primera pagina
 * y la orden buscada parece no existir. El disparador de verdad es la lupa.
 *
 * El clic va con {@link clickReal}: la barra de busqueda vive dentro del shadow
 * root del modulo, y un evento sin `composed: true` no sale de esa raiz. A
 * partir del segundo intento se añade el "Enter" por si el portal cambio el
 * disparador.
 */
function dispararBusqueda(input, raiz, intento = 1) {
  const lupa = primero(SEL.buscar.lupa, raiz);

  if (lupa) {
    clickReal(lupa);
    traza('buscar', 'Busqueda lanzada con la lupa', { via: 'lupa', intento });

    if (intento === 1) return;
  }

  // `keypress` es el evento que escucha el campo (no `keydown`), asi que va
  // primero. Es respaldo, no sustituto: sin lupa la tabla no filtra.
  for (const tipo of ['keypress', 'keydown', 'keyup']) {
    input.dispatchEvent(new KeyboardEvent(tipo, {
      bubbles: true, composed: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
    }));
  }

  if (!lupa) trazaAviso('buscar', 'No se encontro la lupa: se probo con Enter', { via: 'teclado', intento });
  else traza('buscar', 'Se refuerza la busqueda con Enter', { via: 'lupa+teclado', intento });
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

  // Como la lupa: el boton vive en el shadow root del modulo, asi que el evento
  // tiene que ir `composed` para que el manejador de React lo vea.
  clickReal(boton);
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
