// UI de progreso compartida entre las secciones de Cupones (Quitar / Agregar
// Regla). Ambas secciones disparan un único run (STORAGE_KEYS.RUN) y comparten
// el mismo render de progreso/log y los controles Detener/Limpiar. Cada sección
// aporta su propio formulario + onStart; lo demás vive acá para no duplicar.
//
// Reusa las clases CSS .lt-* / .ct-* ya definidas en popup.css.

import { ITEM_STATUS, RUN_KIND, SEARCH_BY, STORAGE_KEYS } from '../constants.js';
import { clearRun, getRun, updateRun } from '../state.js';
import { logger } from '../../../shared/utils/logger.js';
import { escapeHtml, formatTime } from './utils.js';

const log = logger('cupones/popup');

let unsubscribeStorage = null;

/** Markup de la sección de progreso (oculta por defecto). */
export function progressHtml() {
  return `
    <section id="cu-progress" class="lt-progress hidden">
      <div class="lt-progress-head">
        <strong id="cu-progress-title">Procesando…</strong>
        <span id="cu-progress-counter" class="dt-progress-counter"></span>
      </div>
      <div id="cu-progress-bar" class="lt-progress-bar"><span></span></div>
      <ul id="cu-item-list" class="lt-region-list"></ul>
      <details class="ct-diag lt-log-details">
        <summary>Registro</summary>
        <ul id="cu-log" class="lt-log"></ul>
      </details>
    </section>
  `;
}

/** Cablea los botones Detener/Limpiar y la suscripción a storage. */
export function wireRunControls(container) {
  container.querySelector('#cu-stop')?.addEventListener('click', onStop);
  container.querySelector('#cu-clear')?.addEventListener('click', () => onClear(container));

  unsubscribeStorage = subscribeToRunChanges((newRun) => {
    if (newRun) renderProgress(container, newRun);
    else hideProgress(container);
    toggleButtons(container, newRun);
  });
}

export async function onStop() {
  if (!confirm('¿Detener el run en curso?')) return;
  await updateRun((run) => ({
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: 'cancelled',
  }));
  log.info('stop pedido desde popup');
}

export async function onClear(container) {
  const run = await getRun();
  if (run?.active) {
    if (!confirm('Hay un run activo. ¿Detenerlo y limpiar?')) return;
    await updateRun((r) => ({ ...r, active: false, finishedAt: Date.now(), finishReason: 'cancelled' }));
  }
  await clearRun();
  log.info('run limpiado desde popup');
  hideProgress(container);
}

export function hideProgress(container) {
  container.querySelector('#cu-progress')?.classList.add('hidden');
}

// -----------------------------------------------------------------------------
// botones / progreso
// -----------------------------------------------------------------------------

export function toggleButtons(container, run) {
  const active   = Boolean(run?.active);
  const finished = Boolean(run && !run.active);
  const startBtn = container.querySelector('#cu-start');
  const stopBtn  = container.querySelector('#cu-stop');
  const clearBtn = container.querySelector('#cu-clear');
  if (startBtn) startBtn.disabled = active;
  if (stopBtn)  stopBtn.disabled  = !active;
  if (clearBtn) clearBtn.classList.toggle('hidden', !finished);
  // Bloquear todos los controles del formulario mientras hay un run activo.
  container.querySelectorAll('.lt-form-card input, .lt-form-card textarea, .lt-form-card select')
    .forEach((el) => { el.disabled = active; });
}

export function renderProgress(container, run) {
  const wrap = container.querySelector('#cu-progress');
  if (!wrap) return;
  if (!run) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  const stats = computeStats(run);
  const titleEl = container.querySelector('#cu-progress-title');
  if (run.active) titleEl.textContent = 'Procesando…';
  else if (run.finishReason === 'cancelled') titleEl.textContent = 'Cancelado';
  else titleEl.textContent = 'Finalizado';

  const counterEl = container.querySelector('#cu-progress-counter');
  const breakdown = [];
  if (stats.ok       > 0) breakdown.push(`<span class="lt-stat-ok">${stats.ok} ok</span>`);
  if (stats.notFound > 0) breakdown.push(`<span class="lt-stat-skipped">${stats.notFound} no encontrados</span>`);
  if (stats.error    > 0) breakdown.push(`<span class="lt-stat-error">${stats.error} con error</span>`);
  counterEl.innerHTML = `
    <span class="lt-stat-total">${stats.done} / ${stats.total}</span>
    ${breakdown.length ? `<span class="lt-stat-sep"></span>${breakdown.join(' · ')}` : ''}
  `;

  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  const bar = container.querySelector('#cu-progress-bar span');
  if (bar) bar.style.width = `${pct}%`;

  const itemList = container.querySelector('#cu-item-list');
  itemList.innerHTML = '';
  (run.items || []).forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = `lt-region lt-region--${itemStatusClass(item.status)}`;
    const isCurrent = idx === run.currentItemIndex && run.active &&
      (item.status === ITEM_STATUS.SEARCHING || item.status === ITEM_STATUS.EDITING);
    if (isCurrent) li.classList.add('lt-region--current');
    li.innerHTML = `
      <div class="lt-region-head">
        <span class="lt-region-name">${escapeHtml(labelForItem(item, run.searchBy))}</span>
        <span class="lt-region-leadtimes">${escapeHtml(detailForItem(item, run))}</span>
        <span class="lt-region-status">${labelStatus(item.status)}</span>
      </div>
      ${item.error ? `<div class="lt-err">${escapeHtml(item.error)}</div>` : ''}
    `;
    itemList.appendChild(li);
  });

  const logEl = container.querySelector('#cu-log');
  logEl.innerHTML = '';
  const entries = Array.isArray(run.log) ? run.log.slice(-50).reverse() : [];
  for (const e of entries) {
    const li = document.createElement('li');
    li.className = `lt-log-item lt-log-item--${e.level}`;
    li.innerHTML = `
      <span class="lt-log-time">${formatTime(e.ts)}</span>
      <span class="lt-log-msg">${escapeHtml(e.message)}</span>
    `;
    logEl.appendChild(li);
  }
}

export function computeStats(run) {
  const items = run.items || [];
  let ok = 0; let error = 0; let notFound = 0;
  for (const it of items) {
    if      (it.status === ITEM_STATUS.OK)        ok++;
    else if (it.status === ITEM_STATUS.ERROR)     error++;
    else if (it.status === ITEM_STATUS.NOT_FOUND) notFound++;
  }
  return { total: items.length, done: ok + error + notFound, ok, error, notFound };
}

function itemStatusClass(s) {
  switch (s) {
    case ITEM_STATUS.OK:        return 'done';
    case ITEM_STATUS.ERROR:     return 'error';
    case ITEM_STATUS.NOT_FOUND: return 'error';
    case ITEM_STATUS.SEARCHING:
    case ITEM_STATUS.EDITING:   return 'running';
    default: return 'pending';
  }
}

function labelStatus(s) {
  switch (s) {
    case ITEM_STATUS.PENDING:   return 'Pendiente';
    case ITEM_STATUS.SEARCHING: return 'Buscando…';
    case ITEM_STATUS.EDITING:   return 'Editando…';
    case ITEM_STATUS.OK:        return 'OK';
    case ITEM_STATUS.ERROR:     return 'Error';
    case ITEM_STATUS.NOT_FOUND: return 'No encontrado';
    default: return s || '';
  }
}

function labelForItem(item, searchBy) {
  if (item.matchedName && item.matchedRuleId) {
    return `${item.matchedName} (#${item.matchedRuleId})`;
  }
  return `${searchBy === SEARCH_BY.RULE ? 'Rule' : 'ID'}: ${item.query}`;
}

function detailForItem(item, run) {
  if (item.status !== ITEM_STATUS.OK) return '';
  if (run.kind === RUN_KIND.ADD) {
    return item.addedCondition ? `+${item.addedCondition.attribute}` : '+1 cond.';
  }
  return `${item.removedConditions ?? 0} cond.`;
}

// -----------------------------------------------------------------------------
// storage subscription
// -----------------------------------------------------------------------------

function subscribeToRunChanges(callback) {
  if (unsubscribeStorage) unsubscribeStorage();
  const listener = (changes, area) => {
    if (area !== 'local') return;
    if (!changes[STORAGE_KEYS.RUN]) return;
    callback(changes[STORAGE_KEYS.RUN].newValue || null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    try { chrome.storage.onChanged.removeListener(listener); } catch { /* no-op */ }
  };
}

export const __test = { computeStats };
