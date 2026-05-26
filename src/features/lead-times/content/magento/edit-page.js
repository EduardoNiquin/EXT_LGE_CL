// Driver de la pantalla "Edit Address Level 2": expandir el colapsable,
// setear los inputs de lead time y guardar.

import { SELECTORS } from '../../constants.js';
import { clickEl, setInputValue } from '../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../shared/dom/wait.js';

/** Abre el colapsable "Set up regional delivery lead time (Optional)" si está cerrado. */
export async function openDeliveryCollapsible({ signal, timeout = 10000 } = {}) {
  const block = await waitForElement(SELECTORS.deliveryCollapsible, {
    signal, timeout, description: 'colapsable Delivery',
  });
  const title = block.querySelector('.fieldset-wrapper-title');
  if (!title) throw new Error('No se encontró el header del colapsable Delivery');
  const isOpen = () => title.getAttribute('data-state-collapsible') === 'open';
  if (!isOpen()) {
    clickEl(title);
    await waitFor(isOpen, { signal, timeout: 5000, description: 'colapsable Delivery abierto' });
  }
  await waitForElement(SELECTORS.deliveryMinInput, { signal, timeout: 5000, description: 'input Min visible' });
  await waitForElement(SELECTORS.deliveryMaxInput, { signal, timeout: 5000, description: 'input Max visible' });
}

/** Setea los dos inputs (min y max). */
export async function setLeadTimes({ minDays, maxDays, signal } = {}) {
  const minEl = document.querySelector(SELECTORS.deliveryMinInput);
  const maxEl = document.querySelector(SELECTORS.deliveryMaxInput);
  if (!minEl) throw new Error('Input delivery_leadtime_min no encontrado');
  if (!maxEl) throw new Error('Input delivery_leadtime_max no encontrado');
  setInputValue(minEl, String(minDays));
  setInputValue(maxEl, String(maxDays));
  await sleep(100, signal);
}

/**
 * Click en el botón Save. Magento navega automáticamente de vuelta al listing
 * tras un guardado exitoso; no esperamos esa navegación acá — el próximo tick
 * del state machine se dispara cuando la nueva página carga.
 */
export async function clickSave({ signal } = {}) {
  const btn = document.querySelector(SELECTORS.saveButton);
  if (!btn) throw new Error('Botón Save no encontrado');
  clickEl(btn);
  await sleep(150, signal);
}

/**
 * Vuelve al listing sin guardar. Limpia el handler de beforeunload para evitar
 * el confirm "Changes have been made" cuando el form está dirty (típico tras
 * un error en setLeadTimes).
 */
export async function leaveEditPage({ signal } = {}) {
  try { window.onbeforeunload = null; } catch { /* no-op */ }
  const back = document.querySelector(SELECTORS.backButton);
  if (back) {
    clickEl(back);
    await sleep(150, signal);
    return;
  }
  history.back();
}
