// UI del sub-flujo "Quitar Tag de Delivery".
//
// Inverso a "Tag de Delivery": en vez de aplicar el tag, lo desactiva
// (desmarca Use + marca row chk + save). Por eso el form sólo necesita los
// SKUs y la opción de mandar a PROD; no hay tag label ni fechas.
//
// Comunicación con el content script: port `colocar-tags:delivery-remove-run`.

import { FEATURE_ID, PORTS, PORT_MSG, STATUS, STEPS, DELIVERY_DEFAULTS } from '../../constants.js';
import { getStorage, setStorage } from '../../../../shared/storage/storage.js';
import { logger } from '../../../../shared/utils/logger.js';
import { attachPortWatchdog, escapeHtml } from '../utils.js';

const log = logger('colocar-tags/delivery-remove');
const STORAGE_KEY = `${FEATURE_ID}:delivery-remove:last-config`;

const STEP_LABELS = {
  [STEPS.SEARCH_TYPE]:         'Tipeando SKU',
  [STEPS.SEARCH_CLICK]:        'Click en Search',
  [STEPS.SEARCH_WAIT_ROW]:     'Esperando fila exacta',
  [STEPS.SEARCH_CLICK_EDIT]:   'Abriendo Edit',
  [STEPS.MODAL_WAIT_OPEN]:     'Esperando modal',
  [STEPS.DELREM_CHECK_ROW]:    'Marcando fila Delivery',
  [STEPS.DELREM_UNCHECK_USE]:  'Desmarcando Use',
  [STEPS.DELREM_SAVE_STG]:     'Guardando STG',
  [STEPS.DELREM_CONFIRM_STG]:  'Confirmando STG',
  [STEPS.DELREM_ACK_STG]:      'OK STG',
  [STEPS.DELREM_SAVE_PROD]:    'Guardando PROD',
  [STEPS.DELREM_CONFIRM_PROD]: 'Confirmando PROD',
  [STEPS.DELREM_ACK_PROD]:     'OK PROD',
  [STEPS.DONE]:                'Listo',
  'not-found':                 'Sin resultados',
  'cancelled':                 'Cancelado',
  'error':                     'Error',
  'empty':                     'SKU vacío',
};

let activePort = null;
let activeWatchdog = null;
let skuStates = new Map();

export async function render(container) {
  const cfg = (await getStorage(STORAGE_KEY)) || {};
  const skipProd = cfg.skipProd ?? DELIVERY_DEFAULTS.skipProd;

  container.innerHTML = `
    <form id="dr-form" class="dt-form" autocomplete="off">
      <p class="dt-hint">Desactiva el Tag de Delivery del producto: desmarca "Use", marca la fila y guarda.</p>

      <label class="dt-field">
        <span class="dt-label">SKUs (uno por línea, "Sales Model" exacto)</span>
        <textarea id="dr-skus" rows="4" class="dt-input dt-textarea" placeholder="OLED65B5PSA.AWH&#10;OLED55C5PSA.AWH"></textarea>
      </label>

      <label class="dt-check">
        <input id="dr-skip-prod" type="checkbox" ${skipProd ? 'checked' : ''} />
        <span>Sólo STG (no enviar a PROD)</span>
      </label>

      <div class="dt-actions">
        <button id="dr-run"    type="submit" class="ct-btn ct-btn--primary">Quitar</button>
        <button id="dr-cancel" type="button" class="ct-btn ct-btn--ghost" disabled>Cancelar</button>
      </div>
    </form>

    <div id="dr-progress" class="dt-progress hidden">
      <div class="dt-progress-head">
        <strong id="dr-progress-title">Procesando…</strong>
        <span id="dr-progress-counter" class="dt-progress-counter"></span>
      </div>
      <ul id="dr-progress-list" class="dt-progress-list"></ul>
    </div>
  `;

  container.querySelector('#dr-form').addEventListener('submit', (e) => {
    e.preventDefault();
    onRun(container);
  });
  container.querySelector('#dr-cancel').addEventListener('click', onCancel);

  resetProgress(container);
}

async function onRun(container) {
  const skus = parseSkus(container.querySelector('#dr-skus').value);
  const skipProd = container.querySelector('#dr-skip-prod').checked;

  if (skus.length === 0) return alert('Ingresá al menos un SKU.');

  await setStorage(STORAGE_KEY, { skipProd });

  await startRun(container, { skus, skipProd });
}

function parseSkus(raw) {
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
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

  const port = chrome.tabs.connect(tab.id, { name: PORTS.DELIVERY_REMOVE_RUN });
  activePort = port;

  activeWatchdog = attachPortWatchdog(port, {
    timeoutMs: 12000,
    onTimeout: () => {
      setProgressTitle(container, 'Sin respuesta de la pestaña');
      toggleRunning(container, false);
      alert(
        'La pestaña activa no respondió en 12s.\n\n' +
        'Posibles causas:\n' +
        '• No estás en la pantalla "Marketing Info Mapping" de GP1.\n' +
        '• La pestaña activa no es la de GP1.\n' +
        '• El content script no cargó (reintentá recargando la pestaña).',
      );
    },
  });

  port.onMessage.addListener((msg) => onPortMessage(container, msg));
  port.onDisconnect.addListener(() => {
    log.info('port desconectado');
    activePort = null;
    activeWatchdog?.dispose();
    activeWatchdog = null;
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
  activeWatchdog?.clear();
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
  container.querySelector('#dr-run').disabled = running;
  container.querySelector('#dr-cancel').disabled = !running;
  container.querySelector('#dr-skus').disabled = running;
  container.querySelector('#dr-skip-prod').disabled = running;
}

function prepareProgress(container, skus) {
  skuStates = new Map(skus.map((sku, i) => [`${i}::${sku}`, { sku, status: STATUS.PENDING, step: null }]));
  const list = container.querySelector('#dr-progress-list');
  list.innerHTML = '';
  for (const [key, st] of skuStates) {
    const li = document.createElement('li');
    li.className = 'dt-progress-item dt-progress-item--pending';
    li.dataset.key = key;
    li.innerHTML = renderItemBody(st);
    list.appendChild(li);
  }
  container.querySelector('#dr-progress').classList.remove('hidden');
  container.querySelector('#dr-progress-counter').textContent = `0 / ${skus.length}`;
  setProgressTitle(container, 'Procesando…');
}

function resetProgress(container) {
  container.querySelector('#dr-progress')?.classList.add('hidden');
  container.querySelector('#dr-progress-list').innerHTML = '';
  toggleRunning(container, false);
}

function setProgressTitle(container, text) {
  const el = container.querySelector('#dr-progress-title');
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

  const total = skuStates.size;
  let done = 0;
  for (const st of skuStates.values()) {
    if ([STATUS.OK, STATUS.ERROR, STATUS.SKIPPED].includes(st.status)) done++;
  }
  container.querySelector('#dr-progress-counter').textContent = `${done} / ${total}`;
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
