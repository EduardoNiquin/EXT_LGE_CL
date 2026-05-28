import { EDIT_URL_RE, SELECTORS } from '../constants.js';

/**
 * Lee las filas visibles del grid de Cart Price Rules y devuelve para cada una
 * los campos que nos interesan para identificar el cupón objetivo:
 *   - ruleId   (número, columna "ID")
 *   - name     (string, columna "Rule")
 *   - editHref (URL al edit del cupón)
 *   - editId   (número, derivado del editHref como verificación cruzada)
 */
export function parseListingRows() {
  const rows = Array.from(document.querySelectorAll(SELECTORS.gridRow));
  return rows.map((tr) => {
    const idText = tr.querySelector(SELECTORS.rowRuleIdCell)?.textContent?.trim() || '';
    const ruleId = idText ? Number(idText) : null;
    const name = tr.querySelector(SELECTORS.rowNameCell)?.textContent?.trim() || '';
    const editAnchor = tr.querySelector(SELECTORS.rowEditLink);
    const editHref = editAnchor?.getAttribute('href') || '';
    const m = editHref.match(EDIT_URL_RE);
    const editId = m ? Number(m[1]) : null;
    return { ruleId, name, editHref, editId };
  });
}

/** Filtros actuales: para diagnóstico. */
export function getActiveFilters() {
  return {
    rule_id:     document.querySelector(SELECTORS.filterRuleId)?.value ?? '',
    name:        document.querySelector(SELECTORS.filterName)?.value ?? '',
    coupon_code: document.querySelector(SELECTORS.filterCouponCode)?.value ?? '',
  };
}

/** Cuántas filas hay en el grid actual. */
export function getRowCount() {
  return document.querySelectorAll(SELECTORS.gridRow).length;
}
