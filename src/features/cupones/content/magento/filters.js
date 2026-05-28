// Driver del grid legacy de Magento admin para Cart Price Rules.
//
// A diferencia del grid moderno de Manage Address Level 2 (lead-times), este
// grid NO tiene panel desplegable con botón "Apply Filters" — los filtros son
// inputs inline sobre la tabla y se aplican presionando Enter sobre el input
// editado. El grid puede operar en modo AJAX (refresca en sitio) o no-AJAX
// (navega a una URL con el filtro en base64). Soportamos ambos.

import { SELECTORS, SEARCH_BY } from '../../constants.js';
import { parseListingRows, getRowCount } from '../parser.js';
import { setInputValue } from '../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../shared/dom/wait.js';

/** Selecciona el input de filtro correspondiente al modo de búsqueda. */
function selectorForMode(searchBy) {
  return searchBy === SEARCH_BY.RULE ? SELECTORS.filterName : SELECTORS.filterRuleId;
}

/**
 * Simula presionar Enter sobre un input.
 *
 * Detalle crítico: el grid legacy de Magento (prototype.js / jQuery) checkea
 * `event.keyCode == 13` o `event.which == 13`. Los `KeyboardEvent` construidos
 * con el constructor moderno IGNORAN `keyCode` y `which` del init dict y los
 * dejan en 0. Por eso forzamos los getters via `Object.defineProperty`.
 * Sin este truco, el handler de Magento ignora el Enter y la grid no recarga.
 */
function buildEnterEvent(type) {
  const ev = new KeyboardEvent(type, {
    bubbles:    true,
    cancelable: true,
    key:        'Enter',
    code:       'Enter',
  });
  try { Object.defineProperty(ev, 'keyCode', { get: () => 13 }); } catch { /* readonly en algún browser */ }
  try { Object.defineProperty(ev, 'which',   { get: () => 13 }); } catch { /* idem */ }
  try { Object.defineProperty(ev, 'charCode', { get: () => 13 }); } catch { /* idem */ }
  return ev;
}

function pressEnter(input) {
  input.focus();
  input.dispatchEvent(buildEnterEvent('keydown'));
  input.dispatchEvent(buildEnterEvent('keypress'));
  input.dispatchEvent(buildEnterEvent('keyup'));
}

/**
 * Fallback: inyecta un <script> en el page-world que invoca directamente
 * `<gridId>JsObject.doFilter()` o `<gridId>.doFilter()` si están expuestos en
 * `window`. Esto cubre el caso de que el Enter sintético no llegue al handler
 * (CSP-friendly: el script vive sólo durante la inyección y se remueve).
 *
 * Magento expone el grid de Cart Price Rules como `promo_quote_gridJsObject`.
 * Probamos varios nombres por compatibilidad.
 */
function triggerGridDoFilter() {
  try {
    const code = `
      (function(){
        try {
          var names = ['promo_quote_gridJsObject', 'promo_quote_grid'];
          for (var i = 0; i < names.length; i++) {
            var g = window[names[i]];
            if (g && typeof g.doFilter === 'function') { g.doFilter(); return; }
          }
        } catch (e) { /* silent */ }
      })();
    `;
    const script = document.createElement('script');
    script.textContent = code;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
    return true;
  } catch {
    return false;
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
    count:       rows.length,
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
    const rows = document.querySelectorAll(SELECTORS.gridRow);
    if (rows.length > 0) return rows;
    if (document.querySelector(SELECTORS.gridTable)) return 'empty';
    return null;
  }, { signal, timeout, interval: 150, description: 'grid Cart Price Rules listo' });
}

/**
 * Dispara una recarga del grid: presiona Enter sobre el input pasado y, si tras
 * un breve respiro el snapshot no cambió, intenta el fallback de inyección.
 * Devuelve `true` si detectó refresh, `false` si timeout (no implica error —
 * el llamador decide).
 */
async function triggerReloadAndWait(input, { signal, timeout = 12000 } = {}) {
  const before = gridSnapshot();
  pressEnter(input);

  // Primer intento: Enter sintético. Esperamos hasta 1.5s antes de probar el
  // fallback — suficiente para que el handler de Magento dispare la AJAX.
  let changed = await waitForSnapshotChange(before, { signal, timeout: 1500 });
  if (!changed) {
    triggerGridDoFilter();
    changed = await waitForSnapshotChange(before, { signal, timeout: timeout - 1500 });
  }
  return Boolean(changed);
}

async function waitForSnapshotChange(before, { signal, timeout } = {}) {
  try {
    return await waitFor(() => {
      if (loadingMaskVisible()) return null;
      const now = gridSnapshot();
      return snapshotsEqual(now, before) ? null : now;
    }, { signal, timeout, interval: 150, description: 'cambio de snapshot del grid' });
  } catch {
    return null;
  }
}

/**
 * Limpia todos los filtros relevantes (rule_id, name, coupon_code). Solo
 * dispara una recarga si había algún valor previo.
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

  await triggerReloadAndWait(toReload, { signal, timeout });
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

  setInputValue(input, String(value));
  const changed = await triggerReloadAndWait(input, { signal, timeout });
  await waitForGridReady({ signal });
  await sleep(150, signal);

  // Si el snapshot no cambió, igual aceptamos: puede que el filtro previo ya
  // mostrara estos mismos resultados. El llamador hará findMatchingRow sobre
  // el estado actual del grid y resolverá NOT_FOUND si hace falta.
  return { changed, rowCount: getRowCount() };
}

/** True si el input de filtro asociado al modo ya tiene este valor. */
export function isFilterAppliedFor(searchBy, query) {
  const selector = selectorForMode(searchBy);
  const input = document.querySelector(selector);
  if (!input) return false;
  return String(input.value || '').trim() === String(query).trim();
}

/** Helper para tests / debug: dispara Enter sobre un input explícito. */
export function __pressEnterFor(input) { pressEnter(input); }
