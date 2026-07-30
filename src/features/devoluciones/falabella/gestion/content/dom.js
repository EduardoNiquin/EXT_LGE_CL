// Helpers de DOM propios de la gestion automatica: subir archivos a un <input
// type=file> por codigo y manejar los comboboxes de Salesforce (LWC), que no
// son <select> sino botones con una lista de <lightning-base-combobox-item>.

import { SEL, STEP_TIMEOUT_MS } from '../constants.js';
import { clickEl } from '../../../../../shared/dom/events.js';
import { waitFor } from '../../../../../shared/dom/wait.js';

/** Reconstruye un File a partir del base64 que manda el service worker. */
export function base64ToFile({ nombre, tipo, contenido }) {
  const binary = atob(contenido);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], nombre, { type: tipo || 'application/octet-stream' });
}

/**
 * Deja los archivos dentro de un <input type=file>. `input.files` es de solo
 * lectura, pero acepta el FileList de un DataTransfer: es la unica forma de
 * simular una seleccion sin abrir el dialogo (que es justo lo que la politica
 * del equipo bloquea).
 */
export function setFiles(input, files) {
  if (!input) throw new Error('setFiles: no se encontro el campo de archivos');
  const dt = new DataTransfer();
  for (const file of files) dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input;
}

/**
 * Escribe en un campo de texto de forma que el framework de la pagina se entere.
 *
 * El modulo de devoluciones de SellerCenter es **React** (Ant Design), y ahi
 * `el.value = x` no basta: React intercepta el setter `value` del prototipo para
 * llevar su propio registro del valor, asi que una asignacion directa cambia lo
 * que se ve en pantalla pero deja a React creyendo que el campo sigue vacio —
 * su `onChange` no se dispara y la busqueda se hace sobre el valor anterior.
 * Llamando al setter NATIVO del prototipo, React lo ve como si lo hubiera
 * tecleado una persona. En una web sin React es exactamente lo mismo que la
 * asignacion de siempre, asi que sirve igual para los campos de Salesforce.
 */
export function escribirEn(el, valor, { blur = false } = {}) {
  if (!el) throw new Error('escribirEn: elemento nulo');

  const prototipo = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(prototipo, 'value')?.set;

  el.focus();

  if (setter) setter.call(el, valor);
  else el.value = valor;

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  if (blur) el.dispatchEvent(new Event('blur', { bubbles: true }));

  return el;
}

/**
 * Elige una opcion en un <select>. Mismo motivo que {@link escribirEn}: React
 * rastrea tambien el valor de los <select>, asi que hay que pasar por el setter
 * nativo para que su `onChange` se entere.
 */
export function elegirOpcion(select, valor) {
  if (!select) throw new Error('elegirOpcion: elemento nulo');

  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;

  if (setter) setter.call(select, valor);
  else select.value = valor;

  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));

  return select;
}

/** Texto normalizado (sin acentos, minusculas) para comparar rotulos. */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Todas las raices en las que puede vivir la pantalla: el documento y los
 * **shadow roots abiertos** que cuelgan de el, en anchura.
 *
 * No es un adorno defensivo: el modulo de devoluciones de SellerCenter monta
 * TODA su interfaz (buscador, tabla y formulario de apelacion) dentro del shadow
 * root de `#return-app-container`. En el documento de arriba no hay ni un
 * `<input>` ni una `<table>`, asi que un `document.querySelector` plano no
 * encuentra nada y la espera se agota sin explicacion.
 */
function raices(raiz = document) {
  const encontradas = [raiz];

  // Si la raiz es ELLA MISMA un host, hay que entrar en su shadow root: si no,
  // `raices(combo)` se queda fuera de su propio contenido. Pasa de verdad en la
  // mesa de ayuda (Salesforce LWC con shadow nativo): el
  // `button.slds-combobox__input` de un `lightning-combobox` vive dentro de su
  // shadow root, y buscarlo con `combo.querySelector(...)` devuelve null.
  if (raiz.shadowRoot) encontradas.push(raiz.shadowRoot);

  // Recorrido en anchura sobre el propio array: lo que se anade se visita luego.
  for (let i = 0; i < encontradas.length; i++) {
    // Una raiz que no sabe enumerar descendientes (un nodo suelto) simplemente
    // no aporta shadow roots: se la deja consultar y se sigue.
    const hijos = encontradas[i]?.querySelectorAll?.('*');
    if (!hijos) continue;

    for (const el of hijos) {
      if (el.shadowRoot) encontradas.push(el.shadowRoot);
    }
  }

  return encontradas;
}

/**
 * Primer elemento que encaja con alguno de los selectores dados, en orden. Los
 * portales reordenan su maquetación cada tanto: tener alternativas evita que un
 * `div` nuevo en medio tumbe todo el flujo.
 *
 * Busca primero en el documento y despues en los shadow roots, para que una
 * pantalla encapsulada en un web component no quede invisible desde fuera.
 */
export function primero(selectores, raiz = document) {
  const lista = [].concat(selectores);

  for (const r of raices(raiz)) {
    for (const selector of lista) {
      const el = r.querySelector?.(selector);
      if (el) return el;
    }
  }

  return null;
}

/**
 * Todos los elementos que encajan, cruzando shadow roots. Hace falta para lo que
 * no es "el primero que aparezca": las filas de la tabla o los acordeones del
 * formulario, que son justo donde el modulo guarda lo que hay que leer.
 */
export function todos(selectores, raiz = document) {
  const lista = [].concat(selectores);
  const vistos = new Set();

  for (const r of raices(raiz)) {
    for (const selector of lista) {
      for (const el of r.querySelectorAll?.(selector) || []) vistos.add(el);
    }
  }

  return Array.from(vistos);
}

/**
 * La raiz (documento o shadow root) que contiene la pantalla. Se resuelve UNA
 * vez al empezar una fase y se reutiliza para todas las consultas: asi no se
 * recorre el arbol entero en cada vuelta de una espera, y sobre todo se evita
 * mezclar elementos de dos raices distintas.
 */
export function raizDe(selectores, raiz = document) {
  const lista = [].concat(selectores);

  for (const r of raices(raiz)) {
    if (lista.some((selector) => r.querySelector(selector))) return r;
  }

  return null;
}

/** Cuántos shadow roots abiertos hay (para el diagnóstico). */
export function contarShadowRoots(raiz = document) {
  return raices(raiz).length - 1;
}

/** Primer elemento cuyo texto contiene `texto` (sin distinguir acentos). */
export function buscarPorTexto(root, selector, texto) {
  const objetivo = normalizar(texto);
  return todos(selector, root || document)
    .find((el) => normalizar(el.textContent).includes(objetivo)) || null;
}

/**
 * Texto de un elemento juntando el de TODAS sus raices. Con shadow DOM nativo el
 * `textContent` de un componente viene vacio, porque lo que se ve esta dentro de
 * su shadow root y no cuenta como contenido suyo.
 */
function textoProfundo(el) {
  return raices(el)
    .map((r) => r.textContent || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Texto visible de una opcion de combobox de Salesforce. En la mesa de ayuda
 * (LWC con shadow nativo) el `textContent` de un `lightning-base-combobox-item`
 * llega **vacio** —su rotulo vive en otro shadow root anidado—, pero el valor
 * esta siempre en `data-value`. Se usa ese y solo si falta se baja a leer el
 * texto de las raices.
 */
export function textoDeOpcion(el) {
  return el?.getAttribute?.('data-value') || textoProfundo(el);
}

/** Opcion de un combobox por su rotulo: exacta primero, contenida despues. */
function opcionDeCombobox(combo, valor) {
  const objetivo = normalizar(valor);
  const items = todos(SEL.ticket.comboOpcion, combo);

  // La exacta manda: "Devoluciones" no puede ganarla "Informacion sobre una
  // orden en devolucion" solo por contener la palabra.
  return items.find((el) => normalizar(textoDeOpcion(el)) === objetivo)
    || items.find((el) => normalizar(textoDeOpcion(el)).includes(objetivo))
    || null;
}

/**
 * Elige una opcion en un combobox de Salesforce: abre la lista con su boton y
 * pulsa la opcion. Espera a que la lista monte — en la cascada del ticket, las
 * opciones de un nivel solo existen despues de elegir el anterior.
 */
export async function elegirCombobox(combo, valor, { signal } = {}) {
  if (!combo) throw new Error(`No se encontro el desplegable para "${valor}"`);

  // El boton NO cuelga del combo en el light DOM: vive dentro de su propio
  // shadow root (lightning-combobox -> lightning-base-combobox -> boton), asi
  // que `combo.querySelector` devuelve null. Hay que cruzar sus raices.
  const boton = primero(SEL.ticket.comboBoton, combo);
  if (!boton) throw new Error(`El desplegable de "${valor}" no tiene boton`);

  clickEl(boton);

  const opcion = await waitFor(
    () => opcionDeCombobox(combo, valor),
    { timeout: STEP_TIMEOUT_MS, signal, description: `la opcion "${valor}"` },
  );

  clickEl(opcion);

  // El combobox se cierra y refleja el valor; si no, al menos no bloqueamos.
  await waitFor(
    () => normalizar(boton.textContent).includes(normalizar(valor)) || null,
    { timeout: 3000, signal, description: `que el desplegable muestre "${valor}"` },
  ).catch(() => { /* algunos combos no repintan el rotulo: seguimos */ });

  return opcion;
}

/**
 * Abre un acordeon del formulario de apelacion por el titulo de su caja. Los
 * paneles arrancan colapsados (`class="off"`) y se abren pulsando la cabecera.
 */
export async function abrirAcordeon(titulo, { signal, raiz = document } = {}) {
  const caja = todos(SEL.apelar.caja, raiz)
    .find((box) => normalizar(box.querySelector(SEL.apelar.cajaTitulo)?.textContent).includes(normalizar(titulo)));

  if (!caja) throw new Error(`No se encontro la seccion "${titulo}"`);

  const cuerpo = caja.querySelector(SEL.apelar.cajaCuerpo);
  if (cuerpo && !cuerpo.classList.contains('on')) {
    clickEl(caja.querySelector('.title-box'));
    await waitFor(
      () => caja.querySelector('.on'),
      { timeout: STEP_TIMEOUT_MS, signal, description: `que se abra "${titulo}"` },
    );
  }

  return caja;
}
