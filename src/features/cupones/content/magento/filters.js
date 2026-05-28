// Driver del grid legacy de Magento admin para Cart Price Rules.
//
// A diferencia del grid moderno de Manage Address Level 2 (lead-times), este
// grid no tiene panel desplegable con botón "Apply Filters" — los filtros son
// inputs inline sobre la tabla y se aplican presionando Enter sobre el input
// editado. Magento legacy reload de la grid vía AJAX.

import { SELECTORS, SEARCH_BY } from '../../constants.js';
import { parseListingRows, getRowCount } from '../parser.js';
import { setInputValue } from '../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../shared/dom/wait.js';

/** Selecciona el input de filtro correspondiente al modo de búsqueda. */
function selectorForMode(searchBy) {
  return searchBy === SEARCH_BY.RULE ? SELECTORS.filterName : SELECTORS.filterRuleId;
}

/**
 * Simula presionar Enter sobre un input. Despacha keydown/keypress/keyup con
 * keyCode=13 + key='Enter' porque el grid legacy escucha cualquiera de los tres
 * según la versión de Magento. Si todo falla, intenta enviar `submit` sobre el
 * form de filtros como último recurso.
 */
function pressEnter(input) {
  const opts = {
    bubbles:    true,
    cancelable: true,
    key:        'Enter',
    code:       'Enter',
    keyCode:    13,
    which:      13,
  };
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown',  opts));
  input.dispatchEvent(new KeyboardEvent('keypress', opts));
  input.dispatchEvent(new KeyboardEvent('keyup',    opts));
  const form = input.closest('form, [data-role="filter-form"]');
  if (form && typeof form.requestSubmit === 'function') {
    try { form.requestSubmit(); } catch { /* el handler de Magento ya intercepta */ }
  }
}

/**
 * Snapshot suficientemente sensible para detectar que la grid se refrescó:
 *   - número de filas, Y
 *   - el ruleId de la primera fila (si hay).
 * Cualquiera de los dos que cambie indica refresh.
 */
function gridSnapshot() {
  const rows = parseListingRows();
  return {
    count:      rows.length,
    firstRuleId: rows[0]?.ruleId ?? null,
  };
}

function snapshotsEqual(a, b) {
  return a.count === b.count && a.firstRuleId === b.firstRuleId;
}

function loadingMaskVisible() {
  const mask = document.querySelector(SELECTORS.loadingMask);
  if (!mask) return false;
  return mask.offsetParent !== null && getComputedStyle(mask).display !== 'none';
}

/**
 * Espera a que el grid termine de cargar:
 *   - desaparezca el loading mask si estaba visible, Y
 *   - haya filas O snapshot indique 0 (no encontrado).
 */
export async function waitForGridReady({ signal, timeout = 15000 } = {}) {
  return waitFor(() => {
    if (loadingMaskVisible()) return null;
    // Grid presente con al menos 1 row, o vacío explícito (no rows).
    const rows = document.querySelectorAll(SELECTORS.gridRow);
    if (rows.length > 0) return rows;
    // Si la tabla existe pero no hay filas, es un grid vacío post-filtro: válido.
    if (document.querySelector(SELECTORS.gridTable)) return 'empty';
    return null;
  }, { signal, timeout, interval: 150, description: 'grid Cart Price Rules listo' });
}

/**
 * Limpia todos los filtros de búsqueda relevantes (rule_id, name, coupon_code).
 * Solo dispara una recarga del grid si había algún filtro con valor previo.
 */
export async function clearFilters({ signal, timeout = 15000 } = {}) {
  const ids = [SELECTORS.filterRuleId, SELECTORS.filterName, SELECTORS.filterCouponCode];
  let toReload = null;
  for (const sel of ids) {
    const el = document.querySelector(sel);
    if (!el) continue;
    if (el.value && el.value.trim() !== '') {
      setInputValue(el, '');
      toReload = el;
    }
  }
  if (!toReload) return;

  const before = gridSnapshot();
  pressEnter(toReload);

  // Esperar a que el grid refresque (snapshot cambia) o quede vacío.
  try {
    await waitFor(() => {
      const now = gridSnapshot();
      if (!snapshotsEqual(now, before)) return now;
      return null;
    }, { signal, timeout, interval: 200, description: 'grid refrescado tras clear filters' });
  } catch {
    // No siempre cambia (si ya estaba en el estado pedido). Fallback corto.
  }
  await waitForGridReady({ signal });
  await sleep(150, signal);
}

/**
 * Aplica un filtro de búsqueda (por ID o por nombre de Rule) y espera el
 * refresh del grid.
 */
export async function applyFilter({ searchBy, value, signal, timeout = 15000 } = {}) {
  const selector = selectorForMode(searchBy);
  const input = await waitForElement(selector, { signal, timeout: 5000, description: `filtro ${searchBy}` });

  const before = gridSnapshot();
  setInputValue(input, String(value));
  pressEnter(input);

  // El grid legacy a veces no muestra loading mask. Detectamos el refresh por
  // cambio de snapshot o por filas → 0 (no encontrado).
  try {
    await waitFor(() => {
      // Si aparece la máscara, no estamos listos.
      if (loadingMaskVisible()) return null;
      const now = gridSnapshot();
      if (!snapshotsEqual(now, before)) return now;
      // Caso límite: la grid ya estaba mostrando exactamente lo que buscamos
      // (mismo filtro, mismo set de resultados). Si la primera fila ya
      // contiene el query, lo damos por bueno tras un breve respiro.
      return null;
    }, { signal, timeout, interval: 200, description: 'grid refrescado tras filter' });
  } catch (err) {
    // Si nada cambió, podría ser que la grid ya estaba en el estado final.
    // Verificamos con un waitForGridReady; si falla, propagamos.
    await waitForGridReady({ signal });
    if (getRowCount() === 0) return; // grid vacío, manejamos arriba como not-found
    throw err;
  }
  await waitForGridReady({ signal });
  await sleep(200, signal);
}

/** Helper para los tests / debug: dispara Enter sobre un input explícito. */
export function __pressEnterFor(input) { pressEnter(input); }
