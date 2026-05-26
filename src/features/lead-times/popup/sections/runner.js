// UI principal de la feature lead-times.
//
// Responsabilidades:
//   - Permitir al usuario armar una "queue" de regiones a procesar (regionName,
//     minDays, maxDays), persistir esa configuración como último config.
//   - Disparar un run escribiendo a chrome.storage.local. El content script en
//     la pestaña de Magento detecta el cambio y empieza a procesar.
//   - Mostrar progreso en vivo suscribiéndose a chrome.storage.onChanged.
//   - Botón de detención de emergencia (set active=false en storage).

import {
  COMUNA_STATUS,
  DEFAULTS,
  REGION_STATUS,
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
import { escapeHtml, formatTime } from '../utils.js';

const log = logger('lead-times/popup');

let unsubscribeStorage = null;

export async function render(container) {
  const last  = (await getLastConfig()) || { rows: [] };
  const run   = await getRun();
  const queue = normalizeQueueForUi(last.rows, run);

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Regiones a procesar</h3>
        <p class="lt-hint">Ingresá el nombre exacto (o parcial) que aparece en "Address Level 1". Los lead times se aplican a cada comuna de la región.</p>

        <div id="lt-queue-list" class="lt-queue-list"></div>

        <button type="button" id="lt-add-region" class="ct-btn ct-btn--ghost lt-add-btn">
          + Agregar región
        </button>

        <div class="lt-actions">
          <button type="button" id="lt-start" class="ct-btn ct-btn--primary">Iniciar</button>
          <button type="button" id="lt-stop"  class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="lt-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      <section id="lt-progress" class="lt-progress hidden">
        <div class="lt-progress-head">
          <strong id="lt-progress-title">Procesando…</strong>
          <span id="lt-progress-counter" class="dt-progress-counter"></span>
        </div>
        <div id="lt-progress-bar" class="lt-progress-bar"><span></span></div>
        <ul id="lt-region-list" class="lt-region-list"></ul>
        <details class="ct-diag lt-log-details">
          <summary>Registro</summary>
          <ul id="lt-log" class="lt-log"></ul>
        </details>
      </section>
    </div>
  `;

  const queueList = container.querySelector('#lt-queue-list');
  renderQueueRows(queueList, queue);

  container.querySelector('#lt-add-region').addEventListener('click', () => {
    queue.push(blankRow());
    renderQueueRows(queueList, queue);
  });

  container.querySelector('#lt-start').addEventListener('click', () => onStart(container, queue));
  container.querySelector('#lt-stop').addEventListener('click', onStop);
  container.querySelector('#lt-clear').addEventListener('click', () => onClear(container));

  // Si ya hay un run (activo o terminado) mostrar progreso inmediatamente.
  if (run) renderProgress(container, run);
  toggleButtons(container, run);

  // Suscribirse a cambios para refrescar live.
  unsubscribeStorage = subscribeToRunChanges((newRun) => {
    if (newRun) {
      renderProgress(container, newRun);
    } else {
      // Run borrado de storage → ocultar progreso y resetear vista.
      hideProgress(container);
      // Re-pintar la queue desde el último config.
      getLastConfig().then((last) => {
        const q = normalizeQueueForUi(last?.rows || [], null);
        // Reemplazar la queue actual en pantalla.
        const newList = container.querySelector('#lt-queue-list');
        if (newList) renderQueueRows(newList, q);
      });
    }
    toggleButtons(container, newRun);
  });
}

// -----------------------------------------------------------------------------
// queue (form de regiones)
// -----------------------------------------------------------------------------

function normalizeQueueForUi(rows, run) {
  // Si hay un run activo, mostramos la queue del run (no la del último config).
  if (run?.active && Array.isArray(run.queue) && run.queue.length > 0) {
    return run.queue.map((r) => ({
      regionName: r.regionName,
      minDays: r.minDays,
      maxDays: r.maxDays,
      readonly: true,
    }));
  }
  if (Array.isArray(rows) && rows.length > 0) return rows.map((r) => ({ ...r, readonly: false }));
  return [blankRow()];
}

function blankRow() {
  return { regionName: '', minDays: DEFAULTS.minDays, maxDays: DEFAULTS.maxDays, readonly: false };
}

function renderQueueRows(container, queue) {
  container.innerHTML = '';
  queue.forEach((row, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'lt-queue-row';
    wrap.innerHTML = `
      <input type="text" class="dt-input lt-region-input" placeholder="Región del Maule"
             value="${escapeHtml(row.regionName)}" data-field="regionName" ${row.readonly ? 'disabled' : ''} />
      <input type="number" min="0" class="dt-input lt-num" placeholder="Min"
             value="${escapeHtml(row.minDays)}" data-field="minDays" ${row.readonly ? 'disabled' : ''} />
      <input type="number" min="0" class="dt-input lt-num" placeholder="Max"
             value="${escapeHtml(row.maxDays)}" data-field="maxDays" ${row.readonly ? 'disabled' : ''} />
      <button type="button" class="lt-row-del" title="Quitar" ${row.readonly ? 'disabled' : ''} aria-label="Quitar">×</button>
    `;
    wrap.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const field = inp.dataset.field;
        row[field] = field === 'regionName' ? inp.value : inp.value;
      });
    });
    wrap.querySelector('.lt-row-del').addEventListener('click', () => {
      queue.splice(idx, 1);
      if (queue.length === 0) queue.push(blankRow());
      renderQueueRows(container, queue);
    });
    container.appendChild(wrap);
  });
}

// -----------------------------------------------------------------------------
// start / stop
// -----------------------------------------------------------------------------

async function onStart(container, queue) {
  const cleaned = queue
    .map((r) => ({
      regionName: String(r.regionName ?? '').trim(),
      minDays:    parseInt(r.minDays, 10),
      maxDays:    parseInt(r.maxDays, 10),
    }))
    .filter((r) => r.regionName);

  if (cleaned.length === 0) {
    alert('Agregá al menos una región.');
    return;
  }
  for (const r of cleaned) {
    if (!Number.isFinite(r.minDays) || !Number.isFinite(r.maxDays)) {
      alert(`Lead times inválidos para ${r.regionName}.`); return;
    }
    if (r.minDays < 0 || r.maxDays < 0) {
      alert(`Lead times deben ser ≥ 0 (${r.regionName}).`); return;
    }
    if (r.minDays > r.maxDays) {
      alert(`Min > Max en ${r.regionName}.`); return;
    }
  }

  // Persistir el config como último usado (para próximas aperturas del popup).
  await setLastConfig({ rows: cleaned });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/regional_management\/level2/i.test(tab.url)) {
    const ok = confirm(
      'La pestaña activa no parece ser Manage Address Level 2. ' +
      '¿Iniciar igual? (deberías abrir Magento primero)',
    );
    if (!ok) return;
  }

  const run = {
    active: true,
    startedAt: Date.now(),
    finishedAt: null,
    currentRegionIndex: 0,
    queue: cleaned.map((r) => ({
      regionName: r.regionName,
      minDays:    r.minDays,
      maxDays:    r.maxDays,
      status:     REGION_STATUS.PENDING,
    })),
    log: [{ ts: Date.now(), level: 'info', message: `Run iniciado — ${cleaned.length} región(es)` }],
  };
  await setRun(run);
  log.info('run lanzado', run);
  renderProgress(container, run);
  toggleButtons(container, true);
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
  // Sólo permitimos limpiar runs que ya no están activos. Si quedó activo
  // por alguna razón, forzamos stop primero.
  if (run?.active) {
    if (!confirm('Hay un run activo. ¿Detenerlo y limpiar?')) return;
    await updateRun((r) => ({ ...r, active: false, finishedAt: Date.now(), finishReason: 'cancelled' }));
  }
  await clearRun();
  log.info('run limpiado desde popup');
  hideProgress(container);
  // El listener de storage.onChanged se va a disparar igual; toggleButtons se actualizará.
}

function hideProgress(container) {
  const wrap = container.querySelector('#lt-progress');
  if (wrap) wrap.classList.add('hidden');
}

// -----------------------------------------------------------------------------
// progreso
// -----------------------------------------------------------------------------

function toggleButtons(container, run) {
  const active   = Boolean(run?.active);
  const finished = Boolean(run && !run.active);
  const startBtn = container.querySelector('#lt-start');
  const stopBtn  = container.querySelector('#lt-stop');
  const clearBtn = container.querySelector('#lt-clear');
  const addBtn   = container.querySelector('#lt-add-region');
  if (startBtn) startBtn.disabled = active;
  if (stopBtn)  stopBtn.disabled  = !active;
  if (addBtn)   addBtn.disabled   = active;
  if (clearBtn) clearBtn.classList.toggle('hidden', !finished);
  container.querySelectorAll('#lt-queue-list input, #lt-queue-list button').forEach((el) => {
    el.disabled = active;
  });
}

function renderProgress(container, run) {
  const wrap = container.querySelector('#lt-progress');
  if (!run) { wrap?.classList.add('hidden'); return; }

  wrap.classList.remove('hidden');

  const stats = computeStats(run);
  const titleEl = container.querySelector('#lt-progress-title');
  if (run.active) {
    titleEl.textContent = 'Procesando…';
  } else if (run.finishReason === 'cancelled') {
    titleEl.textContent = 'Cancelado';
  } else {
    titleEl.textContent = 'Finalizado';
  }
  const counterEl = container.querySelector('#lt-progress-counter');
  const breakdown = [];
  if (stats.ok      > 0) breakdown.push(`<span class="lt-stat-ok">${stats.ok} modificadas</span>`);
  if (stats.skipped > 0) breakdown.push(`<span class="lt-stat-skipped">${stats.skipped} omitidas</span>`);
  if (stats.error   > 0) breakdown.push(`<span class="lt-stat-error">${stats.error} con error</span>`);
  counterEl.innerHTML = `
    <span class="lt-stat-total">${stats.doneComunas} / ${stats.totalComunas}</span>
    ${breakdown.length ? `<span class="lt-stat-sep"></span>${breakdown.join(' · ')}` : ''}
  `;

  const pct = stats.totalComunas > 0 ? Math.round((stats.doneComunas / stats.totalComunas) * 100) : 0;
  const bar = container.querySelector('#lt-progress-bar span');
  if (bar) bar.style.width = `${pct}%`;

  // Lista de regiones
  const regionList = container.querySelector('#lt-region-list');
  regionList.innerHTML = '';
  (run.queue || []).forEach((region, idx) => {
    const li = document.createElement('li');
    li.className = `lt-region lt-region--${region.status || REGION_STATUS.PENDING}`;
    const isCurrent = idx === run.currentRegionIndex && run.active;
    if (isCurrent) li.classList.add('lt-region--current');
    const comunaStats = region.comunas ? computeRegionStats(region) : null;
    li.innerHTML = `
      <div class="lt-region-head">
        <span class="lt-region-name">${escapeHtml(region.regionName)}</span>
        <span class="lt-region-leadtimes">${region.minDays}/${region.maxDays} días</span>
        <span class="lt-region-status">${labelRegionStatus(region.status)}</span>
      </div>
      ${comunaStats ? `
        <div class="lt-region-counts">
          <span>${comunaStats.done}/${comunaStats.total}</span>
          ${comunaStats.ok       ? `<span class="lt-stat-ok">✓ ${comunaStats.ok}</span>` : ''}
          ${comunaStats.skipped  ? `<span class="lt-stat-skipped">⊝ ${comunaStats.skipped}</span>` : ''}
          ${comunaStats.error    ? `<span class="lt-stat-error">✗ ${comunaStats.error}</span>` : ''}
          ${region.currentComunaIndex != null
            && region.comunas[region.currentComunaIndex]
            && region.comunas[region.currentComunaIndex].status === 'running'
            ? `<span class="lt-current">→ ${escapeHtml(region.comunas[region.currentComunaIndex].name)}</span>`
            : ''}
        </div>
      ` : ''}
      ${region.error ? `<div class="lt-err">${escapeHtml(region.error)}</div>` : ''}
    `;
    regionList.appendChild(li);
  });

  // Log
  const logEl = container.querySelector('#lt-log');
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
  let totalComunas = 0;
  let ok = 0; let skipped = 0; let error = 0;
  for (const region of run.queue || []) {
    if (Array.isArray(region.comunas)) {
      totalComunas += region.comunas.length;
      for (const c of region.comunas) {
        if      (c.status === COMUNA_STATUS.OK)      ok++;
        else if (c.status === COMUNA_STATUS.SKIPPED) skipped++;
        else if (c.status === COMUNA_STATUS.ERROR)   error++;
      }
    }
  }
  return { totalComunas, doneComunas: ok + skipped + error, ok, skipped, error };
}

function computeRegionStats(region) {
  let ok = 0; let skipped = 0; let error = 0;
  for (const c of region.comunas) {
    if      (c.status === COMUNA_STATUS.OK)      ok++;
    else if (c.status === COMUNA_STATUS.SKIPPED) skipped++;
    else if (c.status === COMUNA_STATUS.ERROR)   error++;
  }
  return {
    total: region.totalComunas ?? region.comunas.length,
    done:  ok + skipped + error,
    ok, skipped, error,
  };
}

function labelRegionStatus(s) {
  switch (s) {
    case REGION_STATUS.PENDING:    return 'Pendiente';
    case REGION_STATUS.COLLECTING: return 'Recolectando';
    case REGION_STATUS.RUNNING:    return 'En curso';
    case REGION_STATUS.DONE:       return 'OK';
    case REGION_STATUS.ERROR:      return 'Error';
    default: return s || '';
  }
}

// -----------------------------------------------------------------------------
// suscripción a storage.onChanged
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
export const __test = { computeStats, computeRegionStats, normalizeQueueForUi };
