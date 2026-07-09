// Interacciones DOM del flujo "Buscar número de órden en caso".
//
// Todas las acciones sobre botones LWC usan `.click()` nativo (igual que el
// resto de la feature: dispatchEvent(MouseEvent) falla en silencio). Cada espera
// está acotada por timeout y respeta la señal de cancelación (Detener).

import { ORDERS_SECTION_TITLE, SEARCH_SELECTORS } from '../../constants.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { onlyDigits, getPagination, currentCardIds } from './detector.js';

/** Abre el modal de un caso clickeando "Detalles del caso"; devuelve el modal. */
export async function openCaseModal(button, { signal } = {}) {
  if (!button) throw new Error('No se encontró el botón "Detalles del caso".');
  button.click();
  return waitFor(() => document.querySelector(SEARCH_SELECTORS.modal), {
    timeout: 8000,
    description: 'el modal del caso',
    signal,
  });
}

/** Número de caso leído del título del modal ("Caso 68057163"). */
export function readModalCaseNumber(modal) {
  const title = modal?.querySelector(SEARCH_SELECTORS.modalTitle);
  return title ? onlyDigits(title.textContent) : '';
}

/** Ubica la caja del modal cuyo `.section-title` coincide (case-insensitive). */
function findBoxByTitle(root, title) {
  const wanted = title.trim().toLowerCase();
  const titleEl = Array.from(root.querySelectorAll(SEARCH_SELECTORS.sectionTitle))
    .find((el) => el.textContent.trim().toLowerCase() === wanted);
  if (!titleEl) return null;
  return titleEl.closest(SEARCH_SELECTORS.boxContent) || titleEl.parentElement;
}

/**
 * Lee TODOS los números de orden de la tabla "Órdenes" del modal (lectura
 * síncrona, sin esperas). Prioriza el atributo `data-cell-value` (el número
 * crudo) y cae al texto de `lightning-base-formatted-text`. Devuelve dígitos,
 * sin duplicados.
 */
export function parseModalOrders(modal = document.querySelector(SEARCH_SELECTORS.modal)) {
  if (!modal) return [];
  const box = findBoxByTitle(modal, ORDERS_SECTION_TITLE);
  if (!box) return [];

  let orders = Array.from(box.querySelectorAll(SEARCH_SELECTORS.orderCell))
    .map((c) => onlyDigits(c.getAttribute('data-cell-value')))
    .filter(Boolean);

  if (!orders.length) {
    orders = Array.from(box.querySelectorAll(SEARCH_SELECTORS.formattedText))
      .map((el) => onlyDigits(el.textContent))
      .filter(Boolean);
  }
  return Array.from(new Set(orders));
}

/**
 * Espera ACTIVAMENTE a que la tabla "Órdenes" del modal cargue y devuelva al
 * menos un número de orden (la tabla es un `lightning-datatable` que se puebla
 * de forma asíncrona tras abrir el modal). Sondea `parseModalOrders` hasta que
 * haya datos o venza el timeout.
 *
 * Si tras el timeout sigue vacío, se asume que el caso no tiene orden asociada
 * y se devuelve `[]` (salvo que la espera se haya cancelado, en cuyo caso
 * propaga el abort).
 */
export async function waitForModalOrders(modal, { signal, timeout = 10000 } = {}) {
  const root = modal || document.querySelector(SEARCH_SELECTORS.modal);
  try {
    return await waitFor(() => {
      const orders = parseModalOrders(root);
      return orders.length ? orders : null;
    }, {
      timeout,
      interval: 120,
      description: 'el número de orden del caso',
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;   // cancelación → propagar
    return parseModalOrders(root);    // timeout → caso sin orden (o no cargó)
  }
}

/** Cierra el modal (botón "X") y espera a que desaparezca. */
export async function closeCaseModal({ signal } = {}) {
  const modal = document.querySelector(SEARCH_SELECTORS.modal);
  if (!modal) return;
  const closeBtn = modal.querySelector(SEARCH_SELECTORS.modalClose);
  if (!closeBtn) throw new Error('No se encontró el botón para cerrar el modal del caso.');
  closeBtn.click();
  await waitFor(() => !document.querySelector(SEARCH_SELECTORS.modal), {
    timeout: 6000,
    description: 'que el modal del caso se cierre',
    signal,
  });
  await sleep(120, signal);
}

/**
 * Vuelve a la página 1 si no estamos ya ahí (click al `span[data-page="1"]`).
 * No-op si no hay paginación o ya estamos en la 1.
 */
export async function ensureFirstPage({ signal } = {}) {
  const pag = getPagination();
  if (!pag || pag.activePage == null || pag.activePage === 1) return;
  const first = document.querySelector(`${SEARCH_SELECTORS.pageNumber}[data-page="1"]`);
  if (!first) return;
  first.click();
  await waitFor(() => getPagination()?.activePage === 1, {
    timeout: 8000,
    description: 'volver a la página 1',
    signal,
  });
  await sleep(250, signal);
}

/**
 * Avanza a la página siguiente clickeando ">". Devuelve false si no hay más
 * páginas (botón ausente o deshabilitado). Espera a que la lista se actualice
 * (cambia la página activa o cambian los ids de las cards).
 */
export async function goToNextPage({ signal } = {}) {
  const pag = getPagination();
  if (!pag || !pag.nextBtn || pag.nextDisabled) return false;

  const beforePage = pag.activePage;
  const beforeIds = currentCardIds().join(',');

  pag.nextBtn.click();
  await waitFor(() => {
    const p = getPagination();
    if (!p) return false;
    if (beforePage != null && p.activePage != null && p.activePage > beforePage) return true;
    const ids = currentCardIds();
    return ids.length > 0 && ids.join(',') !== beforeIds;
  }, {
    timeout: 8000,
    description: 'que la lista avance a la página siguiente',
    signal,
  });
  await sleep(250, signal);
  return true;
}
