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
 * Primer elemento que encaja con alguno de los selectores dados, en orden. Los
 * portales reordenan su maquetación cada tanto: tener alternativas evita que un
 * `div` nuevo en medio tumbe todo el flujo.
 *
 * Si no aparece nada, hace una segunda pasada por los **shadow DOM abiertos**:
 * `querySelector` no los atraviesa, así que una pantalla encapsulada en un web
 * component sería invisible desde fuera.
 */
export function primero(selectores, raiz = document) {
  const lista = [].concat(selectores);

  for (const selector of lista) {
    const el = raiz.querySelector(selector);
    if (el) return el;
  }

  return dentroDeShadow(lista, raiz);
}

/** Recorre los shadow roots abiertos buscando alguno de los selectores. */
function dentroDeShadow(selectores, raiz) {
  const porVisitar = [raiz];

  while (porVisitar.length) {
    const nodo = porVisitar.shift();

    for (const el of nodo.querySelectorAll('*')) {
      if (!el.shadowRoot) continue;

      for (const selector of selectores) {
        const encontrado = el.shadowRoot.querySelector(selector);
        if (encontrado) return encontrado;
      }

      porVisitar.push(el.shadowRoot);
    }
  }

  return null;
}

/** Cuántos shadow roots abiertos hay (para el diagnóstico). */
export function contarShadowRoots(raiz = document) {
  let total = 0;
  const porVisitar = [raiz];

  while (porVisitar.length) {
    const nodo = porVisitar.shift();

    for (const el of nodo.querySelectorAll('*')) {
      if (!el.shadowRoot) continue;
      total++;
      porVisitar.push(el.shadowRoot);
    }
  }

  return total;
}

/** Primer elemento cuyo texto contiene `texto` (sin distinguir acentos). */
export function buscarPorTexto(root, selector, texto) {
  const objetivo = normalizar(texto);
  return Array.from((root || document).querySelectorAll(selector))
    .find((el) => normalizar(el.textContent).includes(objetivo)) || null;
}

/**
 * Elige una opcion en un combobox de Salesforce: abre la lista con su boton y
 * pulsa la opcion. Espera a que la lista monte — en la cascada del ticket, las
 * opciones de un nivel solo existen despues de elegir el anterior.
 */
export async function elegirCombobox(combo, valor, { signal } = {}) {
  if (!combo) throw new Error(`No se encontro el desplegable para "${valor}"`);

  const boton = combo.querySelector(SEL.ticket.comboBoton);
  if (!boton) throw new Error(`El desplegable de "${valor}" no tiene boton`);

  clickEl(boton);

  const opcion = await waitFor(
    () => buscarPorTexto(combo, SEL.ticket.comboOpcion, valor),
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
export async function abrirAcordeon(titulo, { signal } = {}) {
  const caja = Array.from(document.querySelectorAll(SEL.apelar.caja))
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
