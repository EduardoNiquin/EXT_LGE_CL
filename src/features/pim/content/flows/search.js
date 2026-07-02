// Búsqueda de UN SKU en la pantalla de PIM: selecciona STG, escribe el SKU,
// dispara SEARCH y espera a que la grilla resuelva (fila que matchea el SKU →
// existe; capa "No data." → no existe).

import { DEFAULTS, SELECTORS } from '../../constants.js';
import {
  resolveResult, isGridLoading,
  getRowKeyForSku, readSpecByRowKey, scrollGridX,
} from '../parser.js';
import { setInputValue } from '../../../../shared/dom/events.js';
import { waitFor, sleep } from '../../../../shared/dom/wait.js';
import { isAbortError } from '../../../../shared/errors/index.js';

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
  // Anti-stale: el grid conserva el "No data." del SKU anterior hasta que arranca
  // el nuevo fetch. Esperar a que el grid entre en carga (o a que ya aparezca una
  // fila que matchee) evita cerrar el SKU como NO leyendo el resultado viejo. Si
  // nunca se ve "loading" (respuesta instantánea), el tope deja seguir.
  await waitForSearchToStart(sku, { signal });

  const resolved = await waitFor(() => {
    const r = resolveResult(sku);
    return r.result === 'pending' ? null : r;
  }, {
    timeout: DEFAULTS.searchTimeoutMs,
    interval: 200,
    signal,
    description: `el resultado de la búsqueda de "${sku}"`,
  });

  const found = resolved.result === 'found';
  const specAssign = found ? await readSpecAssignScrolled(sku, { signal }) : null;
  return { found, specAssign };
}

/**
 * Lee la columna "Spec Assign" del SKU encontrado. TUI Grid **virtualiza columnas
 * horizontalmente**: la columna vive lejos a la derecha y NO está en el DOM hasta
 * scrollear. Se captura el data-row-key con las columnas del SKU aún visibles,
 * se scrollea al extremo derecho para materializar la celda, se lee por row-key y
 * se vuelve a la izquierda (para que el próximo SKU matchee sus columnas base).
 */
async function readSpecAssignScrolled(sku, { signal } = {}) {
  const rowKey = getRowKeyForSku(sku);
  if (rowKey == null) return null;

  // ¿ya renderizada? (grid angosto / pocas columnas → no hace falta scrollear)
  const direct = readSpecByRowKey(rowKey);
  if (direct) return direct;

  scrollGridX(-1); // extremo derecho: materializa "Spec Assign"
  let value;
  try {
    value = await waitFor(() => readSpecByRowKey(rowKey), {
      timeout: DEFAULTS.specSettleMs,
      interval: 120,
      signal,
      description: `el valor de Spec Assign de "${sku}"`,
    });
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    value = readSpecByRowKey(rowKey); // último intento; null = sin Spec Assign
  } finally {
    scrollGridX(0); // volver a la izquierda para el próximo SKU
  }
  return value || null;
}

/**
 * Espera (acotado) a que el nuevo fetch del grid arranque: aparece la capa de
 * carga o ya se ve la fila del SKU. Si vence el tope sin señal (búsqueda muy
 * rápida o grid sin spinner), no lanza: deja que el waitFor principal resuelva.
 */
async function waitForSearchToStart(sku, { signal } = {}) {
  try {
    await waitFor(
      () => isGridLoading() || resolveResult(sku).result === 'found',
      {
        timeout: DEFAULTS.searchSettleMs,
        interval: 100,
        signal,
        description: `que arranque la búsqueda de "${sku}"`,
      },
    );
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    // Nunca se vio "loading": seguimos y confiamos en el waitFor principal.
  }
}
