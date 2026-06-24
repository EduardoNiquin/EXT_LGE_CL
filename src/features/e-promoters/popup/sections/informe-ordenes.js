// UI de "Informe ordenes" (E-promoters).
//
// El usuario elige el origen (API o CSV cargado), un rango de fechas (selector
// interactivo dia/mes/año, filtra por la columna "Local Time") y arranca. El
// procesamiento corre en el SERVICE WORKER (segundo plano): la extension pide
// los datos / lee el archivo, aplica los filtros (estados a recuperar + dedupe
// de canceladas), genera el CSV recortado y lo descarga solo. El progreso se
// refleja en vivo via storage.onChanged y sobrevive a cerrar el popup.

import {
  FINISH_REASON,
  KEEP_STATUSES,
  MESSAGES,
  PHASE,
  PHASE_LABEL,
  SOURCE,
} from '../../constants.js';
import {
  clearResult,
  clearRun,
  getDraft,
  getResult,
  getRun,
  setDraft,
  subscribeToRun,
  updateRun,
} from '../../state.js';
import { logger } from '../../../../shared/utils/logger.js';
import { debounce } from '../../../../shared/ui/persist.js';
import {
  downloadText,
  escapeHtml,
  formatBytes,
  formatTime,
  shiftYmd,
  todayYmd,
} from '../utils.js';

const log = logger('e-promoters');

// Estado local de la vista (el texto del CSV NO se persiste — puede pesar mucho).
const ui = {
  source: SOURCE.API,
  from: '',
  to: '',
  csvText: '',
  fileName: '',
};

let unsubscribe = null;

export async function render(container) {
  const draft = await getDraft();
  ui.source = draft?.source === SOURCE.CSV ? SOURCE.CSV : SOURCE.API;
  ui.from = draft?.from || shiftYmd(todayYmd(), -7);
  ui.to = draft?.to || todayYmd();
  ui.csvText = '';
  ui.fileName = '';

  container.innerHTML = `
    <div class="lt-view epr-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Informe ordenes</h3>
        <p class="lt-hint">
          Genera el CSV de ordenes a <strong>recuperar</strong> para los e-promoters. Toma el informe
          de Magento (desde la <strong>API</strong> o un <strong>archivo CSV</strong>), filtra por
          rango de fechas y estados, quita canceladas duplicadas y recorta a las columnas necesarias.
          El proceso corre en segundo plano: puedes cerrar este panel y seguir trabajando.
        </p>

        <div class="scf-mode-row" role="tablist">
          <button type="button" class="scf-mode-btn" data-source="${SOURCE.API}">Desde la API</button>
          <button type="button" class="scf-mode-btn" data-source="${SOURCE.CSV}">Subir CSV</button>
        </div>

        <div class="epr-dates">
          <label class="epr-field">
            <span class="epr-label">Desde</span>
            <input type="date" id="epr-from" class="dt-input" value="${escapeHtml(ui.from)}" max="${todayYmd()}">
          </label>
          <label class="epr-field">
            <span class="epr-label">Hasta</span>
            <input type="date" id="epr-to" class="dt-input" value="${escapeHtml(ui.to)}" max="${todayYmd()}">
          </label>
        </div>
        <p class="lt-hint epr-date-note">Se filtra por la columna <code>Local Time</code> (dia/mes/año, ambos extremos incluidos).</p>

        <div id="epr-pane-csv" class="scf-pane hidden">
          <input type="file" id="epr-file" class="dt-input" accept=".csv,text/csv,text/plain">
          <p id="epr-file-name" class="lt-hint"></p>
        </div>

        <details class="ct-diag epr-status-hint">
          <summary>Estados que se conservan (${KEEP_STATUSES.length})</summary>
          <ul class="epr-status-list">
            ${KEEP_STATUSES.map((s) => `<li><code>${escapeHtml(s)}</code></li>`).join('')}
          </ul>
          <p class="lt-hint">Las canceladas (<code>canceled</code> / <code>customer_canceled</code>) duplicadas por
          <strong>Customer Email + Bill-to Name</strong> se reducen a una.</p>
        </details>

        <div class="lt-actions">
          <button type="button" id="epr-start" class="ct-btn ct-btn--primary">Generar informe</button>
          <button type="button" id="epr-cancel" class="ct-btn ct-btn--ghost" disabled>Cancelar</button>
          <button type="button" id="epr-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      <section id="epr-progress" class="lt-progress hidden">
        <div class="lt-progress-head">
          <strong id="epr-progress-title">Procesando…</strong>
          <span id="epr-progress-phase" class="dt-progress-counter"></span>
        </div>
        <div id="epr-progress-bar" class="lt-progress-bar"><span></span></div>
        <div id="epr-result" class="epr-result hidden"></div>
        <div id="epr-stats" class="epr-stats hidden"></div>
        <details class="ct-diag lt-log-details">
          <summary>Registro</summary>
          <ul id="epr-log" class="lt-log"></ul>
        </details>
      </section>
    </div>
  `;

  applySource(container);

  container.querySelectorAll('.scf-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.source = btn.dataset.source;
      applySource(container);
      persistDraft();
    });
  });

  const onDate = debounce(() => {
    ui.from = container.querySelector('#epr-from').value;
    ui.to = container.querySelector('#epr-to').value;
    persistDraft();
  }, 200);
  container.querySelector('#epr-from').addEventListener('change', onDate);
  container.querySelector('#epr-to').addEventListener('change', onDate);

  container.querySelector('#epr-file').addEventListener('change', (e) => onFile(e, container));
  container.querySelector('#epr-start').addEventListener('click', () => onStart());
  container.querySelector('#epr-cancel').addEventListener('click', () => onCancel());
  container.querySelector('#epr-clear').addEventListener('click', () => onClear(container));

  // Estado inicial + suscripcion en vivo.
  const run = await getRun();
  renderRun(container, run);

  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeToRun((newRun) => renderRun(container, newRun));
}

function applySource(container) {
  container.querySelectorAll('.scf-mode-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.source === ui.source);
  });
  container.querySelector('#epr-pane-csv').classList.toggle('hidden', ui.source !== SOURCE.CSV);
}

function persistDraft() {
  // Nunca persistimos el texto del CSV (puede pesar ~15 MB).
  setDraft({ source: ui.source, from: ui.from, to: ui.to }).catch(() => {});
}

function onFile(event, container) {
  const file = event.target.files && event.target.files[0];
  const nameEl = container.querySelector('#epr-file-name');
  if (!file) { ui.csvText = ''; ui.fileName = ''; if (nameEl) nameEl.textContent = ''; return; }
  if (nameEl) nameEl.textContent = `Leyendo ${file.name}…`;
  const reader = new FileReader();
  reader.onload = () => {
    ui.csvText = String(reader.result || '');
    ui.fileName = file.name;
    if (nameEl) nameEl.innerHTML = `Archivo: <strong>${escapeHtml(file.name)}</strong> (${formatBytes(file.size)})`;
  };
  reader.onerror = () => {
    ui.csvText = ''; ui.fileName = '';
    if (nameEl) nameEl.textContent = 'No se pudo leer el archivo.';
  };
  reader.readAsText(file);
}

function validate() {
  if (!ui.from || !ui.to) return 'Selecciona el rango de fechas (Desde y Hasta).';
  if (ui.from > ui.to) return 'La fecha "Desde" no puede ser posterior a "Hasta".';
  if (ui.source === SOURCE.CSV && !ui.csvText.trim()) return 'Carga un archivo CSV.';
  return null;
}

async function onStart() {
  const error = validate();
  if (error) { alert(error); return; }

  const run = await getRun();
  if (run?.active) { alert('Ya hay un proceso en curso.'); return; }

  const payload = { source: ui.source, from: ui.from, to: ui.to };
  if (ui.source === SOURCE.CSV) payload.text = ui.csvText;

  try {
    const res = await chrome.runtime.sendMessage({ type: MESSAGES.START, payload });
    if (!res?.ok) { alert(res?.reason || 'No se pudo iniciar el proceso.'); return; }
    log.info('informe iniciado', { source: ui.source, from: ui.from, to: ui.to });
  } catch (err) {
    alert(`No se pudo iniciar: ${String(err?.message || err)}`);
  }
}

async function onCancel() {
  try { await chrome.runtime.sendMessage({ type: MESSAGES.CANCEL }); } catch { /* sigue */ }
  // Fallback: marca el run cancelado por si el SW ya no estuviera procesando.
  await updateRun((run) => (run?.active
    ? { ...run, active: false, finishedAt: Date.now(), finishReason: FINISH_REASON.CANCELLED }
    : run)).catch(() => {});
  log.info('cancelacion pedida desde popup');
}

async function onClear(container) {
  await clearRun();
  await clearResult();
  renderRun(container, null);
}

// -----------------------------------------------------------------------------
// Render del estado de la corrida
// -----------------------------------------------------------------------------

function renderRun(container, run) {
  const progress = container.querySelector('#epr-progress');
  const startBtn = container.querySelector('#epr-start');
  const cancelBtn = container.querySelector('#epr-cancel');
  const clearBtn = container.querySelector('#epr-clear');
  if (!progress) return;

  const active = Boolean(run?.active);
  const finished = Boolean(run && !run.active);

  // Bloqueo de controles del formulario mientras corre.
  container.querySelectorAll('.lt-form-card input, .lt-form-card button.scf-mode-btn')
    .forEach((el) => { el.disabled = active; });
  if (startBtn) startBtn.disabled = active;
  if (cancelBtn) cancelBtn.disabled = !active;
  if (clearBtn) clearBtn.classList.toggle('hidden', !finished);

  if (!run) { progress.classList.add('hidden'); return; }
  progress.classList.remove('hidden');

  // Titulo + fase.
  const titleEl = container.querySelector('#epr-progress-title');
  const phaseEl = container.querySelector('#epr-progress-phase');
  if (active) {
    titleEl.innerHTML = '<span class="ct-spinner ct-spinner--inline"></span> Procesando…';
  } else if (run.finishReason === FINISH_REASON.CANCELLED) {
    titleEl.textContent = 'Cancelado';
  } else if (run.finishReason === FINISH_REASON.ERROR) {
    titleEl.textContent = 'Finalizado con error';
  } else {
    titleEl.textContent = 'Listo';
  }
  phaseEl.textContent = active ? (PHASE_LABEL[run.phase] || '') : '';

  // Barra: indeterminada mientras corre, completa al terminar OK.
  const bar = container.querySelector('#epr-progress-bar span');
  if (bar) {
    if (active) {
      bar.style.width = `${phasePct(run.phase)}%`;
    } else if (run.finishReason === FINISH_REASON.DONE) {
      bar.style.width = '100%';
    } else {
      bar.style.width = '0%';
    }
  }

  renderResult(container, run);
  renderStats(container, run.stats);
  renderLog(container, run.log);
}

function phasePct(phase) {
  const order = [PHASE.DOWNLOADING, PHASE.PARSING, PHASE.FILTERING, PHASE.DEDUPING, PHASE.BUILDING, PHASE.SAVING];
  const i = order.indexOf(phase);
  return i < 0 ? 5 : Math.round(((i + 1) / (order.length + 1)) * 100);
}

function renderResult(container, run) {
  const box = container.querySelector('#epr-result');
  if (!box) return;

  if (run.finishReason === FINISH_REASON.ERROR) {
    box.classList.remove('hidden');
    box.innerHTML = `<p class="oi-alert oi-alert--error">${escapeHtml(run.errorReason || 'Error desconocido.')}</p>`;
    return;
  }
  if (run.finishReason === FINISH_REASON.DONE && !run.result) {
    box.classList.remove('hidden');
    box.innerHTML = `<p class="oi-alert oi-alert--warning">No quedaron filas tras los filtros. No se genero archivo.</p>`;
    return;
  }
  if (run.finishReason === FINISH_REASON.DONE && run.result?.ready) {
    box.classList.remove('hidden');
    box.innerHTML = `
      <p class="oi-alert oi-alert--success">
        Archivo generado y descargado: <strong>${escapeHtml(run.result.filename)}</strong>
        — ${run.result.rows} fila(s), ${formatBytes(run.result.bytes)}.
      </p>
      <button type="button" id="epr-redownload" class="ct-btn ct-btn--primary">Descargar de nuevo</button>
    `;
    box.querySelector('#epr-redownload')?.addEventListener('click', onRedownload);
    return;
  }
  box.classList.add('hidden');
  box.innerHTML = '';
}

async function onRedownload() {
  const result = await getResult();
  if (!result?.csv) { alert('El archivo ya no esta disponible. Vuelve a generarlo.'); return; }
  downloadText(result.csv, result.filename);
}

function renderStats(container, stats) {
  const box = container.querySelector('#epr-stats');
  if (!box) return;
  if (!stats) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');

  const byStatus = stats.byStatus || {};
  const statusRows = Object.keys(byStatus)
    .sort((a, b) => byStatus[b] - byStatus[a])
    .map((s) => `<li><span>${escapeHtml(s)}</span><strong>${byStatus[s]}</strong></li>`)
    .join('');

  box.innerHTML = `
    <ul class="epr-stat-grid">
      <li><span>Filas leidas</span><strong>${stats.totalRows}</strong></li>
      <li><span>En rango de fechas</span><strong>${stats.afterDate}</strong></li>
      <li><span>Estados a recuperar</span><strong>${stats.afterStatus}</strong></li>
      <li><span>Con Warehouse N2U</span><strong>${stats.afterWarehouse ?? 0}</strong></li>
      <li><span>Nombres duplic. quitados</span><strong>${stats.removedDuplicateNames ?? 0}</strong></li>
      <li><span>Ya compraron (excluidos)</span><strong>${stats.removedBoughtLater ?? 0}</strong></li>
      <li><span>Emails duplic. quitados</span><strong>${stats.removedDuplicateEmails ?? 0}</strong></li>
      <li class="epr-stat-final"><span>Filas finales</span><strong>${stats.finalRows}</strong></li>
    </ul>
    ${statusRows ? `<details class="ct-diag epr-bystatus"><summary>Desglose por estado</summary><ul class="epr-stat-grid">${statusRows}</ul></details>` : ''}
  `;
}

function renderLog(container, logEntries) {
  const logEl = container.querySelector('#epr-log');
  if (!logEl) return;
  logEl.innerHTML = '';
  const entries = Array.isArray(logEntries) ? logEntries.slice(-50).reverse() : [];
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
