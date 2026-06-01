// UI del feature "Tag de Oferta".
//
// Permite cargar SKU(s) + activar de 1 a 4 ofertas (Gift, Discount, Coupon,
// Truck — fijas por fila en GP1). Cada oferta activada tiene: toggle "Use",
// Description (texto) y rango Start/End Date (sólo fecha, sin hora).
//
// Comunicación con el content script: port `colocar-tags:offer-run`.
// Reutiliza las clases CSS `.dt-*` / `.pt-*` de las otras secciones de tags.

import { FEATURE_ID, PORTS, PORT_MSG, STATUS, STEPS, OFFER_TYPES } from '../../constants.js';
import { getStorage, setStorage } from '../../../../shared/storage/storage.js';
import { logger } from '../../../../shared/utils/logger.js';
import { attachPortWatchdog, escapeHtml } from '../utils.js';

const log = logger('colocar-tags/offer');
const STORAGE_KEY = `${FEATURE_ID}:offer:last-config`;

const STEP_LABELS = {
  [STEPS.SEARCH_TYPE]:       'Tipeando SKU',
  [STEPS.SEARCH_CLICK]:      'Click en Search',
  [STEPS.SEARCH_WAIT_ROW]:   'Esperando fila exacta',
  [STEPS.SEARCH_CLICK_EDIT]: 'Abriendo Edit',
  [STEPS.MODAL_WAIT_OPEN]:   'Esperando modal',
  [STEPS.OFF_CHECK_ROW]:     'Marcando fila',
  [STEPS.OFF_USE]:           'Marcando Use',
  [STEPS.OFF_DESC]:          'Escribiendo descripción',
  [STEPS.OFF_DATES]:         'Setteando fechas',
  [STEPS.OFF_ROW_DONE]:      'Oferta lista',
  [STEPS.OFF_SAVE_STG]:      'Guardando STG',
  [STEPS.OFF_CONFIRM_STG]:   'Confirmando STG',
  [STEPS.OFF_ACK_STG]:       'OK STG',
  [STEPS.OFF_SAVE_PROD]:     'Guardando PROD',
  [STEPS.OFF_CONFIRM_PROD]:  'Confirmando PROD',
  [STEPS.OFF_ACK_PROD]:      'OK PROD',
  [STEPS.DONE]:              'Listo',
  'not-found':               'Sin resultados',
  'cancelled':               'Cancelado',
  'error':                   'Error',
  'empty':                   'SKU vacío',
};

let activePort = null;
let activeWatchdog = null;
let skuStates = new Map();

export async function render(container) {
  const cfg = (await getStorage(STORAGE_KEY)) || {};
  const offers = mergeOffers(cfg.offers);
  const skipProd = cfg.skipProd ?? true;

  container.innerHTML = `
    <form id="of-form" class="dt-form" autocomplete="off">
      <label class="dt-field">
        <span class="dt-label">SKUs (uno por línea, "Sales Model" exacto)</span>
        <textarea id="of-skus" rows="3" class="dt-input dt-textarea" placeholder="OLED65B5PSA.AWH&#10;OLED55C5PSA.AWH"></textarea>
      </label>

      <p class="dt-hint">Activá las ofertas que querés aplicar (1 a 4).</p>
      <div id="of-cards" class="pt-tags"></div>

      <label class="dt-check">
        <input id="of-skip-prod" type="checkbox" ${skipProd ? 'checked' : ''} />
        <span>Sólo STG (no enviar a PROD)</span>
      </label>

      <div class="dt-actions">
        <button id="of-run"    type="submit" class="ct-btn ct-btn--primary">Aplicar</button>
        <button id="of-cancel" type="button" class="ct-btn ct-btn--ghost" disabled>Cancelar</button>
      </div>
    </form>

    <div id="of-progress" class="dt-progress hidden">
      <div class="dt-progress-head">
        <strong id="of-progress-title">Procesando…</strong>
        <span id="of-progress-counter" class="dt-progress-counter"></span>
      </div>
      <ul id="of-progress-list" class="dt-progress-list"></ul>
    </div>
  `;

  renderOfferCards(container.querySelector('#of-cards'), offers);

  container.querySelector('#of-form').addEventListener('submit', (e) => {
    e.preventDefault();
    onRun(container, offers);
  });
  container.querySelector('#of-cancel').addEventListener('click', onCancel);

  resetProgress(container);
}

// -----------------------------------------------------------------------------
// offer cards (4 fijas)
// -----------------------------------------------------------------------------

function blankOffer(type) {
  return {
    index:       type.index,
    key:         type.key,
    label:       type.label,
    enabled:     false,
    use:         true,
    description: '',
    startDate:   '',
    endDate:     '',
  };
}

/** Combina la config guardada con las 4 ofertas fijas, preservando orden. */
function mergeOffers(saved) {
  const byIndex = new Map((Array.isArray(saved) ? saved : []).map((o) => [o.index, o]));
  return OFFER_TYPES.map((type) => {
    const prev = byIndex.get(type.index);
    return prev ? { ...blankOffer(type), ...prev, key: type.key, label: type.label } : blankOffer(type);
  });
}

function renderOfferCards(host, offers) {
  host.innerHTML = '';
  offers.forEach((offer) => {
    const type = OFFER_TYPES.find((t) => t.index === offer.index);
    const card = document.createElement('section');
    card.className = `pt-card of-card ${offer.enabled ? '' : 'of-card--off'}`;
    card.dataset.index = String(offer.index);
    card.innerHTML = `
      <header class="pt-card-head">
        <label class="of-card-toggle">
          <input type="checkbox" data-field="enabled" ${offer.enabled ? 'checked' : ''} />
          <span class="pt-card-title">${type ? type.icon : ''} ${escapeHtml(offer.label)}</span>
        </label>
      </header>

      <div class="of-card-body">
        <label class="dt-check">
          <input type="checkbox" data-field="use" ${offer.use ? 'checked' : ''} />
          <span>Use (oferta activa)</span>
        </label>

        <label class="dt-field">
          <span class="dt-label">Descripción</span>
          <textarea rows="2" class="dt-input dt-textarea" data-field="description" placeholder="Texto a mostrar">${escapeHtml(offer.description)}</textarea>
        </label>

        <div class="dt-row">
          <label class="dt-field dt-field--half">
            <span class="dt-label">Start Date</span>
            <input type="date" class="dt-input" data-field="startDate" value="${escapeHtml(offer.startDate)}" />
          </label>
          <label class="dt-field dt-field--half">
            <span class="dt-label">End Date</span>
            <input type="date" class="dt-input" data-field="endDate" value="${escapeHtml(offer.endDate)}" />
          </label>
        </div>
      </div>
    `;

    card.querySelectorAll('[data-field]').forEach((el) => {
      const field = el.dataset.field;
      const read = () => (el.type === 'checkbox' ? el.checked : el.value);
      const apply = () => {
        offer[field] = read();
        if (field === 'enabled') card.classList.toggle('of-card--off', !offer.enabled);
      };
      el.addEventListener('input', apply);
      el.addEventListener('change', apply);
    });

    host.appendChild(card);
  });
}

// -----------------------------------------------------------------------------
// run / cancel
// -----------------------------------------------------------------------------

async function onRun(container, offers) {
  const skus = parseSkus(container.querySelector('#of-skus').value);
  const skipProd = container.querySelector('#of-skip-prod').checked;

  if (skus.length === 0) return alert('Ingresá al menos un SKU.');

  const enabled = offers.filter((o) => o.enabled);
  if (enabled.length === 0) return alert('Activá al menos una oferta.');

  // Normalizar + validar cada oferta activada.
  const cleaned = enabled.map((o) => ({
    index:       o.index,
    label:       o.label,
    use:         Boolean(o.use),
    description: String(o.description || '').trim(),
    startDate:   String(o.startDate || ''),
    endDate:     String(o.endDate || ''),
  }));
  for (const o of cleaned) {
    // Si la oferta queda activa (Use), exigimos descripción + fechas completas.
    if (o.use) {
      if (!o.description) return alert(`Oferta ${o.label}: completá la descripción.`);
      if (!o.startDate || !o.endDate) return alert(`Oferta ${o.label}: completá Start y End Date.`);
    } else if ((o.startDate && !o.endDate) || (!o.startDate && o.endDate)) {
      return alert(`Oferta ${o.label}: completá ambas fechas o ninguna.`);
    }
    if (o.startDate && o.endDate && o.startDate > o.endDate) {
      return alert(`Oferta ${o.label}: Start Date es posterior a End Date.`);
    }
  }

  // Persistir el estado completo de las 4 (para repoblar el form).
  await setStorage(STORAGE_KEY, { offers, skipProd });

  const config = { skus, offers: cleaned, skipProd };
  await startRun(container, config);
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

  const port = chrome.tabs.connect(tab.id, { name: PORTS.OFFER_RUN });
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
  container.querySelector('#of-run').disabled = running;
  container.querySelector('#of-cancel').disabled = !running;
  container.querySelectorAll('#of-cards input, #of-cards textarea').forEach((el) => {
    el.disabled = running;
  });
  container.querySelector('#of-skus').disabled = running;
  container.querySelector('#of-skip-prod').disabled = running;
}

function prepareProgress(container, skus) {
  skuStates = new Map(skus.map((sku, i) => [`${i}::${sku}`, { sku, status: STATUS.PENDING, step: null }]));
  const list = container.querySelector('#of-progress-list');
  list.innerHTML = '';
  for (const [key, st] of skuStates) {
    const li = document.createElement('li');
    li.className = 'dt-progress-item dt-progress-item--pending';
    li.dataset.key = key;
    li.innerHTML = renderItemBody(st);
    list.appendChild(li);
  }
  container.querySelector('#of-progress').classList.remove('hidden');
  container.querySelector('#of-progress-counter').textContent = `0 / ${skus.length}`;
  setProgressTitle(container, 'Procesando…');
}

function resetProgress(container) {
  container.querySelector('#of-progress')?.classList.add('hidden');
  container.querySelector('#of-progress-list').innerHTML = '';
  toggleRunning(container, false);
}

function setProgressTitle(container, text) {
  const el = container.querySelector('#of-progress-title');
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
  container.querySelector('#of-progress-counter').textContent = `${done} / ${total}`;
}

function renderItemBody(st) {
  let stepLabel = STEP_LABELS[st.step] || st.step || '';
  if (st.detail?.offerLabel) stepLabel = `${st.detail.offerLabel} — ${stepLabel}`;
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
