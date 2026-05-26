// Driver del panel de filtros del data grid de Magento admin.
// Sólo expone primitivas; la decisión de cuándo aplicarlas vive en el flow.

import { SELECTORS } from '../../constants.js';
import { clickEl, setInputValue } from '../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../shared/dom/wait.js';

function filtersPanelIsOpen() {
  return Boolean(document.querySelector(`${SELECTORS.filtersWrap}._show`));
}

/** Abre el panel de filtros si está cerrado. */
export async function openFilters({ signal, timeout = 5000 } = {}) {
  if (filtersPanelIsOpen()) return;
  const btn = await waitForElement(SELECTORS.filtersButton, { signal, timeout, description: 'botón Filters' });
  clickEl(btn);
  await waitFor(filtersPanelIsOpen, { signal, timeout, description: 'panel de filtros abierto' });
  await sleep(120, signal);
}

/** Setea el campo "Address Level 1" con el nombre de la región. */
export async function setRegionFilter(value, { signal } = {}) {
  const input = await waitForElement(SELECTORS.filterRegionInput, { signal, description: 'input Address Level 1' });
  setInputValue(input, value);
}

/**
 * Click en Apply Filters. Espera a que aparezca el chip de filtro activo (la
 * lista `.admin__data-grid-filters-current._show`) para asegurar que Magento
 * registró la aplicación.
 */
export async function applyFilters({ signal, timeout = 10000 } = {}) {
  const btn = await waitForElement(SELECTORS.filterApply, { signal, description: 'botón Apply Filters' });
  clickEl(btn);
  await waitFor(
    () => document.querySelector(`${SELECTORS.activeFiltersWrap}._show`) || null,
    { signal, timeout, description: 'chip de filtro activo' },
  );
  // Pequeño respiro para que el grid empiece a recargar.
  await sleep(250, signal);
}

/** Limpia todos los filtros activos. */
export async function clearAllFilters({ signal } = {}) {
  const btn = document.querySelector(SELECTORS.filterReset);
  if (!btn) return;
  clickEl(btn);
  await sleep(250, signal);
}

/** Valor actual del input de región (vacío si el panel está cerrado y el input no existe). */
export function getRegionFilterValue() {
  return document.querySelector(SELECTORS.filterRegionInput)?.value || '';
}
