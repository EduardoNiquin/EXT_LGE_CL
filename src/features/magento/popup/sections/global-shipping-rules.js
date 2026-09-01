import { toMessage } from '../../../../shared/errors/index.js';
import { getActiveTab } from '../../../../shared/messaging/messaging.js';
import { logger } from '../../../../shared/utils/logger.js';
import {
  ADMIN_BASE_RE,
  DEFAULT_ADMIN_BASE,
  FINISH_REASON,
  LISTING_PATH,
  RULE_STATUS,
  RUN_PHASE,
} from '../../constants.js';
import { buildShippingRulesCsv } from '../../csv.js';
import { clearRun, getRun, makeRun, setRun, subscribeToRun, updateRun } from '../../state.js';
import { downloadText, escapeHtml, formatTime } from '../utils.js';

const log = logger('magento/popup');
let unsubscribeRun = null;

export async function render(container) {
  if (unsubscribeRun) unsubscribeRun();
  const run = await getRun();

  container.innerHTML = `
    <div class="lt-view mg-gsr-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Global Shipping Rules</h3>
        <p class="lt-hint">Captura todas las rules, sus campos y las tarifas por region o comuna. La pestana navegara automaticamente entre el listado y cada detalle.</p>
        <div class="mg-notice">
          <strong>Antes de iniciar</strong>
          <span>Inicia sesion en Magento. El proceso abrira el listado oficial y continuara aunque cierres este panel.</span>
        </div>
        <div class="lt-actions">
          <button type="button" id="mg-start" class="ct-btn ct-btn--primary">Iniciar captura</button>
          <button type="button" id="mg-stop" class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="mg-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      <section id="mg-progress" class="lt-progress hidden">
        <div class="lt-progress-head">
          <strong id="mg-progress-title">Preparando...</strong>
          <span id="mg-progress-counter" class="dt-progress-counter"></span>
        </div>
        <div id="mg-progress-bar" class="lt-progress-bar"><span></span></div>
        <p id="mg-progress-detail" class="lt-hint"></p>
        <p id="mg-progress-metrics" class="lt-hint"></p>
        <ul id="mg-rule-list" class="lt-region-list"></ul>
        <button type="button" id="mg-export" class="ct-btn ct-btn--primary hidden">Exportar CSV</button>
        <details class="ct-diag lt-log-details">
          <summary>Registro</summary>
          <ul id="mg-log" class="lt-log"></ul>
        </details>
      </section>
    </div>`;

  container.querySelector('#mg-start').addEventListener('click', () => onStart(container));
  container.querySelector('#mg-stop').addEventListener('click', onStop);
  container.querySelector('#mg-clear').addEventListener('click', () => onClear(container));
  container.querySelector('#mg-export').addEventListener('click', onExport);

  if (run) renderProgress(container, run);
  toggleButtons(container, run);
  unsubscribeRun = subscribeToRun((newRun) => {
    // El popup no llama a un unmount: si el usuario volvio al menu, este
    // contenedor ya no esta en el documento y seguir pintandolo revienta al
    // buscar botones que ya no existen.
    if (!container.isConnected) {
      unsubscribeRun?.();
      unsubscribeRun = null;
      return;
    }
    if (newRun) renderProgress(container, newRun);
    else container.querySelector('#mg-progress')?.classList.add('hidden');
    toggleButtons(container, newRun);
  });
}

async function onStart(container) {
  const previous = await getRun();
  if (previous?.active) return;

  let tab = null;
  try {
    tab = await getActiveTab();
  } catch (err) {
    log.warn('no hay pestana activa', err);
  }
  const listingUrl = `${deriveAdminBase(tab?.url)}${LISTING_PATH}`;
  if (!isMagentoAdmin(tab?.url)
    && !confirm(`La pestana activa no parece el admin de Magento y se va a navegar a:\n\n${listingUrl}\n\nContinuar?`)) {
    return;
  }

  const run = makeRun({ listingUrl });
  await setRun(run);
  renderProgress(container, run);
  toggleButtons(container, run);

  try {
    if (!tab?.id) throw new Error('No hay pestana activa para abrir Magento.');
    await chrome.tabs.update(tab.id, { url: listingUrl });
  } catch (err) {
    const message = toMessage(err);
    await updateRun((current) => ({
      ...current,
      active: false,
      finishedAt: Date.now(),
      finishReason: FINISH_REASON.ERROR,
      error: message,
    }));
    log.error('no se pudo abrir Magento', err);
  }
}

/** El admin puede colgar de otra base segun el ambiente (mismo criterio que orden-info). */
function deriveAdminBase(url) {
  return url?.match(ADMIN_BASE_RE)?.[1] || DEFAULT_ADMIN_BASE;
}

function isMagentoAdmin(url) {
  return /\/(obsadm|admin)\//i.test(url || '');
}

async function onStop() {
  if (!confirm('Detener la captura en curso?')) return;
  await updateRun((run) => ({
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: FINISH_REASON.CANCELLED,
  }));
}

async function onClear(container) {
  const run = await getRun();
  if (run?.active && !confirm('Hay una captura activa. Detenerla y limpiar los datos?')) return;
  await clearRun();
  container.querySelector('#mg-progress')?.classList.add('hidden');
  toggleButtons(container, null);
}

async function onExport() {
  const run = await getRun();
  if (!run?.items?.length) return;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadText(buildShippingRulesCsv(run), `magento-global-shipping-rules-${stamp}.csv`);
}

function renderProgress(container, run) {
  const wrap = container.querySelector('#mg-progress');
  if (!wrap) return;
  wrap.classList.remove('hidden');

  const stats = computeStats(run);
  container.querySelector('#mg-progress-title').textContent = progressTitle(run);
  container.querySelector('#mg-progress-counter').textContent = stats.total
    ? `${stats.done} / ${stats.total}`
    : 'Leyendo listado';
  container.querySelector('#mg-progress-bar span').style.width = `${stats.total ? Math.round((stats.done / stats.total) * 100) : 0}%`;

  const remaining = Math.max(0, stats.total - stats.done);
  const detail = container.querySelector('#mg-progress-detail');
  if (run.error) detail.textContent = run.error;
  else if (run.active && stats.total) detail.textContent = `${remaining} rules pendientes. ${stats.ok} capturadas y ${stats.errors} con error.`;
  else if (run.active) detail.textContent = 'Configurando 200 rules por pagina y leyendo el listado completo...';
  else detail.textContent = `${stats.ok} capturadas y ${stats.errors} con error.`;
  container.querySelector('#mg-progress-metrics').textContent = metricSummary(run);

  renderRuleList(container.querySelector('#mg-rule-list'), run);
  renderLog(container.querySelector('#mg-log'), run.log || []);
  container.querySelector('#mg-export').classList.toggle('hidden', run.active || !run.items?.length);
}

function renderRuleList(list, run) {
  list.innerHTML = '';
  (run.items || []).forEach((item, index) => {
    const row = document.createElement('li');
    row.className = `lt-region lt-region--${statusClass(item.status)}`;
    if (run.active && index === run.currentRuleIndex) row.classList.add('lt-region--current');
    const fees = item.detail?.regionalRows?.length;
    row.innerHTML = `
      <div class="lt-region-head">
        <span class="lt-region-name">${escapeHtml(item.nameFe || 'Sin nombre')}</span>
        <span class="lt-region-leadtimes">#${escapeHtml(item.id)}</span>
        <span class="lt-region-status">${statusLabel(item.status)}</span>
      </div>
      ${fees != null ? `<div class="lt-region-detail">${fees} tarifa(s) regional(es)</div>` : ''}
      ${item.error ? `<div class="lt-err">${escapeHtml(item.error)}</div>` : ''}`;
    list.appendChild(row);
  });
}

function renderLog(list, entries) {
  list.innerHTML = '';
  entries.slice(-60).reverse().forEach((entry) => {
    const row = document.createElement('li');
    row.className = `lt-log-item lt-log-item--${entry.level}`;
    row.innerHTML = `<span class="lt-log-time">${formatTime(entry.ts)}</span><span class="lt-log-msg">${escapeHtml(entry.message)}</span>`;
    list.appendChild(row);
  });
}

function toggleButtons(container, run) {
  const active = Boolean(run?.active);
  const finished = Boolean(run && !run.active);
  const start = container.querySelector('#mg-start');
  const stop = container.querySelector('#mg-stop');
  const clear = container.querySelector('#mg-clear');
  if (!start || !stop || !clear) return;
  start.disabled = active;
  stop.disabled = !active;
  clear.classList.toggle('hidden', !finished);
}

function computeStats(run) {
  const items = run.items || [];
  const ok = items.filter((item) => item.status === RULE_STATUS.OK).length;
  const errors = items.filter((item) => item.status === RULE_STATUS.ERROR).length;
  return { total: items.length, done: ok + errors, ok, errors };
}

function metricSummary(run) {
  const metrics = run.metrics || {};
  const startedAt = Number(run.startedAt) || Date.now();
  const finishedAt = Number(run.finishedAt) || Date.now();
  const parts = [
    `Tiempo total: ${formatDuration(Math.max(0, finishedAt - startedAt))}`,
    `Navegaciones: ${Number(metrics.navigationCount) || 0}`,
  ];
  if (metrics.discoveryMs) parts.push(`Listado: ${formatDuration(metrics.discoveryMs)}`);
  if (metrics.detailCount) {
    parts.push(`Promedio por rule: ${formatDuration(metrics.detailMs / metrics.detailCount)}`);
    parts.push(`Tarifas: ${formatDuration(metrics.regionalMs)}`);
  }
  return parts.join(' | ');
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
    : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function progressTitle(run) {
  if (run.active && run.phase === RUN_PHASE.DISCOVERING) return 'Leyendo listado...';
  if (run.active) return 'Capturando rules...';
  if (run.finishReason === FINISH_REASON.CANCELLED) return 'Captura detenida';
  if (run.finishReason === FINISH_REASON.ERROR) return 'Captura con error';
  return 'Captura terminada';
}

function statusClass(status) {
  if (status === RULE_STATUS.OK) return 'done';
  if (status === RULE_STATUS.ERROR) return 'error';
  if (status === RULE_STATUS.READING) return 'running';
  return 'pending';
}

function statusLabel(status) {
  if (status === RULE_STATUS.OK) return 'OK';
  if (status === RULE_STATUS.ERROR) return 'Error';
  if (status === RULE_STATUS.READING) return 'Leyendo';
  return 'Pendiente';
}

export const __test = { computeStats, formatDuration, metricSummary };
