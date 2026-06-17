// Operaciones DOM sobre el acordeón "Detalle Orden" del sitio Soporte Seller
// (Salesforce / LWC). Cada "Detalle Orden" es un <lightning-accordion-section>.
//
// Flujo manual que se replica:
//   - El form arranca con UNA sección (índice 0), abierta y vacía.
//   - El botón "+" agrega otra sección (aparece colapsada, al final).
//   - Para escribir en una sección colapsada hay que expandirla (click al summary).
//   - El botón "-" elimina una sección: NUNCA lo tocamos (solo "+").

import { SELECTORS, TEXTS } from '../../constants.js';
import { getDetalleSections } from '../detector.js';
import { setInputValue, clickEl } from '../../../../shared/dom/events.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('seller-center-falabella');

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
 * crea clickeando el "+" de la última y esperando a que aparezca cada una.
 * Devuelve el elemento <lightning-accordion-section>.
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
    clickEl(addBtn);
    await waitFor(() => getDetalleSections().length > before, {
      timeout: 8000,
      description: 'que aparezca el nuevo "Detalle Orden"',
      signal,
    });
    await sleep(120, signal); // dejar que LWC termine de renderizar la sección
    sections = getDetalleSections();
  }

  return sections[index];
}

/** Expande una sección si está colapsada (click al botón del summary). */
export async function expandSection(section, { signal } = {}) {
  const summary = section.querySelector(SELECTORS.summaryButton);
  if (!summary) throw new Error('No se encontró el control para expandir el "Detalle Orden".');
  if (summary.getAttribute('aria-expanded') === 'true') return;

  clickEl(summary);
  await waitFor(() => summary.getAttribute('aria-expanded') === 'true', {
    timeout: 5000,
    description: 'que el "Detalle Orden" se expanda',
    signal,
  });
  await sleep(80, signal);
}

/**
 * Escribe los 3 campos de una sección y verifica que el valor haya quedado
 * seteado (reintenta una vez si el framework lo pisó). `cantP` se escribe tal
 * cual del CSV.
 */
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
    setInputValue(input, f.value);

    // LWC re-renderiza de forma async; verificamos y reintentamos una vez.
    if (input.value !== String(f.value)) {
      await sleep(60, signal);
      setInputValue(input, f.value);
      if (input.value !== String(f.value)) {
        log.warn(`El campo "${f.label}" no quedó con el valor esperado`, { esperado: f.value, actual: input.value });
      }
    }
  }
}
