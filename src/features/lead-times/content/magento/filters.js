// Driver del panel de filtros del data grid de Magento admin.
// Sólo expone primitivas; la decisión de cuándo aplicarlas vive en el flow.

import { SELECTORS } from '../../constants.js';
import { getRecordsFound, parseListingRows } from '../parser.js';
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
 * Click en Apply Filters. Tras el click espera a que el grid se haya
 * **efectivamente refrescado** — no sólo a que aparezca el chip de filtro.
 *
 * El chip `.admin__data-grid-filters-current._show` aparece en cuanto KO
 * actualiza el observable de filtros, pero las filas del grid pueden seguir
 * mostrando datos viejos durante varios cientos de ms mientras Magento
 * vuelve a pedir los datos. Si recolectamos comunas en esa ventana, leemos
 * el grid sin filtrar — bug que arruinaría toda la corrida.
 *
 * Para detectar el refresh real tomamos snapshot del primer row y del
 * contador "X records found" antes del click, y esperamos a que **uno de los
 * dos cambie** o que el grid se vacíe (caso 0 records).
 */
export async function applyFilters({ signal, timeout = 15000 } = {}) {
  const beforeFirstId = parseListingRows()[0]?.editId ?? null;
  const beforeCount   = getRecordsFound();

  const btn = await waitForElement(SELECTORS.filterApply, { signal, description: 'botón Apply Filters' });
  clickEl(btn);

  // El chip aparece casi inmediatamente — espera corta para asegurar que KO
  // registró la aplicación.
  await waitFor(
    () => document.querySelector(`${SELECTORS.activeFiltersWrap}._show`) || null,
    { signal, timeout: 5000, description: 'chip de filtro activo' },
  );

  // Y ahora el cambio efectivo en el grid.
  await waitFor(() => {
    const rows = parseListingRows();
    const firstNow = rows[0]?.editId ?? null;
    const countNow = getRecordsFound();
    if (firstNow !== beforeFirstId && rows.length > 0) return true;
    if (countNow !== beforeCount && countNow != null) return true;
    return null;
  }, { signal, timeout, interval: 200, description: 'grid refrescado tras Apply Filters' });

  // Pequeño respiro para que el repintado termine.
  await sleep(200, signal);
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
