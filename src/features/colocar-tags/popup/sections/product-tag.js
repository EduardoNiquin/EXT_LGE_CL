// UI del feature "Tag de Producto".
//
// Permite cargar SKU(s) + hasta 2 product tags. Cada tag tiene 4 campos
// (categoría, grupo, tag, type) más su schedule (begin/end day/time).
// El user type se aplica como "ALL" en todos (mismo default que delivery).
//
// Comunicación con el content script: port `colocar-tags:product-run`.
// Mismo protocolo de progreso por SKU que la sección delivery — para no
// duplicar mucho CSS reuso clases `.dt-*` y agrego `.pt-*` sólo donde
// difieren los layouts (las dos cards de tag, repeaters, etc.).

import { FEATURE_ID, PORTS, PORT_MSG, STATUS, STEPS } from '../../constants.js';
import { getStorage, setStorage } from '../../../../shared/storage/storage.js';
import { logger } from '../../../../shared/utils/logger.js';
import { attachPortWatchdog, escapeHtml } from '../utils.js';

const log = logger('colocar-tags/product');
const STORAGE_KEY = `${FEATURE_ID}:product:last-config`;

const CATEGORIES = ['Product', 'Promotion'];
const TYPES = [
  { value: 'gradient', label: 'Gradient' },
  { value: 'solid',    label: 'Solid' },
  { value: 'line',     label: 'Line' },
];

const STEP_LABELS = {
  [STEPS.SEARCH_TYPE]:        'Tipeando SKU',
  [STEPS.SEARCH_CLICK]:       'Click en Search',
  [STEPS.SEARCH_WAIT_ROW]:    'Esperando fila exacta',
  [STEPS.SEARCH_CLICK_EDIT]:  'Abriendo Edit',
  [STEPS.MODAL_WAIT_OPEN]:    'Esperando modal',
  [STEPS.PROD_CHECK_ROW]:     'Marcando fila',
  [STEPS.PROD_CATEGORY]:      'Seleccionando categoría',
  [STEPS.PROD_GROUP]:         'Seleccionando grupo',
  [STEPS.PROD_TAG_VALUE]:     'Seleccionando tag',
  [STEPS.PROD_TYPE]:          'Setteando Type',
  [STEPS.PROD_USE]:           'Marcando Use',
  [STEPS.PROD_USER_TYPE]:     'User Type',
  [STEPS.PROD_DATES]:         'Setteando fechas',
  [STEPS.PROD_TAG_DONE]:      'Fila lista',
  [STEPS.PROD_SAVE_STG]:      'Guardando STG',
  [STEPS.PROD_CONFIRM_STG]:   'Confirmando STG',
  [STEPS.PROD_ACK_STG]:       'OK STG',
  [STEPS.PROD_SAVE_PROD]:     'Guardando PROD',
  [STEPS.PROD_CONFIRM_PROD]:  'Confirmando PROD',
  [STEPS.PROD_ACK_PROD]:      'OK PROD',
  [STEPS.DONE]:               'Listo',
  'not-found':                'Sin resultados',
  'cancelled':                'Cancelado',
  'error':                    'Error',
  'empty':                    'SKU vacío',
};

let activePort = null;
let activeWatchdog = null;
let skuStates  = new Map();

export async function render(container) {
  const cfg = (await getStorage(STORAGE_KEY)) || {};
  const tags = Array.isArray(cfg.tags) && cfg.tags.length > 0 ? cfg.tags : [blankTag()];
  const skipProd = cfg.skipProd ?? true;

  container.innerHTML = `
    <form id="pt-form" class="dt-form" autocomplete="off">
      <label class="dt-field">
        <span class="dt-label">SKUs (uno por línea, "Sales Model" exacto)</span>
        <textarea id="pt-skus" rows="3" class="dt-input dt-textarea" placeholder="OLED65B5PSA.AWH&#10;OLED55C5PSA.AWH"></textarea>
      </label>

      <div id="pt-tags" class="pt-tags"></div>

      <div class="pt-tag-actions">
        <button type="button" id="pt-add-tag" class="ct-btn ct-btn--ghost pt-add-btn">+ Agregar 2° tag</button>
      </div>

      <label class="dt-check">
        <input id="pt-skip-prod" type="checkbox" ${skipProd ? 'checked' : ''} />
        <span>Sólo STG (no enviar a PROD)</span>
      </label>

      <div class="dt-actions">
        <button id="pt-run"    type="submit" class="ct-btn ct-btn--primary">Aplicar</button>
        <button id="pt-cancel" type="button" class="ct-btn ct-btn--ghost" disabled>Cancelar</button>
      </div>
    </form>

    <div id="pt-progress" class="dt-progress hidden">
      <div class="dt-progress-head">
        <strong id="pt-progress-title">Procesando…</strong>
        <span id="pt-progress-counter" class="dt-progress-counter"></span>
      </div>
      <ul id="pt-progress-list" class="dt-progress-list"></ul>
    </div>
  `;

  const tagsHost = container.querySelector('#pt-tags');
  renderTagCards(tagsHost, tags);

  container.querySelector('#pt-add-tag').addEventListener('click', () => {
    if (tags.length >= 2) return;
    tags.push(blankTag());
    renderTagCards(tagsHost, tags);
    updateAddTagBtn(container, tags);
  });

  container.querySelector('#pt-form').addEventListener('submit', (e) => {
    e.preventDefault();
    onRun(container, tags);
  });
  container.querySelector('#pt-cancel').addEventListener('click', onCancel);

  updateAddTagBtn(container, tags);
  resetProgress(container);
}

// -----------------------------------------------------------------------------
// tags form (1 ó 2 tarjetas)
// -----------------------------------------------------------------------------

function blankTag() {
  return {
    category:  '',
    group:     '',
    tag:       '',
    type:      'gradient',
    beginDay:  '',
    beginTime: '00:00',
    endDay:    '',
    endTime:   '23:30',
  };
}

function renderTagCards(host, tags) {
  host.innerHTML = '';
  tags.forEach((tag, idx) => {
    const card = document.createElement('section');
    card.className = 'pt-card';
    card.innerHTML = `
      <header class="pt-card-head">
        <span class="pt-card-title">Tag ${idx + 1}</span>
        ${tags.length > 1 ? `<button type="button" class="pt-card-del" aria-label="Quitar">×</button>` : ''}
      </header>

      <div class="dt-row">
        <label class="dt-field dt-field--half">
          <span class="dt-label">Categoría</span>
          <select class="dt-input" data-field="category">
            <option value="">— elegir —</option>
            ${CATEGORIES.map((c) => `<option value="${c}" ${tag.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </label>
        <label class="dt-field dt-field--half">
          <span class="dt-label">Type</span>
          <select class="dt-input" data-field="type">
            ${TYPES.map((t) => `<option value="${t.value}" ${tag.type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
          </select>
        </label>
      </div>

      <label class="dt-field">
        <span class="dt-label">Grupo (2do selector)</span>
        <input type="text" class="dt-input" data-field="group" value="${escapeHtml(tag.group)}" placeholder="Texto exacto del grupo" />
      </label>

      <label class="dt-field">
        <span class="dt-label">Tag (3er selector)</span>
        <input type="text" class="dt-input" data-field="tag" value="${escapeHtml(tag.tag)}" placeholder="Texto exacto del tag" />
      </label>

      <div class="dt-row">
        <label class="dt-field dt-field--half">
          <span class="dt-label">Inicio</span>
          <div class="dt-datetime">
            <input type="date" class="dt-input" data-field="beginDay" value="${escapeHtml(tag.beginDay)}" />
            <input type="time" class="dt-input" data-field="beginTime" value="${escapeHtml(tag.beginTime)}" step="1800" />
          </div>
        </label>
        <label class="dt-field dt-field--half">
          <span class="dt-label">Fin</span>
          <div class="dt-datetime">
            <input type="date" class="dt-input" data-field="endDay" value="${escapeHtml(tag.endDay)}" />
            <input type="time" class="dt-input" data-field="endTime" value="${escapeHtml(tag.endTime)}" step="1800" />
          </div>
        </label>
      </div>
    `;

    card.querySelectorAll('[data-field]').forEach((el) => {
      el.addEventListener('input', () => { tag[el.dataset.field] = el.value; });
      el.addEventListener('change', () => { tag[el.dataset.field] = el.value; });
    });

    const del = card.querySelector('.pt-card-del');
    if (del) {
      del.addEventListener('click', () => {
        tags.splice(idx, 1);
        if (tags.length === 0) tags.push(blankTag());
        renderTagCards(host, tags);
        updateAddTagBtn(host.parentElement.parentElement, tags);
      });
    }

    host.appendChild(card);
  });
}

function updateAddTagBtn(container, tags) {
  const btn = container.querySelector('#pt-add-tag');
  if (!btn) return;
  btn.disabled = tags.length >= 2;
  btn.textContent = tags.length >= 2 ? 'Máx. 2 tags' : '+ Agregar 2° tag';
}

// -----------------------------------------------------------------------------
// run / cancel
// -----------------------------------------------------------------------------

async function onRun(container, tags) {
  const skusRaw  = container.querySelector('#pt-skus').value;
  const skus     = parseSkus(skusRaw);
  const skipProd = container.querySelector('#pt-skip-prod').checked;

  if (skus.length === 0) return alert('Ingresá al menos un SKU.');

  // Normalizar y validar tags
  const cleanedTags = tags.map((t) => ({
    category:  String(t.category || '').trim(),
    group:     String(t.group    || '').trim(),
    tag:       String(t.tag      || '').trim(),
    type:      String(t.type     || '').trim(),
    beginDay:  String(t.beginDay  || ''),
    beginTime: normalizeTime(t.beginTime),
    endDay:    String(t.endDay    || ''),
    endTime:   normalizeTime(t.endTime),
  }));
  for (let i = 0; i < cleanedTags.length; i++) {
    const t = cleanedTags[i];
    const n = i + 1;
    if (!t.category) return alert(`Tag ${n}: elegí una categoría.`);
    if (!t.group)    return alert(`Tag ${n}: completá el grupo.`);
    if (!t.tag)      return alert(`Tag ${n}: completá el tag.`);
    if (!t.type)     return alert(`Tag ${n}: elegí un type.`);
    if (!t.beginDay || !t.endDay)   return alert(`Tag ${n}: completá las fechas.`);
    if (!t.beginTime || !t.endTime) return alert(`Tag ${n}: completá las horas.`);
  }

  await setStorage(STORAGE_KEY, { tags: cleanedTags, skipProd });

  const config = { skus, tags: cleanedTags, skipProd, userType: 'ALL' };
  await startRun(container, config);
}

function parseSkus(raw) {
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

function normalizeTime(t) {
  return String(t || '').slice(0, 5);
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

  const port = chrome.tabs.connect(tab.id, { name: PORTS.PRODUCT_RUN });
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

// -----------------------------------------------------------------------------
// progress
// -----------------------------------------------------------------------------

function toggleRunning(container, running) {
  container.querySelector('#pt-run').disabled = running;
  container.querySelector('#pt-cancel').disabled = !running;
  const addBtn = container.querySelector('#pt-add-tag');
  if (addBtn) addBtn.disabled = running || isMaxTagsReached(container);
  container.querySelectorAll('#pt-tags input, #pt-tags select, #pt-tags button').forEach((el) => {
    el.disabled = running;
  });
  container.querySelector('#pt-skus').disabled = running;
  container.querySelector('#pt-skip-prod').disabled = running;
}

function isMaxTagsReached(container) {
  return container.querySelectorAll('.pt-card').length >= 2;
}

function prepareProgress(container, skus) {
  skuStates = new Map(skus.map((sku, i) => [`${i}::${sku}`, { sku, status: STATUS.PENDING, step: null }]));
  const list = container.querySelector('#pt-progress-list');
  list.innerHTML = '';
  for (const [key, st] of skuStates) {
    const li = document.createElement('li');
    li.className = 'dt-progress-item dt-progress-item--pending';
    li.dataset.key = key;
    li.innerHTML = renderItemBody(st);
    list.appendChild(li);
  }
  container.querySelector('#pt-progress').classList.remove('hidden');
  container.querySelector('#pt-progress-counter').textContent = `0 / ${skus.length}`;
  setProgressTitle(container, 'Procesando…');
}

function resetProgress(container) {
  container.querySelector('#pt-progress')?.classList.add('hidden');
  container.querySelector('#pt-progress-list').innerHTML = '';
  toggleRunning(container, false);
}

function setProgressTitle(container, text) {
  const el = container.querySelector('#pt-progress-title');
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
  container.querySelector('#pt-progress-counter').textContent = `${done} / ${total}`;
}

function renderItemBody(st) {
  let stepLabel = STEP_LABELS[st.step] || st.step || '';
  // Si el step viene con tagIndex (PROD_*), anotarlo en el label.
  if (st.detail?.tagIndex) stepLabel = `Tag ${st.detail.tagIndex} — ${stepLabel}`;
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
