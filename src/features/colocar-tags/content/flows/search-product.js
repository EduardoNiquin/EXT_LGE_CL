import { SELECTORS, STEPS } from '../../constants.js';
import { setInputValue, clickEl } from '../../../../shared/dom/events.js';
import { waitFor, waitForElement, sleep } from '../../../../shared/dom/wait.js';
import { waitForModalOpen } from '../gp1/modal.js';

/**
 * Error específico para SKUs que el search resuelve sin match exacto.
 * El runner lo trata como SKIPPED, no como ERROR técnico.
 */
export class SkuNotFoundError extends Error {
  constructor(sku, { totalRows = 0 } = {}) {
    super(
      totalRows === 0
        ? `Sin resultados para SKU "${sku}"`
        : `Sin coincidencia exacta de "${sku}" en ${totalRows} fila(s)`,
    );
    this.name = 'SkuNotFoundError';
    this.sku = sku;
    this.totalRows = totalRows;
  }
}

/**
 * Busca un SKU en la pantalla MIM, identifica la fila cuya columna
 * "Sales Model" matchea exactamente, y abre su modal vía botón Edit.
 *
 * @returns {Promise<{ row: HTMLElement, editIndex: number|null }>}
 * @throws {SkuNotFoundError} si el search resuelve y no hay match exacto.
 */
export async function searchProductBySku({ sku, onStep = () => {}, signal } = {}) {
  if (!sku || typeof sku !== 'string') throw new Error('SKU vacío');

  // Snapshot del estado del grid antes de buscar.
  const before = snapshotGrid();

  onStep(STEPS.SEARCH_TYPE, { sku });
  const input = await waitForElement(SELECTORS.productIdInput, { signal });
  setInputValue(input, sku);

  onStep(STEPS.SEARCH_CLICK);
  const btn = await waitForElement(SELECTORS.searchButton, { signal });
  clickEl(btn);

  onStep(STEPS.SEARCH_WAIT_ROW, { sku });
  const result = await waitForSearchResult({ sku, before, signal });
  if (!result.row) {
    throw new SkuNotFoundError(sku, { totalRows: result.totalRows });
  }

  await sleep(150, signal);

  onStep(STEPS.SEARCH_CLICK_EDIT);
  const editBtn = result.row.querySelector(SELECTORS.gridCellEdit);
  if (!editBtn) throw new Error('Fila encontrada pero sin botón Edit');
  const editIndex = parseEditIndex(editBtn);
  clickEl(editBtn);

  onStep(STEPS.MODAL_WAIT_OPEN);
  await waitForModalOpen({ signal });

  return { row: result.row, editIndex };
}

/**
 * Espera a que el search resuelva. "Resolver" significa una de tres cosas:
 *   1. Apareció la fila con Sales Model === sku → devolvemos {row}.
 *   2. El grid se actualizó (rowsHash o count cambió) y NO hay match → {row:null, totalRows}.
 *   3. Pasó el timeout → tira WaitTimeoutError.
 */
async function waitForSearchResult({ sku, before, signal }) {
  return waitFor(
    () => {
      const row = findRowBySalesModel(sku);
      if (row) return { row };

      const after = snapshotGrid();
      const gridChanged =
        after.count !== before.count || after.rowsHash !== before.rowsHash;

      if (gridChanged) {
        return { row: null, totalRows: after.rowCount };
      }
      return null;
    },
    {
      description: `resultado del search para "${sku}"`,
      timeout: 15000,
      interval: 200,
      signal,
    },
  );
}

function snapshotGrid() {
  const countEl = document.querySelector(SELECTORS.countStg);
  const count = countEl ? countEl.textContent.trim() : null;
  const rows = Array.from(document.querySelectorAll(SELECTORS.gridRow));
  const rowsHash = rows
    .map((r) => r.querySelector(SELECTORS.gridCellSalesModel)?.textContent?.trim() || '')
    .join('|');
  return { count, rowsHash, rowCount: rows.length };
}

export function findRowBySalesModel(sku) {
  const wanted = sku.trim();
  const rows = document.querySelectorAll(SELECTORS.gridRow);
  for (const row of rows) {
    const cell = row.querySelector(SELECTORS.gridCellSalesModel);
    if (!cell) continue;
    if (cell.textContent.trim() === wanted) return row;
  }
  return null;
}

export function parseEditIndex(button) {
  const onclick = button.getAttribute('onclick') || '';
  const m = onclick.match(/fncModelPopup\((\d+)\)/);
  return m ? Number(m[1]) : null;
}
