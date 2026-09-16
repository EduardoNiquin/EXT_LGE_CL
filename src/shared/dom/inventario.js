// Inventario de una pagina: que hay disponible en pantalla.
//
// Va aparte de `describe.js` porque tiene otra cadencia y otros topes: describir
// un elemento pasa en cada clic, inventariar una pagina pasa una vez por visita
// y recorre el documento entero.
//
// Para que serve: el registro no puede limitarse a lo que el usuario toco. Quien
// lea el archivo despues necesita saber que MAS habia — los otros campos del
// formulario, los botones que no se apretaron, las columnas de la tabla — para
// entender el flujo y proponer como automatizarlo.
//
// Todos los recorridos estan acotados (ver LIMITES_INVENTARIO). En un admin una
// tabla puede tener 500 filas y el archivo final tiene que seguir siendo legible.
// Cada truncado se informa en `truncado`, para no mentir por omision.

import {
  cssPath,
  describeBreve,
  esVisible,
  limpiar,
  selectorCorto,
  textoAccesible,
  valorDeCampo,
} from './describe.js';

export const LIMITES_INVENTARIO = {
  encabezados: 8,
  formularios: 20,
  camposPorFormulario: 40,
  campos: 80,
  botones: 60,
  enlaces: 80,
  tablas: 10,
  columnas: 20,
  filasMuestra: 3,
  opciones: 12,
  iframes: 15,
  dialogos: 5,
};

const SELECTOR_BOTONES = [
  'button',
  'input[type=submit]',
  'input[type=button]',
  'input[type=reset]',
  '[role=button]',
  'a.btn',
  'a.action-primary',
  'a.action-default',
].join(', ');

const SELECTOR_DIALOGOS = 'dialog[open], [role=dialog], [role=alertdialog], .modal.show, .modal.in, .ui-dialog';

function recortar(lista, tope, truncado, etiqueta) {
  if (lista.length > tope) truncado.push(`${etiqueta}: ${lista.length} encontrados, se listan ${tope}`);
  return lista.slice(0, tope);
}

/**
 * Radiografia de la pantalla actual.
 *
 * @param {Document} doc
 * @param {{ valor?: Function, limites?: object }} [opciones]
 *        `valor` es la funcion de enmascarado (misma firma que en describeElement).
 */
export function inventarioPagina(doc = typeof document !== 'undefined' ? document : null, opciones = {}) {
  if (!doc) return null;
  const limites = { ...LIMITES_INVENTARIO, ...(opciones.limites || {}) };
  const truncado = [];

  const inventario = {
    titulo: limpiar(doc.title, 160),
    url: doc.location?.href || null,
    encabezados: [],
    formularios: [],
    campos: [],
    botones: [],
    enlaces: [],
    tablas: [],
    iframes: [],
    dialogos: [],
    truncado,
  };

  try {
    inventario.encabezados = Array.from(doc.querySelectorAll('h1, h2, h3'))
      .filter(esVisible)
      .slice(0, limites.encabezados)
      .map((h) => ({ nivel: Number(h.tagName.slice(1)), texto: limpiar(h.textContent, 120) }))
      .filter((h) => h.texto);

    inventario.formularios = recortar(
      Array.from(doc.querySelectorAll('form')), limites.formularios, truncado, 'formularios',
    ).map((form, indice) => ({
      id: `F${indice + 1}`,
      selector: selectorCorto(form),
      nombre: form.getAttribute('name') || null,
      accion: form.getAttribute('action') || null,
      metodo: (form.getAttribute('method') || 'GET').toUpperCase(),
      campos: form.querySelectorAll('input, select, textarea').length,
    }));

    inventario.campos = recortar(
      Array.from(doc.querySelectorAll('input, select, textarea')).filter(esVisible),
      limites.campos, truncado, 'campos',
    ).map((campo) => describirCampo(campo, doc, inventario.formularios, opciones, limites));

    inventario.botones = recortar(
      Array.from(doc.querySelectorAll(SELECTOR_BOTONES)).filter(esVisible),
      limites.botones, truncado, 'botones',
    ).map((boton) => ({
      texto: textoAccesible(boton) || null,
      selector: cssPath(boton),
      tipo: boton.getAttribute('type') || null,
      deshabilitado: Boolean(boton.disabled),
    }));

    inventario.enlaces = enlacesDe(doc, limites, truncado);
    inventario.tablas = tablasDe(doc, limites, truncado);

    inventario.iframes = Array.from(doc.querySelectorAll('iframe'))
      .slice(0, limites.iframes)
      .map((marco) => ({
        src: limpiar(marco.getAttribute('src'), 200) || null,
        id: marco.id || marco.name || null,
        titulo: limpiar(marco.getAttribute('title'), 80) || null,
      }));

    inventario.dialogos = Array.from(doc.querySelectorAll(SELECTOR_DIALOGOS))
      .filter(esVisible)
      .slice(0, limites.dialogos)
      .map((dialogo) => ({
        selector: selectorCorto(dialogo),
        titulo: limpiar(dialogo.querySelector('h1, h2, h3, .modal-title, [role=heading]')?.textContent, 120) || null,
        texto: limpiar(dialogo.textContent, 200),
      }));
  } catch { /* lo que se haya podido juntar ya sirve */ }

  return inventario;
}

function describirCampo(campo, doc, formularios, opciones, limites) {
  let valor = null;
  let enmascarado = false;

  try {
    const crudo = valorDeCampo(campo);
    if (typeof opciones.valor === 'function') {
      const tratado = opciones.valor(crudo, campo) || {};
      valor = tratado.valor ?? '';
      enmascarado = Boolean(tratado.enmascarado);
    } else {
      valor = limpiar(crudo, 120);
    }
  } catch { /* no-op */ }

  const form = campo.closest?.('form');
  const indiceForm = form ? Array.from(doc.querySelectorAll('form')).indexOf(form) : -1;

  return {
    etiqueta: textoAccesible(campo) || null,
    selector: cssPath(campo),
    tag: campo.tagName.toLowerCase(),
    tipo: campo.getAttribute('type') || campo.tagName.toLowerCase(),
    nombre: campo.getAttribute('name') || null,
    formulario: indiceForm >= 0 && formularios[indiceForm] ? formularios[indiceForm].id : null,
    requerido: Boolean(campo.required),
    soloLectura: Boolean(campo.readOnly),
    deshabilitado: Boolean(campo.disabled),
    opciones: campo.tagName === 'SELECT'
      ? Array.from(campo.options || []).slice(0, limites.opciones).map((o) => limpiar(o.textContent, 60))
      : null,
    valor,
    enmascarado,
  };
}

function enlacesDe(doc, limites, truncado) {
  const vistos = new Set();
  const enlaces = [];

  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    if (enlaces.length >= limites.enlaces) {
      truncado.push(`enlaces: se listan ${limites.enlaces}`);
      break;
    }
    if (!esVisible(a)) continue;
    const href = a.getAttribute('href');
    if (!href || href === '#' || /^javascript:/i.test(href)) continue;
    const texto = textoAccesible(a);
    if (!texto) continue;
    const clave = `${texto}|${href}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    enlaces.push({ texto, href: limpiar(href, 200), selector: selectorCorto(a) });
  }

  return enlaces;
}

function tablasDe(doc, limites, truncado) {
  return recortar(
    Array.from(doc.querySelectorAll('table')).filter(esVisible),
    limites.tablas, truncado, 'tablas',
  ).map((tabla) => {
    const cabecera = tabla.querySelector('thead tr') || tabla.rows?.[0];
    const columnas = cabecera
      ? Array.from(cabecera.children).slice(0, limites.columnas).map((c) => limpiar(c.textContent, 60))
      : [];
    const cuerpo = Array.from(tabla.querySelectorAll('tbody tr'));
    const filas = cuerpo.length ? cuerpo : Array.from(tabla.rows || []).slice(1);

    return {
      selector: selectorCorto(tabla),
      titulo: limpiar(tabla.querySelector('caption')?.textContent, 80) || null,
      columnas,
      filas: filas.length,
      muestra: filas.slice(0, limites.filasMuestra).map((fila) => (
        Array.from(fila.children).slice(0, limites.columnas).map((celda) => limpiar(celda.textContent, 60))
      )),
    };
  });
}

/**
 * Resumen corto de un documento, para las trazas y el feed en vivo. Es la
 * version barata: no recorre tablas ni enlaces.
 */
export function resumenPagina(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return null;
  try {
    return {
      titulo: limpiar(doc.title, 120),
      url: doc.location?.href || null,
      campos: doc.querySelectorAll('input, select, textarea').length,
      botones: doc.querySelectorAll(SELECTOR_BOTONES).length,
      tablas: doc.querySelectorAll('table').length,
      iframes: doc.querySelectorAll('iframe').length,
      dialogo: describeBreve(doc.querySelector(SELECTOR_DIALOGOS)),
    };
  } catch {
    return null;
  }
}
