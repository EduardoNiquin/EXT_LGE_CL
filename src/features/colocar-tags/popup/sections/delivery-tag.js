// UI del sub-flujo "Tag de Delivery" (storage-driven).
//
// Aplica un Delivery Tag a uno o más SKUs. El proceso corre en el content
// script y sobrevive al cierre del popup. Acá sólo armamos el form, validamos y
// delegamos el ciclo (progreso/logs/cancelar) en run-ui.js.

import { RUN_KIND, STEPS, DELIVERY_DEFAULTS, STORAGE_KEYS } from '../../constants.js';
import { getStorage } from '../../../../shared/storage/storage.js';
import { escapeHtml } from '../utils.js';
import { mountRunSection, progressMarkup } from '../run-ui.js';

const DRAFT_KEY = STORAGE_KEYS.DRAFT[RUN_KIND.DELIVERY];

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

export async function render(container) {
  const cfg = (await getStorage(DRAFT_KEY)) || {};
  const defaults = {
    skus:      cfg.skus      ?? '',
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
        <textarea id="dt-skus" rows="4" class="dt-input dt-textarea" placeholder="OLED65B5PSA.AWH&#10;OLED55C5PSA.AWH">${escapeHtml(defaults.skus)}</textarea>
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
        <button id="dt-run"    type="button" class="ct-btn ct-btn--primary">Aplicar</button>
        <button id="dt-cancel" type="button" class="ct-btn ct-btn--ghost" disabled>Cancelar</button>
      </div>
    </form>

    ${progressMarkup('dt')}
  `;

  mountRunSection(container, {
    prefix: 'dt',
    kind: RUN_KIND.DELIVERY,
    stepLabels: STEP_LABELS,
    formSelectors: ['#dt-skus', '#dt-tag', '#dt-begin-day', '#dt-begin-time', '#dt-end-day', '#dt-end-time', '#dt-skip-prod'],
    collect: () => collect(container),
    draft: { key: DRAFT_KEY, collect: () => collectDraft(container) },
  });
}

function collect(container) {
  const skus = parseSkus(container.querySelector('#dt-skus').value);
  const tagLabel  = container.querySelector('#dt-tag').value.trim();
  const beginDay  = container.querySelector('#dt-begin-day').value;
  const beginTime = container.querySelector('#dt-begin-time').value;
  const endDay    = container.querySelector('#dt-end-day').value;
  const endTime   = container.querySelector('#dt-end-time').value;
  const skipProd  = container.querySelector('#dt-skip-prod').checked;

  if (skus.length === 0) { alert('Ingresá al menos un SKU.'); return null; }
  if (!tagLabel) { alert('Especificá el Delivery Tag.'); return null; }
  if (!beginDay || !endDay) { alert('Completá fecha de inicio y fin.'); return null; }
  if (!beginTime || !endTime) { alert('Completá hora de inicio y fin.'); return null; }

  const config = {
    tagLabel,
    beginDay,
    beginTime: normalizeTime(beginTime),
    endDay,
    endTime:   normalizeTime(endTime),
    skipProd,
    userType:  'ALL',
  };
  return { config, skus, message: `Tag de Delivery — ${skus.length} SKU(s)` };
}

function collectDraft(container) {
  return {
    skus:      container.querySelector('#dt-skus').value,
    tagLabel:  container.querySelector('#dt-tag').value,
    beginDay:  container.querySelector('#dt-begin-day').value,
    beginTime: container.querySelector('#dt-begin-time').value,
    endDay:    container.querySelector('#dt-end-day').value,
    endTime:   container.querySelector('#dt-end-time').value,
    skipProd:  container.querySelector('#dt-skip-prod').checked,
  };
}

function parseSkus(raw) {
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

function normalizeTime(t) {
  // input type=time puede devolver "HH:MM" o "HH:MM:SS". Forzamos HH:MM.
  return t.slice(0, 5);
}
