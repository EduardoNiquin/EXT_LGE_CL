// State machine del feature Cupones — "Quitar Regla de Cupón".
//
// Modelo conceptual (mismo patrón que lead-times):
//
//   LISTING:
//     ├─ Si un item quedó EDITING (volvimos del edit con save OK) → marcarlo OK.
//     ├─ Tomar el próximo item PENDING o SEARCHING-sin-match (esto último cubre
//     │   el caso en que el grid de Magento haya hecho navegación full-page tras
//     │   el filter, y nuestro tick previo quedó truncado por el unload).
//     ├─ Si el filtro ya está aplicado para este item (caso post-nav) → no
//     │   refiltramos; vamos directo a buscar la fila.
//     ├─ Caso contrario: clearFilters + applyFilter.
//     ├─ Buscar la fila exacta (por ID o por Rule).
//     │    └─ Si no aparece → marcar NOT_FOUND (log warn con muestra de IDs).
//     │    └─ Si hay match → marcar EDITING, navegar al editHref.
//     └─ Si no quedan items pendientes → finalize().
//
//   EDIT:
//     ├─ Verificar que el id de la URL matchea el item EDITING.
//     ├─ Abrir el colapsable Actions.
//     ├─ Según run.kind:
//     │    ├─ 'remove' → eliminar todas las condiciones (rule-param-remove).
//     │    └─ 'add'    → agregar una condición (atributo + operador + valor).
//     ├─ Click Save (Magento navega solo al listing).
//     └─ Próximo tick (listing) → marca el item OK.

import { logger } from '../../../../shared/utils/logger.js';
import { ITEM_STATUS, PAGE_TYPE, RUN_KIND, SEARCH_BY } from '../../constants.js';
import { appendLog, getRun, setRun } from '../../state.js';
import { detectPage } from '../detector.js';
import {
  applyFilter,
  clearFilters,
  isFilterAppliedFor,
  waitForGridReady,
} from '../magento/filters.js';
import { parseListingRows } from '../parser.js';
import {
  addCondition,
  clickSave,
  leaveEditPage,
  openActionsCollapsible,
  removeAllConditions,
} from '../magento/edit-page.js';

const log = logger('cupones/run');

let running = false;

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
      const detail = run.kind === RUN_KIND.ADD
        ? `condición agregada: ${item.addedCondition?.attribute ?? '?'}`
        : `condiciones eliminadas: ${item.removedConditions ?? 0}`;
      await appendLog({
        level: 'info',
        message: `Guardado: ${labelOf(item)} — ${detail}`,
      });
    }
  }
  if (touched) await setRun(run);

  // 2) Buscar el próximo item a procesar.
  //    Incluimos los SEARCHING sin matched: es el rastro de un tick anterior
  //    interrumpido por una navegación full-page del grid legacy.
  const nextIdx = run.items.findIndex((it) =>
    it.status === ITEM_STATUS.PENDING ||
    (it.status === ITEM_STATUS.SEARCHING && !it.matchedRuleId),
  );
  if (nextIdx === -1) {
    await finalize(run, { reason: 'done' });
    return;
  }

  const item = run.items[nextIdx];
  const isResuming = item.status === ITEM_STATUS.SEARCHING;
  if (!isResuming) {
    item.status = ITEM_STATUS.SEARCHING;
    run.currentItemIndex = nextIdx;
    await setRun(run);
    await appendLog({
      level: 'info',
      message: `Buscando ${run.searchBy === SEARCH_BY.RULE ? 'Rule' : 'ID'}: ${item.query}`,
    });
  } else {
    await appendLog({
      level: 'info',
      message: `Reanudando búsqueda de ${run.searchBy === SEARCH_BY.RULE ? 'Rule' : 'ID'}: ${item.query} (tras navegación)`,
    });
  }

  // 3) Filtro: si ya está aplicado para este query (post-nav), saltamos.
  try {
    await waitForGridReady();
    if (isFilterAppliedFor(run.searchBy, item.query)) {
      await appendLog({
        level: 'info',
        message: `Filtro ya aplicado en la URL; saltando refiltrado`,
      });
    } else {
      await clearFilters();
      const { rowCount, changed } = await applyFilter({ searchBy: run.searchBy, value: item.query });
      await appendLog({
        level: 'info',
        message: `Filtro aplicado: ${rowCount} fila(s) ${changed ? '' : '(snapshot no cambió)'}`,
      });
    }
  } catch (err) {
    item.status = ITEM_STATUS.ERROR;
    item.error  = `Falló al filtrar: ${err?.message || String(err)}`;
    await setRun(run);
    await appendLog({ level: 'error', message: `${item.query}: ${item.error}` });
    return;
  }

  // 4) Buscar la fila exacta.
  const rows = parseListingRows();
  const match = findMatchingRow(run.searchBy, item.query, rows);
  if (!match) {
    const sample = rows
      .slice(0, 5)
      .map((r) => (run.searchBy === SEARCH_BY.RULE ? `"${r.name}"` : r.ruleId))
      .filter((v) => v != null && v !== '')
      .join(', ');
    item.status = ITEM_STATUS.NOT_FOUND;
    item.error  = run.searchBy === SEARCH_BY.RULE
      ? 'No se encontró cupón con ese nombre exacto'
      : 'No se encontró cupón con ese ID';
    await setRun(run);
    await appendLog({
      level: 'warn',
      message: `${item.query}: no encontrado (${rows.length} fila(s)${sample ? `: ${sample}` : ''})`,
    });
    return;
  }

  item.matchedRuleId = match.ruleId;
  item.matchedName   = match.name;
  item.editHref      = match.editHref;
  item.status        = ITEM_STATUS.EDITING;
  await setRun(run);
  await appendLog({
    level: 'info',
    message: `Encontrado: ${match.name} (#${match.ruleId}) → navegando a edit`,
  });

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

    if (run.kind === RUN_KIND.ADD) {
      const added = await addCondition(run.condition);
      item.addedCondition = added;
      await setRun(run);
      await appendLog({
        level: 'info',
        message: `${labelOf(item)}: condición agregada (${added.attribute} ${run.condition.operatorLabel} "${added.value}") — guardando`,
      });
    } else {
      const removed = await removeAllConditions();
      item.removedConditions = removed;
      await setRun(run);
      await appendLog({
        level: 'info',
        message: `${labelOf(item)}: ${removed} condición(es) eliminada(s) — guardando`,
      });
    }

    await clickSave();
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
 * Filtros del backend de Magento usan LIKE %valor%, por eso siempre exigimos
 * match exacto post-filtrado; si no hay exacto pero hay una sola fila, la
 * aceptamos como fallback razonable.
 */
function findMatchingRow(searchBy, query, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  if (searchBy === SEARCH_BY.ID) {
    const q = Number(String(query).trim());
    if (!Number.isFinite(q)) return null;
    const exact = rows.find((r) => r.ruleId === q);
    if (exact) return exact;
    return rows.length === 1 ? rows[0] : null;
  }

  // SEARCH_BY.RULE
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
