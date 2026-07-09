// UI de progreso para "Buscar número de órden en caso". Reusa las clases CSS
// .lt-* / .ct-* de popup.css. El run vive en chrome.storage.local; la UI se
// actualiza vía storage.onChanged.
//
// Controles (stop != pause):
//   - Pausar/Reanudar: paused=true/false (no aborta; reanudable).
//   - Detener: active=false (aborta el flujo).

import { SEARCH_FINISH, SEARCH_STATUS, STORAGE_KEYS } from '../constants.js';
import { clearSearchRun, getSearchRun, updateSearchRun } from '../state.js';
import { logger } from '../../../shared/utils/logger.js';
import { escapeHtml, formatTime } from './utils.js';

const log = logger('seller-center-falabella');

let unsubscribeStorage = null;

export function progressHtml() {
  return `
    <section id="scs-progress" class="lt-progress hidden">
      <div class="lt-progress-head">
        <strong id="scs-progress-title">Buscando…</strong>
        <span id="scs-progress-counter" class="dt-progress-counter"></span>
      </div>
      <div id="scs-progress-bar" class="lt-progress-bar"><span></span></div>
      <div class="scs-meta" id="scs-meta"></div>
      <ul id="scs-target-list" class="lt-region-list"></ul>
      <div class="lt-actions scs-result-actions hidden" id="scs-result-actions">
        <button type="button" id="scs-copy" class="ct-btn ct-btn--ghost">Copiar resultados</button>
      </div>
      <details class="ct-diag lt-log-details">
        <summary>Registro</summary>
        <ul id="scs-log" class="lt-log"></ul>
      </details>
    </section>
  `;
}

export function wireRunControls(container) {
  container.querySelector('#scs-pause')?.addEventListener('click', onTogglePause);
  container.querySelector('#scs-stop')?.addEventListener('click', onStop);
  container.querySelector('#scs-clear')?.addEventListener('click', () => onClear(container));
  container.querySelector('#scs-copy')?.addEventListener('click', () => onCopy(container));

  unsubscribeStorage = subscribeToRunChanges((newRun) => {
    if (newRun) renderProgress(container, newRun);
    else hideProgress(container);
    toggleButtons(container, newRun);
  });
}

export async function onTogglePause() {
  const run = await getSearchRun();
  if (!run || !run.active) return;
  const paused = !run.paused;
  await updateSearchRun((r) => ({ ...r, paused }));
  log.info(paused ? 'búsqueda pausada desde popup' : 'búsqueda reanudada desde popup');
}

export async function onStop() {
  if (!confirm('¿Detener la búsqueda? No podrá reanudarse (use Pausar para eso).')) return;
  await updateSearchRun((run) => ({
    ...run, active: false, paused: false, finishedAt: Date.now(), finishReason: SEARCH_FINISH.CANCELLED,
  }));
  log.info('stop de búsqueda pedido desde popup');
}

export async function onClear(container) {
  const run = await getSearchRun();
  if (run?.active) {
    if (!confirm('Hay una búsqueda activa. ¿Detenerla y limpiar?')) return;
    await updateSearchRun((r) => ({
      ...r, active: false, paused: false, finishedAt: Date.now(), finishReason: SEARCH_FINISH.CANCELLED,
    }));
  }
  await clearSearchRun();
  log.info('run de búsqueda limpiado desde popup');
  hideProgress(container);
}

async function onCopy(container) {
  const run = await getSearchRun();
  if (!run) return;
  const lines = buildResultLines(run);
  try {
    await navigator.clipboard.writeText(lines);
    const btn = container.querySelector('#scs-copy');
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = 'Copiado ✔';
      setTimeout(() => { btn.textContent = prev; }, 1500);
    }
  } catch {
    alert('No se pudo copiar. Resultados:\n\n' + lines);
  }
}

function buildResultLines(run) {
  const targets = run.targets || [];
  const found = run.found || {};
  const header = 'N° de orden\tN° de caso\tPágina';
  const rows = targets.map((t) => {
    const hit = found[t];
    return hit ? `${t}\t${hit.caseNumber}\t${hit.page ?? ''}` : `${t}\t(no encontrada)\t`;
  });
  return [header, ...rows].join('\n');
}

export function hideProgress(container) {
  container.querySelector('#scs-progress')?.classList.add('hidden');
}

export function toggleButtons(container, run) {
  const active   = Boolean(run?.active);
  const paused   = Boolean(run?.paused);
  const finished = Boolean(run && !run.active);
  const startBtn = container.querySelector('#scs-start');
  const pauseBtn = container.querySelector('#scs-pause');
  const stopBtn  = container.querySelector('#scs-stop');
  const clearBtn = container.querySelector('#scs-clear');

  if (startBtn) startBtn.disabled = active;
  if (stopBtn)  stopBtn.disabled  = !active;
  if (pauseBtn) {
    pauseBtn.disabled = !active;
    pauseBtn.textContent = paused ? 'Reanudar' : 'Pausar';
    pauseBtn.classList.toggle('ct-btn--primary', paused);
    pauseBtn.classList.toggle('ct-btn--ghost', !paused);
  }
  if (clearBtn) clearBtn.classList.toggle('hidden', !finished);

  container.querySelectorAll('.lt-form-card input, .lt-form-card textarea, .lt-form-card select')
    .forEach((el) => { el.disabled = active; });
}

export function renderProgress(container, run) {
  const wrap = container.querySelector('#scs-progress');
  if (!wrap) return;
  if (!run) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  const targets = run.targets || [];
  const found = run.found || {};
  const foundCount = targets.filter((t) => found[t]).length;
  const total = targets.length;

  const titleEl = container.querySelector('#scs-progress-title');
  titleEl.textContent = progressTitle(run, foundCount, total);

  const counterEl = container.querySelector('#scs-progress-counter');
  const breakdown = [];
  if (foundCount > 0) breakdown.push(`<span class="lt-stat-ok">${foundCount} encontrada(s)</span>`);
  const missing = total - foundCount;
  if (missing > 0 && !run.active) breakdown.push(`<span class="lt-stat-error">${missing} sin hallar</span>`);
  counterEl.innerHTML = `
    <span class="lt-stat-total">${foundCount} / ${total}</span>
    ${breakdown.length ? `<span class="lt-stat-sep"></span>${breakdown.join(' · ')}` : ''}
  `;

  const pct = total > 0 ? Math.round((foundCount / total) * 100) : 0;
  const bar = container.querySelector('#scs-progress-bar span');
  if (bar) bar.style.width = `${pct}%`;

  const metaEl = container.querySelector('#scs-meta');
  if (metaEl) {
    const pageTxt = run.currentPage != null
      ? `Página ${run.currentPage}${run.totalPages ? ` / ${run.totalPages}` : ''}`
      : 'Página —';
    metaEl.textContent = `${pageTxt} · ${run.casesScanned || 0} caso(s) escaneado(s)`;
  }

  renderTargets(container, run, found);
  renderLog(container, run);

  const resultActions = container.querySelector('#scs-result-actions');
  if (resultActions) resultActions.classList.toggle('hidden', total === 0);
}

function progressTitle(run, foundCount, total) {
  if (run.active) return run.paused ? 'Pausado' : 'Buscando…';
  switch (run.finishReason) {
    case SEARCH_FINISH.ALL_FOUND:    return `Listo — ${foundCount}/${total} encontradas`;
    case SEARCH_FINISH.EXHAUSTED:    return `Finalizado — ${foundCount}/${total} encontradas`;
    case SEARCH_FINISH.CANCELLED:    return 'Detenido';
    case SEARCH_FINISH.NOT_DETECTED: return 'Listado de casos no detectado';
    case SEARCH_FINISH.ERROR:        return 'Finalizado con errores';
    default:                         return 'Finalizado';
  }
}

function targetStatus(run, order, found) {
  if (found[order]) return SEARCH_STATUS.FOUND;
  return run.active ? SEARCH_STATUS.PENDING : SEARCH_STATUS.MISSING;
}

function renderTargets(container, run, found) {
  const list = container.querySelector('#scs-target-list');
  if (!list) return;
  list.innerHTML = '';
  (run.targets || []).forEach((order) => {
    const status = targetStatus(run, order, found);
    const hit = found[order];
    const li = document.createElement('li');
    li.className = `lt-region lt-region--${regionClass(status)}`;
    li.innerHTML = `
      <div class="lt-region-head">
        <span class="lt-region-name">Orden ${escapeHtml(order)}</span>
        ${hit ? `<span class="lt-region-leadtimes">caso ${escapeHtml(hit.caseNumber)}${hit.page != null ? ` · pág ${escapeHtml(String(hit.page))}` : ''}</span>` : ''}
        <span class="lt-region-status">${labelStatus(status)}</span>
      </div>
    `;
    list.appendChild(li);
  });
}

function renderLog(container, run) {
  const logEl = container.querySelector('#scs-log');
  if (!logEl) return;
  logEl.innerHTML = '';
  const entries = Array.isArray(run.log) ? run.log.slice(-60).reverse() : [];
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

function regionClass(status) {
  switch (status) {
    case SEARCH_STATUS.FOUND:   return 'done';
    case SEARCH_STATUS.MISSING: return 'error';
    default:                    return 'pending';
  }
}

function labelStatus(status) {
  switch (status) {
    case SEARCH_STATUS.FOUND:   return 'Encontrada';
    case SEARCH_STATUS.MISSING: return 'No encontrada';
    default:                    return 'Buscando…';
  }
}

function subscribeToRunChanges(callback) {
  if (unsubscribeStorage) unsubscribeStorage();
  const listener = (changes, area) => {
    if (area !== 'local') return;
    if (!changes[STORAGE_KEYS.SEARCH_RUN]) return;
    callback(changes[STORAGE_KEYS.SEARCH_RUN].newValue || null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    try { chrome.storage.onChanged.removeListener(listener); } catch { /* no-op */ }
  };
}
