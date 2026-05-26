// Operaciones sobre el data grid: esperas de render, paginación,
// recolección de comunas listadas en la página actual y a lo largo de pages.

import { SELECTORS } from '../../constants.js';
import { parseListingRows, getRecordsFound } from '../parser.js';
import { clickEl } from '../../../../shared/dom/events.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';

/**
 * Espera a que el grid termine de cargar. Considera "listo" cuando
 *   - desapareció el loading mask, Y
 *   - hay al menos 1 row visible, O el contador dice 0 records.
 */
export async function waitForGridReady({ signal, timeout = 15000 } = {}) {
  return waitFor(() => {
    const mask = document.querySelector(SELECTORS.gridLoadingMask);
    if (mask && mask.offsetParent !== null) return null; // visible
    const rows = document.querySelectorAll(SELECTORS.gridRow);
    if (rows.length > 0) return rows;
    const records = getRecordsFound();
    if (records === 0) return 'empty';
    return null;
  }, { signal, timeout, interval: 150, description: 'grid Magento listo' });
}

/** Devuelve las comunas del page actual ya tipadas para el run. */
export function collectComunasOnCurrentPage() {
  return parseListingRows()
    .filter((r) => r.editId != null)
    .map((r) => ({
      id:          r.editId,
      code:        r.code,
      name:        r.defaultName,
      regionName:  r.regionName,
      currentMin:  r.minDays,
      currentMax:  r.maxDays,
      editHref:    r.editHref,
    }));
}

/**
 * Recorre todas las páginas del grid filtrado y devuelve la lista completa de
 * comunas. Resiste 50 páginas como máximo por seguridad. Cada salto espera a
 * que aparezcan nuevas filas (detectado por cambio en el primer href de Edit).
 */
export async function collectAllComunas({ signal, maxPages = 50 } = {}) {
  await waitForGridReady({ signal });
  const out = [];
  const seen = new Set();
  let safety = maxPages;

  while (safety-- > 0) {
    const pageRows = collectComunasOnCurrentPage();
    for (const c of pageRows) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }

    const nextBtn = document.querySelector(SELECTORS.pagerNextBtn);
    if (!nextBtn || nextBtn.disabled) break;

    const before = pageRows[0]?.editHref || '';
    clickEl(nextBtn);
    // Esperar a que cambie el set de filas (heurística: primer href cambia).
    await waitFor(() => {
      const rows = document.querySelectorAll(SELECTORS.gridRow);
      if (rows.length === 0) return null;
      const firstHref = rows[0].querySelector(SELECTORS.editLink)?.getAttribute('href') || '';
      return firstHref && firstHref !== before ? firstHref : null;
    }, { signal, timeout: 10000, interval: 150, description: 'avance de página en grid' });
    await sleep(200, signal);
  }

  return out;
}
