// Búsqueda de UN SKU en la pantalla de PIM: selecciona STG, escribe el SKU,
// dispara SEARCH y espera a que la grilla resuelva (fila que matchea el SKU →
// existe; capa "No data." → no existe).

import { DEFAULTS, SELECTORS } from '../../constants.js';
import { resolveResult } from '../parser.js';
import { setInputValue } from '../../../../shared/dom/events.js';
import { waitFor, sleep } from '../../../../shared/dom/wait.js';

/** Asegura que la pestaña STG (Staging) esté activa antes de buscar. */
async function ensureStgTab({ signal } = {}) {
  const stgTab = document.querySelector(SELECTORS.stgTab);
  if (!stgTab) return;
  if (!stgTab.classList.contains('active')) {
    // Botón Bootstrap con data-toggle="tab": el click nativo dispara su handler.
    stgTab.click();
    await sleep(150, signal);
  }
}

/**
 * Verifica un SKU. Devuelve `{ found, specAssign }`: `found` es true si existe en
 * PIM (STG); `specAssign` es el contenido de la columna "Spec Assign" de la fila
 * (ej "Assigned"), o null si no existe / la celda está vacía.
 * Lanza WaitTimeoutError si la grilla no resuelve dentro del timeout.
 */
export async function searchSku(sku, { signal, onStep } = {}) {
  onStep?.('select-stg');
  await ensureStgTab({ signal });

  onStep?.('fill-sku');
  const input = document.querySelector(SELECTORS.productId);
  if (!input) throw new Error('No se encontró el campo SKU (Product ID).');
  setInputValue(input, sku);

  onStep?.('search');
  const btn = document.querySelector(SELECTORS.searchBtn);
  if (!btn) throw new Error('No se encontró el botón SEARCH.');
  // Botón legacy con onclick=searchButtonClicked(): el click nativo lo dispara.
  btn.click();

  onStep?.('read-result');
  const resolved = await waitFor(() => {
    const r = resolveResult(sku);
    return r.result === 'pending' ? null : r;
  }, {
    timeout: DEFAULTS.searchTimeoutMs,
    interval: 200,
    signal,
    description: `el resultado de la búsqueda de "${sku}"`,
  });

  return { found: resolved.result === 'found', specAssign: resolved.specAssign };
}
