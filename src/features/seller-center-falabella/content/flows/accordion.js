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

/**
 * Escribe el valor (sólo dígitos) en un input SIN enfocarlo ni hacer blur, para
 * no disparar el formateo de miles de lightning-input. Verifica comparando por
 * dígitos y reintenta una vez.
 */
function setDigitsField(input, value) {
  const digits = onlyDigits(value);
  if (nativeValueSetter) nativeValueSetter.call(input, digits);
  else input.value = digits;
  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return digits;
}

/** Escribe los 3 campos de una sección y verifica (por dígitos) cada uno. */
export async function fillSection(section, { ordernumber, guia, cantP }, { signal } = {}) {
  const fields = [
    { sel: SELECTORS.inputOrderNumber, value: ordernumber, label: 'Número de orden' },
    { sel: SELECTORS.inputGuia,        value: guia,        label: 'Nro Guia' },
    { sel: SELECTORS.inputCantidad,    value: cantP,       label: 'Cantidad de Paquetes' },
  ];

  for (const f of fields) {
    if (signal?.aborted) return;
    const input = section.querySelector(f.sel);
    if (!input) throw new Error(`No se encontró el campo "${f.label}".`);

    const digits = setDigitsField(input, f.value);
    if (onlyDigits(input.value) !== digits) {
      await sleep(60, signal);
      setDigitsField(input, f.value);
      if (onlyDigits(input.value) !== digits) {
        log.warn(`El campo "${f.label}" no quedó con el valor esperado`, { esperado: digits, actual: input.value });
      }
    }
  }
}
