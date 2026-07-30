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

/** Texto normalizado (sin acentos, minusculas) para comparar rotulos. */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
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
