import { FEATURE_ID, PORTS, PORT_MSG, STATUS, STEPS, DELIVERY_DEFAULTS } from '../../constants.js';
import { getStorage, setStorage } from '../../../../shared/storage/storage.js';
import { logger } from '../../../../shared/utils/logger.js';
import { escapeHtml } from '../utils.js';

const log = logger('colocar-tags/delivery');
const STORAGE_KEY = `${FEATURE_ID}:delivery:last-config`;

const STEP_LABELS = {
  [STEPS.SEARCH_TYPE]:        'Tipeando SKU',
  [STEPS.SEARCH_CLICK]:       'Click en Search',
  [STEPS.SEARCH_WAIT_ROW]:    'Esperando fila exacta',
  [STEPS.SEARCH_CLICK_EDIT]:  'Abriendo Edit',
  [STEPS.MODAL_WAIT_OPEN]:    'Esperando modal',
  [STEPS.DELIV_CHECK_ROW]:    'Marcando fila Delivery',
  [STEPS.DELIV_SELECT_TAG]:   'Seleccionando tag',
  [STEPS.DELIV_CHECK_USE]:    'Marcando Use',
  [STEPS.DELIV_USER_TYPE]:    'Setteando User Type',
  [STEPS.DELIV_DATES]:        'Setteando fechas',
  [STEPS.DELIV_SAVE_STG]:     'Guardando STG',
  [STEPS.DELIV_CONFIRM_STG]:  'Confirmando STG',
  [STEPS.DELIV_ACK_STG]:      'OK STG',
  [STEPS.DELIV_SAVE_PROD]:    'Guardando PROD',
  [STEPS.DELIV_CONFIRM_PROD]: 'Confirmando PROD',
  [STEPS.DELIV_ACK_PROD]:     'OK PROD',
  [STEPS.DONE]:               'Listo',
  'not-found':                'Sin resultados',
  'cancelled':                'Cancelado',
  'error':                    'Error',
  'empty':                    'SKU vacío',
};

let activePort = null;
let skuStates  = new Map();

export async function render(container) {
  const cfg = (await getStorage(STORAGE_KEY)) || {};
  const defaults = {
    tagLabel:  cfg.tagLabel  ?? DELIVERY_DEFAULTS.tagLabel,
    beginDay:  cfg.beginDay  ?? '',
    beginTime: cfg.beginTime ?? '00:00',
    endDay:    cfg.endDay    ?? '',
    endTime:   cfg.endTime   ?? '23:30',
    skipProd:  cfg.skipProd  ?? DELIVERY_DEFAULTS.skipProd,
  };

  container.innerHTML = `
    <form id="dt-form" class="dt-form" autocomplete="off">
      <label class="dt-field">
        <span class="dt-label">SKUs (uno por línea, "Sales Model" exacto)</span>
        <textarea id="dt-skus" rows="4" class="dt-input dt-textarea" placeholder="OLED65B5PSA.AWH&#10;OLED55C5PSA.AWH"></textarea>
      </label>

      <label class="dt-field">
        <span class="dt-label">Delivery Tag</span>
        <input id="dt-tag" type="text" class="dt-input" value="${escapeHtml(defaults.tagLabel)}" />
      </label>

      <div class="dt-row">
        <label class="dt-field dt-field--half">
          <span class="dt-label">Inicio</span>
          <div class="dt-datetime">
            <input id="dt-begin-day"  type="date" class="dt-input" value="${escapeHtml(defaults.beginDay)}" />
            <input id="dt-begin-time" type="time" class="dt-input" value="${escapeHtml(defaults.beginTime)}" step="1800" />
          </div>
        </label>
        <label class="dt-field dt-field--half">
          <span class="dt-label">Fin</span>
          <div class="dt-datetime">
            <input id="dt-end-day"  type="date" class="dt-input" value="${escapeHtml(defaults.endDay)}" />
            <input id="dt-end-time" type="time" class="dt-input" value="${escapeHtml(defaults.endTime)}" step="1800" />
          </div>
        </label>
      </div>

      <label class="dt-check">
        <input id="dt-skip-prod" type="checkbox" ${defaults.skipProd ? 'checked' : ''} />
        <span>Sólo STG (no enviar a PROD)</span>
      </label>

      <div class="dt-actions">
        <button id="dt-run"    type="submit" class="ct-btn ct-btn--primary">Aplicar</button>
        <button id="dt-cancel" type="button" class="ct-btn ct-btn--ghost" disabled>Cancelar</button>
      </div>
    </form>

    <div id="dt-progress" class="dt-progress hidden">
      <div class="dt-progress-head">
        <strong id="dt-progress-title">Procesando…</strong>
        <span id="dt-progress-counter" class="dt-progress-counter"></span>
      </div>
      <ul id="dt-progress-list" class="dt-progress-list"></ul>
    </div>
  `;

  container.querySelector('#dt-form').addEventListener('submit', (e) => {
    e.preventDefault();
    onRun(container);
  });
  container.querySelector('#dt-cancel').addEventListener('click', onCancel);

  // Por si quedó un run colgado de una apertura previa del popup.
  resetProgress(container);
}

async function onRun(container) {
  const skusRaw = container.querySelector('#dt-skus').value;
  const skus = parseSkus(skusRaw);
  const tagLabel  = container.querySelector('#dt-tag').value.trim();
  const beginDay  = container.querySelector('#dt-begin-day').value;
  const beginTime = container.querySelector('#dt-begin-time').value;
  const endDay    = container.querySelector('#dt-end-day').value;
  const endTime   = container.querySelector('#dt-end-time').value;
  const skipProd  = container.querySelector('#dt-skip-prod').checked;

  if (skus.length === 0) return alert('Ingresá al menos un SKU.');
  if (!tagLabel) return alert('Especificá el Delivery Tag.');
  if (!beginDay || !endDay) return alert('Completá fecha de inicio y fin.');
  if (!beginTime || !endTime) return alert('Completá hora de inicio y fin.');

  await setStorage(STORAGE_KEY, { tagLabel, beginDay, beginTime, endDay, endTime, skipProd });

  const config = {
    skus,
    tagLabel,
    beginDay,
    beginTime: normalizeTime(beginTime),
    endDay,
    endTime:   normalizeTime(endTime),
    skipProd,
  };

  await startRun(container, config);
}

function parseSkus(raw) {
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

function normalizeTime(t) {
  // input type=time puede devolver "HH:MM" o "HH:MM:SS". Forzamos HH:MM.
  return t.slice(0, 5);
}

async function startRun(container, config) {
  toggleRunning(container, true);
  prepareProgress(container, config.skus);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    alert('No hay pestaña activa.');
    toggleRunning(container, false);
    return;
  }

  const port = chrome.tabs.connect(tab.id, { name: PORTS.DELIVERY_RUN });
  activePort = port;

  port.onMessage.addListener((msg) => onPortMessage(container, msg));
  port.onDisconnect.addListener(() => {
    log.info('port desconectado');
    activePort = null;
    toggleRunning(container, false);
  });

  port.postMessage({ type: PORT_MSG.START, config });
}

function onCancel() {
  if (!activePort) return;
  log.info('cancel solicitado');
  try { activePort.postMessage({ type: PORT_MSG.CANCEL }); } catch { /* ya cerrado */ }
  try { activePort.disconnect(); } catch { /* ya cerrado */ }
  activePort = null;
}

function onPortMessage(container, msg) {
  log.debug('progress', msg);
  switch (msg?.type) {
    case PORT_MSG.PROGRESS:
      updateSkuState(container, msg);
      break;
    case PORT_MSG.DONE:
      setProgressTitle(container, 'Finalizado');
      toggleRunning(container, false);
      break;
    case PORT_MSG.CANCELLED:
      setProgressTitle(container, 'Cancelado');
      toggleRunning(container, false);
      break;
    case PORT_MSG.ERROR:
      setProgressTitle(container, `Error: ${msg.reason}`);
      toggleRunning(container, false);
      break;
    default:
      break;
  }
}

function toggleRunning(container, running) {
  container.querySelector('#dt-run').disabled = running;
  container.querySelector('#dt-cancel').disabled = !running;
}

function prepareProgress(container, skus) {
  skuStates = new Map(skus.map((sku, i) => [`${i}::${sku}`, { sku, status: STATUS.PENDING, step: null }]));
  const list = container.querySelector('#dt-progress-list');
  list.innerHTML = '';
  for (const [key, st] of skuStates) {
    const li = document.createElement('li');
    li.className = 'dt-progress-item dt-progress-item--pending';
    li.dataset.key = key;
    li.innerHTML = renderItemBody(st);
    list.appendChild(li);
  }
  container.querySelector('#dt-progress').classList.remove('hidden');
  container.querySelector('#dt-progress-counter').textContent = `0 / ${skus.length}`;
  setProgressTitle(container, 'Procesando…');
}

function resetProgress(container) {
  container.querySelector('#dt-progress')?.classList.add('hidden');
  container.querySelector('#dt-progress-list').innerHTML = '';
  toggleRunning(container, false);
}

function setProgressTitle(container, text) {
  const el = container.querySelector('#dt-progress-title');
  if (el) el.textContent = text;
}

function updateSkuState(container, msg) {
  const key = `${msg.index}::${msg.sku}`;
  const prev = skuStates.get(key) || { sku: msg.sku };
  const next = { ...prev, status: msg.status, step: msg.step, detail: msg.detail, reason: msg.reason };
  skuStates.set(key, next);

  const li = container.querySelector(`[data-key="${cssEscape(key)}"]`);
  if (li) {
    li.className = `dt-progress-item dt-progress-item--${next.status}`;
    li.innerHTML = renderItemBody(next);
  }

  // Counter: contar ok+skipped+error vs total
  const total = skuStates.size;
  let done = 0;
  for (const st of skuStates.values()) {
    if ([STATUS.OK, STATUS.ERROR, STATUS.SKIPPED].includes(st.status)) done++;
  }
  container.querySelector('#dt-progress-counter').textContent = `${done} / ${total}`;
}

function renderItemBody(st) {
  const stepLabel = STEP_LABELS[st.step] || st.step || '';
  const icon = iconFor(st.status);
  const reason = st.reason ? `<span class="dt-item-reason">${escapeHtml(st.reason)}</span>` : '';
  return `
    <span class="dt-item-icon">${icon}</span>
    <span class="dt-item-sku">${escapeHtml(st.sku)}</span>
    <span class="dt-item-step">${escapeHtml(stepLabel)}</span>
    ${reason}
  `;
}

function iconFor(status) {
  switch (status) {
    case STATUS.OK:      return '✓';
    case STATUS.ERROR:   return '✗';
    case STATUS.RUNNING: return '◐';
    case STATUS.SKIPPED: return '⊝';
    default:             return '·';
  }
}

function cssEscape(s) {
  return s.replace(/"/g, '\\"');
}
