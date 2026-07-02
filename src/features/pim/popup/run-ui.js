// UI de progreso y resultados de "Creación de producto" (PIM). Reusa las clases
// CSS .lt-* / .ct-* ya definidas en popup.css. El run vive en
// chrome.storage.local; la UI se actualiza vía storage.onChanged.

import { STATUS, STORAGE_KEYS } from '../constants.js';
import { clearRun, getRun, updateRun } from '../state.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  buildCopyText, buildCsv, copyToClipboard, downloadText,
  escapeHtml, existsLabel, formatTime,
} from './utils.js';

const log = logger('pim');

let unsubscribeStorage = null;

export function progressHtml() {
  return `
    <section id="pim-progress" class="lt-progress hidden">
      <div class="lt-progress-head">
        <strong id="pim-progress-title">Procesando…</strong>
        <span id="pim-progress-counter" class="dt-progress-counter"></span>
      </div>
      <div id="pim-progress-bar" class="lt-progress-bar"><span></span></div>
      <div id="pim-result-actions" class="lt-actions hidden">
        <button type="button" id="pim-copy" class="ct-btn ct-btn--ghost">Copiar resultados</button>
        <button type="button" id="pim-download" class="ct-btn ct-btn--ghost">Descargar CSV</button>
      </div>
      <ul id="pim-item-list" class="lt-region-list"></ul>
      <details class="ct-diag lt-log-details">
        <summary>Registro</summary>
        <ul id="pim-log" class="lt-log"></ul>
      </details>
    </section>
  `;
}

export function wireRunControls(container) {
  container.querySelector('#pim-stop')?.addEventListener('click', onStop);
  container.querySelector('#pim-clear')?.addEventListener('click', () => onClear(container));
  container.querySelector('#pim-copy')?.addEventListener('click', () => onCopy(container));
  container.querySelector('#pim-download')?.addEventListener('click', () => onDownload());

  unsubscribeStorage = subscribeToRunChanges((newRun) => {
    if (newRun) renderProgress(container, newRun);
    else hideProgress(container);
    toggleButtons(container, newRun);
  });
}

export async function onStop() {
  if (!confirm('¿Detener el proceso en curso?')) return;
  await updateRun((run) => ({ ...run, active: false, finishedAt: Date.now(), finishReason: 'cancelled' }));
  log.info('stop pedido desde popup');
}

export async function onClear(container) {
  const run = await getRun();
  if (run?.active) {
    if (!confirm('Hay un proceso activo. ¿Detenerlo y limpiar?')) return;
    await updateRun((r) => ({ ...r, active: false, finishedAt: Date.now(), finishReason: 'cancelled' }));
  }
  await clearRun();
  log.info('run limpiado desde popup');
  hideProgress(container);
}

async function onCopy(container) {
  const run = await getRun();
  const text = buildCopyText(run?.items || []);
  const ok = await copyToClipboard(text);
  const btn = container.querySelector('#pim-copy');
  if (btn) {
    const prev = btn.textContent;
    btn.textContent = ok ? '¡Copiado!' : 'No se pudo copiar';
    setTimeout(() => { btn.textContent = prev; }, 1500);
  }
}

async function onDownload() {
  const run = await getRun();
  const csv = buildCsv(run?.items || []);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadText(csv, `pim-existencia-${stamp}.csv`);
}

export function hideProgress(container) {
  container.querySelector('#pim-progress')?.classList.add('hidden');
}

export function toggleButtons(container, run) {
  const active   = Boolean(run?.active);
  const finished = Boolean(run && !run.active);
  const startBtn = container.querySelector('#pim-start');
  const stopBtn  = container.querySelector('#pim-stop');
  const clearBtn = container.querySelector('#pim-clear');
  if (startBtn) startBtn.disabled = active;
  if (stopBtn)  stopBtn.disabled  = !active;
  if (clearBtn) clearBtn.classList.toggle('hidden', !finished);
  container.querySelectorAll('.lt-form-card input, .lt-form-card textarea')
    .forEach((el) => { el.disabled = active; });
}

export function renderProgress(container, run) {
  const wrap = container.querySelector('#pim-progress');
  if (!wrap) return;
  if (!run) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  const stats = computeStats(run);
  const titleEl = container.querySelector('#pim-progress-title');
  if (run.active) titleEl.textContent = 'Verificando…';
  else if (run.finishReason === 'cancelled') titleEl.textContent = 'Cancelado';
  else if (run.finishReason === 'not-detected') titleEl.textContent = 'Pantalla no detectada';
  else if (run.finishReason === 'error') titleEl.textContent = 'Finalizado con errores';
  else titleEl.textContent = 'Finalizado';

  const counterEl = container.querySelector('#pim-progress-counter');
  const breakdown = [];
  if (stats.yes   > 0) breakdown.push(`<span class="lt-stat-ok">${stats.yes} existe(n)</span>`);
  if (stats.no    > 0) breakdown.push(`<span class="lt-stat-skipped">${stats.no} no</span>`);
  if (stats.error > 0) breakdown.push(`<span class="lt-stat-error">${stats.error} con error</span>`);
  counterEl.innerHTML = `
    <span class="lt-stat-total">${stats.done} / ${stats.total}</span>
    ${breakdown.length ? `<span class="lt-stat-sep"></span>${breakdown.join(' · ')}` : ''}
  `;

  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  const bar = container.querySelector('#pim-progress-bar span');
  if (bar) bar.style.width = `${pct}%`;

  // Acciones de resultado: sólo al finalizar y si hay al menos un resultado.
  const actions = container.querySelector('#pim-result-actions');
  if (actions) actions.classList.toggle('hidden', run.active || stats.done === 0);

  const itemList = container.querySelector('#pim-item-list');
  itemList.innerHTML = '';
  (run.items || []).forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = `lt-region lt-region--${itemStatusClass(item)}`;
    const isCurrent = idx === run.currentIndex && run.active && item.status === STATUS.RUNNING;
    if (isCurrent) li.classList.add('lt-region--current');
    const specLine = item.status === STATUS.OK && item.found
      ? `<div class="lt-region-detail">Spec Assign: <strong>${item.specAssign ? escapeHtml(item.specAssign) : '—'}</strong></div>`
      : '';
    li.innerHTML = `
      <div class="lt-region-head">
        <span class="lt-region-name">#${idx + 1} · ${escapeHtml(item.sku)}</span>
        <span class="lt-region-status">${labelStatus(item)}</span>
      </div>
      ${specLine}
      ${item.reason ? `<div class="lt-err">${escapeHtml(item.reason)}</div>` : ''}
    `;
    itemList.appendChild(li);
  });

  const logEl = container.querySelector('#pim-log');
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
  let yes = 0; let no = 0; let error = 0;
  for (const it of items) {
    if (it.status === STATUS.ERROR) { error++; continue; }
    const label = existsLabel(it);
    if (label === 'YES') yes++;
    else if (label === 'NO') no++;
  }
  return { total: items.length, done: yes + no + error, yes, no, error };
}

function itemStatusClass(item) {
  if (item.status === STATUS.ERROR)   return 'error';
  if (item.status === STATUS.RUNNING) return 'running';
  if (item.status === STATUS.OK)      return item.found ? 'done' : 'skipped';
  return 'pending';
}

function labelStatus(item) {
  switch (item.status) {
    case STATUS.PENDING: return 'Pendiente';
    case STATUS.RUNNING: return 'Buscando…';
    case STATUS.ERROR:   return 'Error';
    case STATUS.OK:      return item.found ? 'YES · existe' : 'NO · no existe';
    default: return item.status || '';
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
