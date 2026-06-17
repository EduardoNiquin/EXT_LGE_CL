// Operaciones DOM sobre el acordeón "Detalle Orden" del sitio Soporte Seller
// (Salesforce / LWC). Cada "Detalle Orden" es un <lightning-accordion-section>.
//
// Flujo manual que se replica:
//   - El form arranca con UNA sección (índice 0), abierta y vacía.
//   - El botón "+" agrega otra sección (aparece colapsada, al final). El nuevo
//     elemento tiene a su vez su propio "+", y así sucesivamente.
//   - Para escribir en una sección colapsada hay que expandirla (click al summary).
//   - El botón "-" elimina una sección: NUNCA lo tocamos (solo "+").
//
// Quirks (importantes):
//   - Botones LWC: se activan con `.click()` nativo. `dispatchEvent(MouseEvent)`
//     falla en silencio (igual que los botones legacy de Magento), por eso el "+"
//     no agregaba la sección.
//   - Inputs numéricos (`lightning-input` tipo número, locale es-CL): al recibir
//     `blur` formatean con puntos de miles ("140111..." → "140.111..."). Para
//     que el valor quede SÓLO con dígitos, escribimos sin `focus`/`blur` (sólo
//     `input`/`change`): así el formateador de miles nunca se dispara.

import { SELECTORS, TEXTS } from '../../constants.js';
import { getDetalleSections } from '../detector.js';
import { sleep, waitFor, WaitTimeoutError } from '../../../../shared/dom/wait.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('seller-center-falabella');

const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

/** Click nativo (la única forma confiable de activar el handler de un botón LWC). */
function pressButton(btn) {
  if (!btn) throw new Error('pressButton: botón nulo');
  btn.click();
}

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** Busca el botón "+" (agregar) dentro de una sección por su texto. */
function findAddButton(section) {
  const btns = section.querySelectorAll(SELECTORS.neutralButton);
  for (const b of btns) {
    if (b.textContent.trim() === TEXTS.ADD_BUTTON) return b;
  }
  return null;
}

/**
 * Garantiza que exista la sección de índice `index`. Si faltan secciones, las
 * crea clickeando el "+" de la última y esperando a que aparezca cada una
 * (detecta el cambio en el DOM por polling). Devuelve el <lightning-accordion-section>.
 */
export async function ensureSection(index, { signal } = {}) {
  let sections = getDetalleSections();
  if (!sections.length) {
    throw new Error('No se encontró ninguna sección "Detalle Orden" en la página.');
  }

  while (sections.length <= index) {
    if (signal?.aborted) return null;
    const last = sections[sections.length - 1];
    const addBtn = findAddButton(last);
    if (!addBtn) throw new Error('No se encontró el botón "+" para agregar otro "Detalle Orden".');

    const before = sections.length;
    await clickAndWaitForNewSection(addBtn, before, { signal });
    await sleep(150, signal); // dejar que LWC termine de renderizar la sección
    sections = getDetalleSections();
  }

  return sections[index];
}

/** Click al "+" con un reintento si la sección nueva no aparece a la primera. */
async function clickAndWaitForNewSection(addBtn, before, { signal } = {}) {
  const waitNew = () => waitFor(() => getDetalleSections().length > before, {
    timeout: 6000,
    description: 'que aparezca el nuevo "Detalle Orden"',
    signal,
  });

  pressButton(addBtn);
  try {
    await waitNew();
  } catch (err) {
    if (!(err instanceof WaitTimeoutError) || signal?.aborted) throw err;
    log.warn('El "+" no agregó la sección al primer intento; reintentando…');
    pressButton(addBtn);
    await waitFor(() => getDetalleSections().length > before, {
      timeout: 8000,
      description: 'que aparezca el nuevo "Detalle Orden" (reintento)',
      signal,
    });
  }
}

/** Expande una sección si está colapsada (click nativo al botón del summary). */
export async function expandSection(section, { signal } = {}) {
  const summary = section.querySelector(SELECTORS.summaryButton);
  if (!summary) throw new Error('No se encontró el control para expandir el "Detalle Orden".');
  if (summary.getAttribute('aria-expanded') === 'true') return;

  pressButton(summary);
  await waitFor(() => summary.getAttribute('aria-expanded') === 'true', {
    timeout: 5000,
    description: 'que el "Detalle Orden" se expanda',
    signal,
  });
  await sleep(80, signal);
}

/** Setea el value vía el setter nativo (LWC trackea el cambio igual). */
function setNativeValue(input, value) {
  if (nativeValueSetter) nativeValueSetter.call(input, value);
  else input.value = value;
}

/**
 * Pasada 1: replica la interacción real (focus → set → input → change → blur).
 * Es lo que marca el campo como "interactuado/validado" en LWC y hace aparecer
 * el botón de submit. OJO: el `blur` puede reformatear con puntos de miles; eso
 * se corrige en la pasada 2.
 */
function commitField(input, digits) {
  input.focus();
  setNativeValue(input, digits);
  // `change` no se dispara solo al llamar a blur() de forma programática (el
  // navegador sólo lo hace cuando el value lo cambió el usuario), así que lo
  // emitimos a mano para que LWC corra su handleChange / re-dispatch al padre.
  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur(); // dispara focusout/handleBlur → marca tocado + valida
}

/**
 * Pasada 2: re-escribe sólo dígitos SIN blur, para sacar los puntos de miles que
 * el formateador de lightning-input pudo agregar en la pasada 1. El campo ya
 * quedó validado, así que el botón de submit permanece visible.
 */
function normalizeField(input, digits) {
  setNativeValue(input, digits);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Escribe los 3 campos de una sección en dos pasadas (commit + normalización) y
 * verifica (por dígitos) cada uno.
 */
export async function fillSection(section, { ordernumber, guia, cantP }, { signal } = {}) {
  const fields = [
    { sel: SELECTORS.inputOrderNumber, value: onlyDigits(ordernumber), label: 'Número de orden' },
    { sel: SELECTORS.inputGuia,        value: onlyDigits(guia),        label: 'Nro Guia' },
    { sel: SELECTORS.inputCantidad,    value: onlyDigits(cantP),       label: 'Cantidad de Paquetes' },
  ];

  // Resolver inputs una sola vez.
  for (const f of fields) {
    f.input = section.querySelector(f.sel);
    if (!f.input) throw new Error(`No se encontró el campo "${f.label}".`);
  }

  // Pasada 1: commit con interacción real (valida → aparece el submit).
  for (const f of fields) {
    if (signal?.aborted) return;
    commitField(f.input, f.value);
    await sleep(40, signal);
  }

  // Pasada 2: dejar sólo dígitos (sin disparar el formateo de miles).
  for (const f of fields) {
    if (signal?.aborted) return;
    if (onlyDigits(f.input.value) !== f.value) {
      normalizeField(f.input, f.value);
      await sleep(20, signal);
    }
    if (onlyDigits(f.input.value) !== f.value) {
      log.warn(`El campo "${f.label}" no quedó con el valor esperado`, { esperado: f.value, actual: f.input.value });
    }
  }
}
