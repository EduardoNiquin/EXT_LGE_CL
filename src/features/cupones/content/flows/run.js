// State machine del feature Cupones — "Quitar Regla de Cupón".
//
// Modelo conceptual (mismo patrón que lead-times):
//
//   LISTING:
//     ├─ Si un item quedó EDITING (volvimos del edit con save OK) → marcarlo OK.
//     ├─ Tomar el próximo item PENDING.
//     ├─ Limpiar filtros del grid (lo pide explícitamente el usuario).
//     ├─ Aplicar filtro por ID o por Rule (según run.searchBy).
//     ├─ Buscar la fila que matchea exactamente.
//     │    └─ Si no aparece → marcar NOT_FOUND y seguir con el próximo.
//     │    └─ Si hay match → marcar EDITING, navegar al editHref.
//     └─ Si no quedan items pendientes → finalize().
//
//   EDIT:
//     ├─ Verificar que el id de la URL matchea el item EDITING.
//     ├─ Abrir el colapsable Actions.
//     ├─ Eliminar todas las condiciones (rule-param-remove).
//     ├─ Click Save (Magento navega solo al listing).
//     └─ Próximo tick (listing) → marca el item OK.

import { logger } from '../../../../shared/utils/logger.js';
import { ITEM_STATUS, PAGE_TYPE, SEARCH_BY } from '../../constants.js';
import { appendLog, getRun, setRun } from '../../state.js';
import { detectPage } from '../detector.js';
import { applyFilter, clearFilters, waitForGridReady } from '../magento/filters.js';
import { parseListingRows } from '../parser.js';
import {
  clickSave,
  leaveEditPage,
  openActionsCollapsible,
  removeAllConditions,
} from '../magento/edit-page.js';

const log = logger('cupones/run');

let running = false;

/**
 * Punto de entrada. Llamar en el init del content script y en cada
 * storage.onChanged del key del run.
 */
export async function tickIfActive() {
  if (running) return;
  if (window !== window.top) return;

  running = true;
  try {
    const run = await getRun();
    if (!run || !run.active) return;

    const page = detectPage();
    if (page.type === PAGE_TYPE.LISTING) {
      await onListing(run);
    } else if (page.type === PAGE_TYPE.EDIT) {
      await onEdit(run, page);
    } else {
      log.debug('página fuera del flujo, ignorando', { url: page.url });
    }
  } catch (err) {
    log.error('tick falló', err);
    try {
      await appendLog({ level: 'error', message: `tick falló: ${err?.message || String(err)}` });
    } catch { /* no-op */ }
  } finally {
    running = false;
  }
}

// -----------------------------------------------------------------------------
// LISTING
// -----------------------------------------------------------------------------

async function onListing(run) {
  // 1) Si un item quedó EDITING, Magento navegó de vuelta tras el save → OK.
  let touched = false;
  for (const item of run.items) {
    if (item.status === ITEM_STATUS.EDITING) {
      item.status  = ITEM_STATUS.OK;
      item.savedAt = Date.now();
      touched = true;
      await appendLog({
        level: 'info',
        message: `Guardado: ${labelOf(item)} — condiciones eliminadas: ${item.removedConditions ?? 0}`,
      });
    }
  }
  if (touched) await setRun(run);

  // 2) ¿Quedan items pendientes?
  const nextIdx = run.items.findIndex((it) => it.status === ITEM_STATUS.PENDING);
  if (nextIdx === -1) {
    await finalize(run, { reason: 'done' });
    return;
  }

  // 3) Procesar el siguiente.
  const item = run.items[nextIdx];
  item.status = ITEM_STATUS.SEARCHING;
  run.currentItemIndex = nextIdx;
  await setRun(run);
  await appendLog({
    level: 'info',
    message: `Buscando ${run.searchBy === SEARCH_BY.RULE ? 'Rule' : 'ID'}: ${item.query}`,
  });

  try {
    await waitForGridReady();
    await clearFilters();
    await applyFilter({ searchBy: run.searchBy, value: item.query });
  } catch (err) {
    item.status = ITEM_STATUS.ERROR;
    item.error  = `Falló al filtrar: ${err?.message || String(err)}`;
    await setRun(run);
    await appendLog({ level: 'error', message: `${item.query}: ${item.error}` });
    return;
  }

  const match = findMatchingRow(run.searchBy, item.query);
  if (!match) {
    item.status = ITEM_STATUS.NOT_FOUND;
    item.error  = run.searchBy === SEARCH_BY.RULE
      ? 'No se encontró cupón con ese nombre exacto'
      : 'No se encontró cupón con ese ID';
    await setRun(run);
    await appendLog({ level: 'warn', message: `${item.query}: no encontrado` });
    return;
  }

  item.matchedRuleId = match.ruleId;
  item.matchedName   = match.name;
  item.editHref      = match.editHref;
  item.status        = ITEM_STATUS.EDITING;
  await setRun(run);
  await appendLog({
    level: 'info',
    message: `Editando ${labelOf(item)} (id=${match.ruleId})`,
  });

  // Navegar al edit URL — el próximo tick corre al cargar.
  window.location.href = match.editHref;
}

// -----------------------------------------------------------------------------
// EDIT
// -----------------------------------------------------------------------------

async function onEdit(run, page) {
  const idx = run.items.findIndex((it) =>
    it.status === ITEM_STATUS.EDITING && it.matchedRuleId === page.editId,
  );
  if (idx === -1) {
    log.warn('edit page sin item EDITING que matchee', { editId: page.editId });
    return;
  }
  const item = run.items[idx];

  try {
    await openActionsCollapsible();
    const removed = await removeAllConditions();
    item.removedConditions = removed;
    await setRun(run);
    await appendLog({
      level: 'info',
      message: `${labelOf(item)}: ${removed} condición(es) eliminada(s) — guardando`,
    });
    await clickSave();
    // Save dispara navegación. No marcamos OK acá — el próximo tick en el
    // listing detecta el EDITING y lo pasa a OK.
  } catch (err) {
    item.status = ITEM_STATUS.ERROR;
    item.error  = err?.message || String(err);
    await setRun(run);
    await appendLog({ level: 'error', message: `${labelOf(item)}: ${item.error}` });
    await leaveEditPage();
  }
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/**
 * Busca en el grid actual la fila que matchea exactamente el query del item.
 * Si filtramos por ID, comparamos ruleId numérico. Si filtramos por Rule, el
 * filtro de Magento es "contains" — por lo que necesitamos confirmar match
 * exacto (case-insensitive, trim) sobre la columna name. Si no hay exacto pero
 * hay una sola fila, la aceptamos.
 */
function findMatchingRow(searchBy, query) {
  const rows = parseListingRows();
  if (rows.length === 0) return null;

  if (searchBy === SEARCH_BY.ID) {
    const q = Number(String(query).trim());
    if (!Number.isFinite(q)) return null;
    const exact = rows.find((r) => r.ruleId === q);
    if (exact) return exact;
    return rows.length === 1 ? rows[0] : null;
  }

  // searchBy === SEARCH_BY.RULE
  const q = String(query).trim().toLowerCase();
  const exact = rows.find((r) => (r.name || '').trim().toLowerCase() === q);
  if (exact) return exact;
  return rows.length === 1 ? rows[0] : null;
}

function labelOf(item) {
  if (item.matchedName && item.matchedRuleId) {
    return `${item.matchedName} (#${item.matchedRuleId})`;
  }
  return String(item.query);
}

async function finalize(run, { reason } = {}) {
  run.active = false;
  run.finishedAt = Date.now();
  run.finishReason = reason || 'done';
  await setRun(run);
  await appendLog({ level: 'info', message: `Run finalizado (${run.finishReason})` });
}
