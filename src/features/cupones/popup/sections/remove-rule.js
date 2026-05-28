// UI principal de la sección "Quitar Regla de Cupón".
//
// Responsabilidades:
//   - Permitir al usuario elegir el modo de búsqueda (ID o Rule) y pegar la
//     lista de cupones a procesar (uno por línea).
//   - Persistir esa configuración como último config (para próximas aperturas).
//   - Disparar un run escribiendo a chrome.storage.local. El content script en
//     la pestaña de Magento detecta el cambio y empieza a procesar.
//   - Mostrar progreso en vivo suscribiéndose a chrome.storage.onChanged.
//   - Botón de detención de emergencia (set active=false en storage).
//
// Reusa las clases CSS .lt-*  /  .ct-*  ya definidas en popup.css para
// mantener consistencia visual con las otras features.

import {
  DEFAULTS,
  ITEM_STATUS,
  SEARCH_BY,
  STORAGE_KEYS,
} from '../../constants.js';
import {
  clearRun,
  getLastConfig,
  getRun,
  setLastConfig,
  setRun,
  updateRun,
} from '../../state.js';
import { logger } from '../../../../shared/utils/logger.js';
import { escapeHtml, formatTime, parseQueries } from '../utils.js';

const log = logger('cupones/popup');

let unsubscribeStorage = null;

export async function render(container) {
  const last = (await getLastConfig()) || { searchBy: DEFAULTS.searchBy, rawQueries: '' };
  const run  = await getRun();

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Quitar Regla de Cupón</h3>
        <p class="lt-hint">Eliminará todas las condiciones (Conditions) del cupón en Magento y guardará. Funciona sobre Cart Price Rules.</p>

        <div class="dt-field">
          <label class="dt-label">Buscar por</label>
          <div class="cu-radio-row">
            <label class="cu-radio">
              <input type="radio" name="cu-search-by" value="${SEARCH_BY.ID}"
                     ${last.searchBy === SEARCH_BY.ID ? 'checked' : ''}>
              <span>ID</span>
            </label>
            <label class="cu-radio">
              <input type="radio" name="cu-search-by" value="${SEARCH_BY.RULE}"
                     ${last.searchBy === SEARCH_BY.RULE ? 'checked' : ''}>
              <span>Rule (nombre)</span>
            </label>
          </div>
          <p class="lt-hint">No se pueden mezclar IDs con Rules — todo el batch usa el mismo modo.</p>
        </div>

        <div class="dt-field">
          <label class="dt-label" for="cu-queries">Cupones (uno por línea)</label>
          <textarea id="cu-queries" class="dt-input dt-textarea" rows="6"
                    placeholder="6255&#10;6883&#10;26226">${escapeHtml(last.rawQueries || '')}</textarea>
        </div>

        <div class="lt-actions">
          <button type="button" id="cu-start" class="ct-btn ct-btn--primary">Iniciar</button>
          <button type="button" id="cu-stop"  class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="cu-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

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
    </div>
  `;

  container.querySelector('#cu-start').addEventListener('click', () => onStart(container));
  container.querySelector('#cu-stop').addEventListener('click', onStop);
  container.querySelector('#cu-clear').addEventListener('click', () => onClear(container));

  if (run) renderProgress(container, run);
  toggleButtons(container, run);

  unsubscribeStorage = subscribeToRunChanges((newRun) => {
    if (newRun) {
      renderProgress(container, newRun);
    } else {
      hideProgress(container);
    }
    toggleButtons(container, newRun);
  });
}

// -----------------------------------------------------------------------------
// start / stop / clear
// -----------------------------------------------------------------------------

async function onStart(container) {
  const searchBy = container.querySelector('input[name="cu-search-by"]:checked')?.value || DEFAULTS.searchBy;
  const rawQueries = container.querySelector('#cu-queries').value;
  const queries = parseQueries(rawQueries);

  if (queries.length === 0) {
    alert('Ingresá al menos un cupón.');
    return;
  }

  if (searchBy === SEARCH_BY.ID) {
    const bad = queries.filter((q) => !/^\d+$/.test(q));
    if (bad.length > 0) {
      alert(`Modo ID: estos valores no son numéricos:\n${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''}`);
      return;
    }
  }

  // Persistir config como último usado.
  await setLastConfig({ searchBy, rawQueries });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/\/sales_rule\/promo_quote/i.test(tab.url)) {
    const ok = confirm(
      'La pestaña activa no parece ser Cart Price Rules. ' +
      '¿Iniciar igual? (deberías abrir Magento primero)',
    );
    if (!ok) return;
  }

  const run = {
    active: true,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    searchBy,
    currentItemIndex: 0,
    items: queries.map((q) => ({ query: q, status: ITEM_STATUS.PENDING })),
    log: [{
      ts: Date.now(),
      level: 'info',
      message: `Run iniciado — ${queries.length} cupón(es), modo: ${searchBy}`,
    }],
  };
  await setRun(run);
  log.info('run lanzado', run);
  renderProgress(container, run);
  toggleButtons(container, run);
}

async function onStop() {
  if (!confirm('¿Detener el run en curso?')) return;
  await updateRun((run) => ({
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: 'cancelled',
  }));
  log.info('stop pedido desde popup');
}

async function onClear(container) {
  const run = await getRun();
  if (run?.active) {
    if (!confirm('Hay un run activo. ¿Detenerlo y limpiar?')) return;
    await updateRun((r) => ({ ...r, active: false, finishedAt: Date.now(), finishReason: 'cancelled' }));
  }
  await clearRun();
  log.info('run limpiado desde popup');
  hideProgress(container);
}

function hideProgress(container) {
  const wrap = container.querySelector('#cu-progress');
  if (wrap) wrap.classList.add('hidden');
}

// -----------------------------------------------------------------------------
// progreso
// -----------------------------------------------------------------------------

function toggleButtons(container, run) {
  const active   = Boolean(run?.active);
  const finished = Boolean(run && !run.active);
  const startBtn = container.querySelector('#cu-start');
  const stopBtn  = container.querySelector('#cu-stop');
  const clearBtn = container.querySelector('#cu-clear');
  if (startBtn) startBtn.disabled = active;
  if (stopBtn)  stopBtn.disabled  = !active;
  if (clearBtn) clearBtn.classList.toggle('hidden', !finished);
  container.querySelectorAll('#cu-queries, input[name="cu-search-by"]').forEach((el) => {
    el.disabled = active;
  });
}

function renderProgress(container, run) {
  const wrap = container.querySelector('#cu-progress');
  if (!run) { wrap?.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  const stats = computeStats(run);
  const titleEl = container.querySelector('#cu-progress-title');
  if (run.active) {
    titleEl.textContent = 'Procesando…';
  } else if (run.finishReason === 'cancelled') {
    titleEl.textContent = 'Cancelado';
  } else {
    titleEl.textContent = 'Finalizado';
  }

  const counterEl = container.querySelector('#cu-progress-counter');
  const breakdown = [];
  if (stats.ok        > 0) breakdown.push(`<span class="lt-stat-ok">${stats.ok} ok</span>`);
  if (stats.notFound  > 0) breakdown.push(`<span class="lt-stat-skipped">${stats.notFound} no encontrados</span>`);
  if (stats.error     > 0) breakdown.push(`<span class="lt-stat-error">${stats.error} con error</span>`);
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
        <span class="lt-region-leadtimes">${escapeHtml(detailForItem(item))}</span>
        <span class="lt-region-status">${labelStatus(item.status)}</span>
      </div>
      ${item.error ? `<div class="lt-err">${escapeHtml(item.error)}</div>` : ''}
    `;
    itemList.appendChild(li);
  });

  // Log
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

function computeStats(run) {
  const items = run.items || [];
  let ok = 0; let error = 0; let notFound = 0;
  for (const it of items) {
    if      (it.status === ITEM_STATUS.OK)        ok++;
    else if (it.status === ITEM_STATUS.ERROR)     error++;
    else if (it.status === ITEM_STATUS.NOT_FOUND) notFound++;
  }
  return {
    total: items.length,
    done:  ok + error + notFound,
    ok, error, notFound,
  };
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

function detailForItem(item) {
  if (item.status === ITEM_STATUS.OK) {
    return `${item.removedConditions ?? 0} cond.`;
  }
  return '';
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

// Expuesto para testing / debug:
export const __test = { computeStats, parseQueries };
