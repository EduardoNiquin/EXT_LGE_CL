import { toMessage } from '../../../../shared/errors/index.js';
import { getActiveTab } from '../../../../shared/messaging/messaging.js';
import { logger } from '../../../../shared/utils/logger.js';
import {
  ADMIN_BASE_RE,
  DEFAULT_ADMIN_BASE,
  DEFAULT_RANGE_DAYS,
  FINISH_REASON,
  GATEWAY,
  GATEWAY_LABEL,
  LISTING_URL_RE,
  MAX_RANGE_DAYS,
  ORDERS_LISTING_PATH,
  ORDER_STATUS,
  RUN_PHASE,
  SEARCH_FIELDS,
} from '../constants.js';
import { buildMatrix, matrixToCsv } from '../csv.js';
import { buildCriteria, describeCriteria } from '../match.js';
import {
  clearRun, getDraft, getRun, makeRun, setDraft, setRun, subscribeToRun, updateRun,
} from '../state.js';
import { downloadText, escapeHtml, formatTime } from '../../popup/utils.js';

const log = logger('magento/popup');
const PREVIEW_ROWS = 150;

let unsubscribeRun = null;
let onlyMatches = true;

export async function render(container) {
  if (unsubscribeRun) unsubscribeRun();
  const [run, draft] = await Promise.all([getRun(), getDraft()]);
  const config = { ...defaultConfig(), ...(draft || {}) };

  container.innerHTML = `
    <div class="lt-view bo-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Buscar orden</h3>
        <p class="lt-hint">Revisa una por una las ordenes del rango y lee sus notas de transaccion (WebPay y MercadoPago) hasta encontrar las que traen el dato buscado.</p>
        <div class="mg-notice">
          <strong>Antes de iniciar</strong>
          <span>Deja la pestana en el listado de ordenes de Magento con la sesion iniciada. El proceso navega solo entre el listado y cada orden, y sigue aunque cierres este panel.</span>
        </div>

        <div class="dt-row">
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="bo-from">Desde</label>
            <input type="date" id="bo-from" class="dt-input" value="${escapeHtml(config.from)}">
          </div>
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="bo-to">Hasta</label>
            <input type="date" id="bo-to" class="dt-input" value="${escapeHtml(config.to)}">
          </div>
        </div>
        <p class="lt-hint" id="bo-range-hint"></p>

        <div class="bo-gateways">
          ${gatewayBlock(GATEWAY.WEBPAY, config)}
          ${gatewayBlock(GATEWAY.MERCADOPAGO, config)}
        </div>

        <div class="dt-row">
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="bo-max">Maximo de ordenes (0 = todas)</label>
            <input type="number" id="bo-max" class="dt-input" min="0" step="1" value="${escapeHtml(String(config.maxOrders ?? 0))}">
          </div>
          <div class="dt-field dt-field--half">
            <label class="dt-check" style="margin-top:18px">
              <input type="checkbox" id="bo-stop-first" ${config.stopOnFirstMatch ? 'checked' : ''}>
              <span>Detener en la 1a coincidencia</span>
            </label>
          </div>
        </div>

        <div class="lt-actions">
          <button type="button" id="bo-start" class="ct-btn ct-btn--primary">Iniciar busqueda</button>
          <button type="button" id="bo-stop" class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="bo-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      <section id="bo-progress" class="lt-progress hidden">
        <div class="lt-progress-head">
          <strong id="bo-progress-title">Preparando...</strong>
          <span id="bo-progress-counter" class="dt-progress-counter"></span>
        </div>
        <div id="bo-progress-bar" class="lt-progress-bar"><span></span></div>
        <p id="bo-progress-detail" class="lt-hint"></p>
        <p id="bo-criteria" class="lt-hint bo-criteria"></p>

        <div class="bo-results-head">
          <label class="dt-check">
            <input type="checkbox" id="bo-only-matches" checked>
            <span>Solo coincidencias</span>
          </label>
          <div class="bo-results-actions">
            <button type="button" id="bo-copy" class="ct-btn ct-btn--ghost">Copiar CSV</button>
            <button type="button" id="bo-export" class="ct-btn ct-btn--primary">Descargar CSV</button>
          </div>
        </div>
        <div id="bo-table-wrap" class="bo-table-wrap"><p class="ct-empty">Sin datos todavia.</p></div>

        <details class="ct-diag lt-log-details">
          <summary>Registro</summary>
          <ul id="bo-log" class="lt-log"></ul>
        </details>
      </section>
    </div>`;

  // `onlyMatches` vive fuera del render: si el usuario lo apago y volvio al
  // menu, el checkbox recien pintado tiene que reflejar eso, no el default.
  container.querySelector('#bo-only-matches').checked = onlyMatches;
  wireForm(container);
  container.querySelector('#bo-start').addEventListener('click', () => onStart(container));
  container.querySelector('#bo-stop').addEventListener('click', onStop);
  container.querySelector('#bo-clear').addEventListener('click', () => onClear(container));
  container.querySelector('#bo-export').addEventListener('click', onExport);
  container.querySelector('#bo-copy').addEventListener('click', (event) => onCopy(event.currentTarget));
  container.querySelector('#bo-only-matches').addEventListener('change', (event) => {
    onlyMatches = event.currentTarget.checked;
    getRun().then((current) => { if (current) renderResults(container, current); });
  });

  updateRangeHint(container);
  if (run) renderProgress(container, run);
  toggleButtons(container, run);

  unsubscribeRun = subscribeToRun((newRun) => {
    // El popup no llama a un unmount: si el usuario volvio al menu, este
    // contenedor ya no esta en el documento y seguir pintandolo revienta.
    if (!container.isConnected) {
      unsubscribeRun?.();
      unsubscribeRun = null;
      return;
    }
    if (newRun) renderProgress(container, newRun);
    else container.querySelector('#bo-progress')?.classList.add('hidden');
    toggleButtons(container, newRun);
  });
}

// -----------------------------------------------------------------------------
// formulario
// -----------------------------------------------------------------------------

function gatewayBlock(gateway, config) {
  const enabled = (config.gateways || []).includes(gateway);
  const values = config.fields?.[gateway] || {};
  return `
    <div class="bo-gateway" data-gateway="${gateway}">
      <label class="dt-check bo-gateway-toggle">
        <input type="checkbox" data-gateway-toggle="${gateway}" ${enabled ? 'checked' : ''}>
        <span>${escapeHtml(GATEWAY_LABEL[gateway])}</span>
      </label>
      <div class="bo-gateway-fields ${enabled ? '' : 'hidden'}" data-gateway-fields="${gateway}">
        ${SEARCH_FIELDS[gateway].map((field) => `
          <div class="dt-field">
            <label class="dt-label" for="bo-${gateway}-${field.key}">${escapeHtml(field.label)}</label>
            <input type="text" class="dt-input" id="bo-${gateway}-${field.key}"
                   data-field-gateway="${gateway}" data-field-key="${field.key}"
                   placeholder="${escapeHtml(field.placeholder || '')}"
                   value="${escapeHtml(values[field.key] || '')}">
          </div>`).join('')}
        <p class="lt-hint">Los campos vacios no se filtran. Sin ningun campo, se toman todas las transacciones de esta pasarela.</p>
      </div>
    </div>`;
}

function wireForm(container) {
  container.querySelectorAll('[data-gateway-toggle]').forEach((toggle) => {
    toggle.addEventListener('change', () => {
      const gateway = toggle.dataset.gatewayToggle;
      container.querySelector(`[data-gateway-fields="${gateway}"]`)?.classList.toggle('hidden', !toggle.checked);
      persistDraft(container);
    });
  });
  container.querySelectorAll('#bo-from, #bo-to').forEach((input) => {
    input.addEventListener('change', () => {
      updateRangeHint(container);
      persistDraft(container);
    });
  });
  container.querySelectorAll('[data-field-key], #bo-max, #bo-stop-first').forEach((input) => {
    input.addEventListener('change', () => persistDraft(container));
  });
}

function readConfig(container) {
  const gateways = Array.from(container.querySelectorAll('[data-gateway-toggle]'))
    .filter((toggle) => toggle.checked)
    .map((toggle) => toggle.dataset.gatewayToggle);

  const fields = {};
  container.querySelectorAll('[data-field-key]').forEach((input) => {
    const gateway = input.dataset.fieldGateway;
    fields[gateway] = fields[gateway] || {};
    fields[gateway][input.dataset.fieldKey] = input.value.trim();
  });

  return {
    from: container.querySelector('#bo-from').value,
    to: container.querySelector('#bo-to').value,
    gateways,
    fields,
    maxOrders: Math.max(0, Number(container.querySelector('#bo-max').value) || 0),
    stopOnFirstMatch: container.querySelector('#bo-stop-first').checked,
  };
}

function persistDraft(container) {
  setDraft(readConfig(container)).catch((err) => log.warn('no se pudo guardar el borrador', err));
}

function defaultConfig() {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - DEFAULT_RANGE_DAYS);
  return {
    from: isoDate(from),
    to: isoDate(today),
    gateways: [GATEWAY.WEBPAY],
    fields: {},
    maxOrders: 0,
    stopOnFirstMatch: false,
  };
}

function isoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Dias entre dos fechas ISO, ambos extremos incluidos. */
export function rangeDays(from, to) {
  const start = Date.parse(`${from}T00:00:00`);
  const end = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end)) return NaN;
  return Math.round((end - start) / 86400000);
}

function updateRangeHint(container) {
  const hint = container.querySelector('#bo-range-hint');
  const { from, to } = readConfig(container);
  const days = rangeDays(from, to);
  if (Number.isNaN(days)) {
    hint.textContent = 'Indica el rango de fechas de compra.';
    hint.classList.remove('bo-hint--error');
    return;
  }
  if (days < 0) {
    hint.textContent = 'La fecha "Desde" tiene que ser anterior a "Hasta".';
    hint.classList.add('bo-hint--error');
    return;
  }
  if (days > MAX_RANGE_DAYS) {
    hint.textContent = `El rango es de ${days} dias. Magento falla sobre ${MAX_RANGE_DAYS}: acorta el rango.`;
    hint.classList.add('bo-hint--error');
    return;
  }
  hint.textContent = `Rango de ${days + 1} dia(s). Maximo permitido por Magento: ${MAX_RANGE_DAYS} dias.`;
  hint.classList.remove('bo-hint--error');
}

// -----------------------------------------------------------------------------
// acciones
// -----------------------------------------------------------------------------

async function onStart(container) {
  const previous = await getRun();
  if (previous?.active) return;

  const config = readConfig(container);
  const days = rangeDays(config.from, config.to);
  if (Number.isNaN(days)) { alert('Indica el rango de fechas de compra.'); return; }
  if (days < 0) { alert('La fecha "Desde" tiene que ser anterior a "Hasta".'); return; }
  if (days > MAX_RANGE_DAYS) {
    alert(`El rango es de ${days} dias y Magento falla sobre ${MAX_RANGE_DAYS}. Acorta el rango.`);
    return;
  }
  if (!buildCriteria(config).length
    && !confirm('No indicaste ningun dato a buscar: se van a capturar TODAS las transacciones del rango. Continuar?')) {
    return;
  }

  let tab = null;
  try {
    tab = await getActiveTab();
  } catch (err) {
    log.warn('no hay pestana activa', err);
  }

  // Lo normal es que el usuario ya este en el listado: en ese caso no se toca la
  // pestana (navegarla perderia los filtros que ya tenga puestos).
  const onListing = LISTING_URL_RE.test(tab?.url || '') && !/\/sales\/order\/view\//i.test(tab?.url || '');
  const listingUrl = onListing ? tab.url : `${deriveAdminBase(tab?.url)}${ORDERS_LISTING_PATH}`;
  if (!onListing && !confirm(`La pestana activa no es el listado de ordenes. Se va a navegar a:\n\n${listingUrl}\n\nContinuar?`)) {
    return;
  }

  await setDraft(config);
  const run = makeRun({ config, listingUrl });
  await setRun(run);
  renderProgress(container, run);
  toggleButtons(container, run);

  if (onListing) return;
  try {
    if (!tab?.id) throw new Error('No hay pestana activa para abrir el listado de ordenes.');
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
    log.error('no se pudo abrir el listado de ordenes', err);
  }
}

function deriveAdminBase(url) {
  return url?.match(ADMIN_BASE_RE)?.[1] || DEFAULT_ADMIN_BASE;
}

async function onStop() {
  if (!confirm('Detener la busqueda? Los datos capturados hasta ahora se conservan.')) return;
  await updateRun((run) => ({
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: FINISH_REASON.CANCELLED,
  }));
}

async function onClear(container) {
  const run = await getRun();
  if (run?.active && !confirm('Hay una busqueda activa. Detenerla y borrar los datos capturados?')) return;
  await clearRun();
  container.querySelector('#bo-progress')?.classList.add('hidden');
  toggleButtons(container, null);
}

async function onExport() {
  const run = await getRun();
  if (!run) return;
  const matrix = buildMatrix(run, { onlyMatches });
  if (!matrix.rows.length) { alert('Todavia no hay datos para exportar.'); return; }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const suffix = onlyMatches ? 'coincidencias' : 'todas';
  downloadText(matrixToCsv(matrix), `magento-buscar-orden-${suffix}-${stamp}.csv`);
}

async function onCopy(button) {
  const run = await getRun();
  if (!run) return;
  const matrix = buildMatrix(run, { onlyMatches });
  if (!matrix.rows.length) return;
  const text = matrixToCsv(matrix);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } finally { area.remove(); }
  }
  const original = button.textContent;
  button.textContent = 'Copiado';
  setTimeout(() => { button.textContent = original; }, 1200);
}

// -----------------------------------------------------------------------------
// render
// -----------------------------------------------------------------------------

function renderProgress(container, run) {
  const wrap = container.querySelector('#bo-progress');
  if (!wrap) return;
  wrap.classList.remove('hidden');

  const stats = computeStats(run);
  container.querySelector('#bo-progress-title').textContent = progressTitle(run);
  container.querySelector('#bo-progress-counter').textContent = stats.total
    ? `${stats.done} / ${stats.total}`
    : 'Leyendo listado';
  container.querySelector('#bo-progress-bar span').style.width =
    `${stats.total ? Math.round((stats.done / stats.total) * 100) : 0}%`;

  const detail = container.querySelector('#bo-progress-detail');
  if (run.error) detail.textContent = run.error;
  else if (run.active && run.phase === RUN_PHASE.FILTERING) detail.textContent = 'Aplicando el rango de fechas y el Purchase Point...';
  else if (run.active && run.phase === RUN_PHASE.DISCOVERING) detail.textContent = 'Recorriendo el listado completo para armar la cola...';
  else if (run.active) detail.textContent = `${stats.matches} coincidencia(s). Quedan ${Math.max(0, stats.total - stats.done)} orden(es).`;
  else detail.textContent = `${stats.matches} coincidencia(s) en ${stats.done} orden(es) revisada(s)${stats.errors ? `, ${stats.errors} con error` : ''}.`;

  container.querySelector('#bo-criteria').textContent = describeCriteria(buildCriteria(run.config));
  renderResults(container, run);
  renderLog(container.querySelector('#bo-log'), run.log || []);
}

function renderResults(container, run) {
  const host = container.querySelector('#bo-table-wrap');
  if (!host) return;
  const { headers, rows } = buildMatrix(run, { onlyMatches });

  if (!rows.length) {
    host.innerHTML = `<p class="ct-empty">${onlyMatches ? 'Todavia no hay coincidencias.' : 'Todavia no hay datos capturados.'}</p>`;
    return;
  }

  const shown = rows.slice(0, PREVIEW_ROWS);
  host.innerHTML = `
    <table class="bo-table">
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>${shown.map((row) => `<tr>${row.map((cell) => `<td title="${escapeHtml(cell)}">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    ${rows.length > shown.length
      ? `<p class="lt-hint">Se muestran ${shown.length} de ${rows.length} filas. El CSV las trae todas.</p>`
      : `<p class="lt-hint">${rows.length} fila(s).</p>`}`;
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
  const start = container.querySelector('#bo-start');
  const stop = container.querySelector('#bo-stop');
  const clear = container.querySelector('#bo-clear');
  if (!start || !stop || !clear) return;
  start.disabled = active;
  stop.disabled = !active;
  clear.classList.toggle('hidden', !finished);
}

export function computeStats(run) {
  const items = run?.items || [];
  const ok = items.filter((item) => item.status === ORDER_STATUS.OK).length;
  const errors = items.filter((item) => item.status === ORDER_STATUS.ERROR).length;
  const matches = items.filter((item) => item.matched).length;
  return { total: items.length, done: ok + errors, ok, errors, matches };
}

function progressTitle(run) {
  if (run.active && run.phase === RUN_PHASE.FILTERING) return 'Aplicando filtros...';
  if (run.active && run.phase === RUN_PHASE.DISCOVERING) return 'Leyendo el listado...';
  if (run.active) return 'Revisando ordenes...';
  if (run.finishReason === FINISH_REASON.CANCELLED) return 'Busqueda detenida';
  if (run.finishReason === FINISH_REASON.ERROR) return 'Busqueda con error';
  if (run.finishReason === FINISH_REASON.FIRST_MATCH) return 'Coincidencia encontrada';
  if (run.finishReason === FINISH_REASON.LIMIT) return 'Limite de ordenes alcanzado';
  return 'Busqueda terminada';
}
