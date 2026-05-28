// Driver del grid legacy de Magento admin para Cart Price Rules.
//
// El grid tiene botones reales para Apply (Search) y Reset Filter:
//   - button[data-action="grid-filter-apply"]   — su onclick llama promo_quote_gridJsObject.doFilter()
//   - button[data-action="grid-filter-reset"]   — su onclick llama promo_quote_gridJsObject.resetFilter()
//
// Esa es la forma robusta de aplicar/limpiar filtros: un click nativo sobre el
// botón ejecuta el onclick definido en la página, que llama al grid JS object
// expuesto en `window`. Antes intentamos:
//   1. Dispatch sintético de Enter sobre el input — el handler de Magento
//      verifica `event.keyCode == 13`, pero el `KeyboardEvent` construido con
//      el constructor moderno deja `keyCode` en 0 aunque lo pasemos en el init
//      dict. Aún sobreescribiéndolo vía `Object.defineProperty` no siempre
//      llega al handler correcto, porque está bound al form y no al input.
//   2. Inyectar un <script> al page-world que llame `doFilter()` directamente
//      — bloqueado por la CSP de Magento ("Executing inline script violates...").
//
// El click sobre el botón Search es la forma que ya usa el usuario manualmente
// y que el mismo onclick handler de Magento ejecuta sin interceptación CSP.

import { SELECTORS, SEARCH_BY } from '../../constants.js';
import { parseListingRows, getRowCount } from '../parser.js';
import { setInputValue } from '../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../shared/dom/wait.js';

function selectorForMode(searchBy) {
  return searchBy === SEARCH_BY.RULE ? SELECTORS.filterName : SELECTORS.filterRuleId;
}

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
 *   - haya filas O snapshot indique 0 (grid vacío post-filtro).
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
 * Click nativo sobre el botón Search ("Apply Filter"). Usamos `el.click()`
 * (no `dispatchEvent`) porque el onclick handler está atribuido vía
 * `element.onclick = function () { ... }` en una inline `<script>` de la
 * página: `el.click()` lo activa de manera idéntica a un click real del
 * usuario y respeta la CSP — `dispatchEvent(MouseEvent('click'))` también
 * lo dispara, pero `.click()` es el camino canónico y el más resistente a
 * frameworks legacy.
 */
async function clickSearchButton({ signal, timeout = 5000 } = {}) {
  const btn = await waitForElement(SELECTORS.filterSearchButton, {
    signal, timeout, description: 'botón Search del grid',
  });
  btn.click();
}

async function clickResetButton({ signal, timeout = 5000 } = {}) {
  const btn = await waitForElement(SELECTORS.filterResetButton, {
    signal, timeout, description: 'botón Reset Filter del grid',
  });
  btn.click();
}

/**
 * Limpia todos los filtros usando el botón Reset Filter del grid. Solo dispara
 * la acción si algún filtro relevante tenía valor previo.
 */
export async function clearFilters({ signal, timeout = 15000 } = {}) {
  const ids = [SELECTORS.filterRuleId, SELECTORS.filterName, SELECTORS.filterCouponCode];
  const hasAny = ids.some((sel) => {
    const el = document.querySelector(sel);
    return el && el.value && el.value.trim() !== '';
  });
  if (!hasAny) return;

  const before = gridSnapshot();
  await clickResetButton({ signal });

  await waitForSnapshotChange(before, { signal, timeout });
  await waitForGridReady({ signal });
  await sleep(150, signal);
}

/**
 * Aplica un filtro (por ID o por nombre de Rule):
 *   1. Setea el value en el input correspondiente.
 *   2. Click nativo sobre el botón Search (`grid-filter-apply`).
 *   3. Espera el refresh del grid (snapshot cambia) o vencimiento.
 *
 * Devuelve `{ changed, rowCount }`. Si `changed` es false el llamador debe
 * decidir si seguir (el grid puede haber estado ya mostrando los resultados
 * correctos) o tratarlo como fallo.
 */
export async function applyFilter({ searchBy, value, signal, timeout = 15000 } = {}) {
  const selector = selectorForMode(searchBy);
  const input = await waitForElement(selector, { signal, timeout: 5000, description: `filtro ${searchBy}` });

  setInputValue(input, String(value));
  const before = gridSnapshot();
  await clickSearchButton({ signal });

  const changedSnapshot = await waitForSnapshotChange(before, { signal, timeout });
  await waitForGridReady({ signal });
  await sleep(150, signal);

  return { changed: Boolean(changedSnapshot), rowCount: getRowCount() };
}

/** True si el input de filtro asociado al modo ya tiene este valor exacto. */
export function isFilterAppliedFor(searchBy, query) {
  const selector = selectorForMode(searchBy);
  const input = document.querySelector(selector);
  if (!input) return false;
  return String(input.value || '').trim() === String(query).trim();
}
