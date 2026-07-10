// UI de progreso para "SoloTodo". Reusa las clases CSS .lt-* / .ct-* de popup.css.
// El run vive en chrome.storage.local; la UI se actualiza vía storage.onChanged.

import { FINISH_REASON, STATUS, STORAGE_KEYS } from '../constants.js';
import { clearRun, getRun, updateRun } from '../state.js';
import { logger } from '../../../shared/utils/logger.js';
import { escapeHtml, formatTime } from './utils.js';

const log = logger('solotodo');

let unsubscribeStorage = null;

export function progressHtml() {
  return `
    <section id="st-progress" class="lt-progress hidden">
      <div class="lt-progress-head">
        <strong id="st-progress-title">Procesando…</strong>
        <span id="st-progress-counter" class="dt-progress-counter"></span>
      </div>
      <div id="st-progress-bar" class="lt-progress-bar"><span></span></div>
      <ul id="st-item-list" class="lt-region-list"></ul>
      <details class="ct-diag lt-log-details">
        <summary>Registro</summary>
        <ul id="st-log" class="lt-log"></ul>
      </details>
    </section>
  `;
}

export function wireRunControls(container) {
  container.querySelector('#st-stop')?.addEventListener('click', onStop);
  container.querySelector('#st-clear')?.addEventListener('click', () => onClear(container));

  unsubscribeStorage = subscribeToRunChanges((newRun) => {
    if (newRun) renderProgress(container, newRun);
    else hideProgress(container);
    toggleButtons(container, newRun);
  });
}

export async function onStop() {
  if (!confirm('¿Detener el proceso en curso?')) return;
  await updateRun((run) => ({ ...run, active: false, finishedAt: Date.now(), finishReason: FINISH_REASON.CANCELLED }));
  log.info('stop pedido desde popup');
}

export async function onClear(container) {
  const run = await getRun();
  if (run?.active) {
    if (!confirm('Hay un proceso activo. ¿Detenerlo y limpiar?')) return;
    await updateRun((r) => ({ ...r, active: false, finishedAt: Date.now(), finishReason: FINISH_REASON.CANCELLED }));
  }
  await clearRun();
  log.info('run limpiado desde popup');
  hideProgress(container);
}

export function hideProgress(container) {
  container.querySelector('#st-progress')?.classList.add('hidden');
}

export function toggleButtons(container, run) {
  const active   = Boolean(run?.active);
  const finished = Boolean(run && !run.active);
  const startBtn = container.querySelector('#st-start');
  const stopBtn  = container.querySelector('#st-stop');
  const clearBtn = container.querySelector('#st-clear');
  if (startBtn) startBtn.disabled = active;
  if (stopBtn)  stopBtn.disabled  = !active;
  if (clearBtn) clearBtn.classList.toggle('hidden', !finished);
  container.querySelectorAll('.lt-form-card input, .lt-form-card select')
    .forEach((el) => { el.disabled = active; });
}

export function renderProgress(container, run) {
  const wrap = container.querySelector('#st-progress');
  if (!wrap) return;
  if (!run) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  const stats = computeStats(run);
  const titleEl = container.querySelector('#st-progress-title');
  if (run.active) titleEl.textContent = 'Procesando…';
  else if (run.finishReason === FINISH_REASON.CANCELLED) titleEl.textContent = 'Cancelado';
  else if (run.finishReason === FINISH_REASON.NOT_DETECTED) titleEl.textContent = 'Formulario no detectado';
  else if (run.finishReason === FINISH_REASON.ERROR) titleEl.textContent = 'Finalizado con errores';
  else titleEl.textContent = 'Finalizado';

  const counterEl = container.querySelector('#st-progress-counter');
  const breakdown = [];
  if (stats.ok    > 0) breakdown.push(`<span class="lt-stat-ok">${stats.ok} ok</span>`);
  if (stats.error > 0) breakdown.push(`<span class="lt-stat-error">${stats.error} con error</span>`);
  counterEl.innerHTML = `
    <span class="lt-stat-total">${stats.done} / ${stats.total}</span>
    ${breakdown.length ? `<span class="lt-stat-sep"></span>${breakdown.join(' · ')}` : ''}
  `;

  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  const bar = container.querySelector('#st-progress-bar span');
  if (bar) bar.style.width = `${pct}%`;

  const itemList = container.querySelector('#st-item-list');
  itemList.innerHTML = '';
  (run.items || []).forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = `lt-region lt-region--${itemStatusClass(item.status)}`;
    const isCurrent = idx === run.currentIndex && run.active && item.status === STATUS.RUNNING;
    if (isCurrent) li.classList.add('lt-region--current');
    const detail = item.detail ? ` · ${escapeHtml(item.detail)}` : '';
    li.innerHTML = `
      <div class="lt-region-head">
        <span class="lt-region-name">${escapeHtml(item.label)}${detail}</span>
        <span class="lt-region-status">${labelStatus(item.status)}</span>
      </div>
      ${item.reason ? `<div class="lt-err">${escapeHtml(item.reason)}</div>` : ''}
    `;
    itemList.appendChild(li);
  });

  const logEl = container.querySelector('#st-log');
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
  let ok = 0; let error = 0; let skipped = 0;
  for (const it of items) {
    if      (it.status === STATUS.OK)      ok++;
    else if (it.status === STATUS.ERROR)   error++;
    else if (it.status === STATUS.SKIPPED) skipped++;
  }
  return { total: items.length, done: ok + error + skipped, ok, error, skipped };
}

function itemStatusClass(s) {
  switch (s) {
    case STATUS.OK:      return 'done';
    case STATUS.ERROR:   return 'error';
    case STATUS.SKIPPED: return 'skipped';
    case STATUS.RUNNING: return 'running';
    default: return 'pending';
  }
}

function labelStatus(s) {
  switch (s) {
    case STATUS.PENDING: return 'Pendiente';
    case STATUS.RUNNING: return 'Procesando…';
    case STATUS.OK:      return 'OK';
    case STATUS.ERROR:   return 'Error';
    case STATUS.SKIPPED: return 'Omitido';
    default: return s || '';
  }
}

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
