import { EDIT_URL_RE, SELECTORS } from '../constants.js';

/**
 * Lee las filas visibles del grid de Manage Address Level 2. Las columnas se
 * leen por orden de aparición de `.data-grid-cell-content` dentro del row:
 *   0=ID  1=Website  2=Address Level 1  3=Address Level 2 Code
 *   4=Address Level 2 Default Name  5=Lead Time Min  6=Lead Time Max
 *   7=Delivery Start  8=Delivery End  9=Delivery Slots
 * El href de Edit lleva el id real de la comuna, que es lo que persistimos
 * para identificar inequívocamente cada registro.
 */
export function parseListingRows() {
  const rows = Array.from(document.querySelectorAll(SELECTORS.gridRow));
  return rows.map((tr) => {
    const cells = tr.querySelectorAll('td .data-grid-cell-content');
    const editAnchor = tr.querySelector(SELECTORS.editLink);
    const editHref = editAnchor?.getAttribute('href') || '';
    const idMatch = editHref.match(EDIT_URL_RE);
    const editId = idMatch ? Number(idMatch[1]) : null;
    const text = (i) => cells[i]?.textContent?.trim() ?? '';
    return {
      gridId:      text(0),
      website:     text(1),
      regionName:  text(2),
      code:        text(3),
      defaultName: text(4),
      minDays:     text(5),
      maxDays:     text(6),
      editHref,
      editId,
    };
  });
}

/** Texto de los chips de filtros activos. */
export function getActiveFilters() {
  return Array.from(document.querySelectorAll(SELECTORS.activeFiltersList))
    .map((li) => li.textContent.trim());
}

/** "341 records found" → 341. Devuelve null si no se puede parsear. */
export function getRecordsFound() {
  const txt = document.querySelector(SELECTORS.recordsFound)?.textContent?.trim() || '';
  const m = txt.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Lee "of N" del pager para saber cuántas páginas hay. */
export function getTotalPages() {
  const label = Array.from(document.querySelectorAll('.admin__data-grid-pager label'))
    .find((el) => /^of\s+\d+/i.test(el.textContent?.trim() || ''));
  if (!label) return 1;
  const m = label.textContent.match(/of\s+(\d+)/i);
  return m ? Number(m[1]) : 1;
}
