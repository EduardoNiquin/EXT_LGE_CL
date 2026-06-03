// UI del sub-flujo "Quitar Tag de Delivery".
//
// Inverso a "Tag de Delivery": en vez de aplicar el tag, lo desactiva
// (desmarca Use + marca row chk + save). Por eso el form sólo necesita los
// SKUs y la opción de mandar a PROD; no hay tag label ni fechas.
//
// Storage-driven (ver run-ui.js / state.js): el proceso corre en el content
// script y sobrevive al cierre del popup.

import { RUN_KIND, STEPS, DELIVERY_DEFAULTS, STORAGE_KEYS } from '../../constants.js';
import { getStorage } from '../../../../shared/storage/storage.js';
import { escapeHtml } from '../utils.js';
import { mountRunSection, progressMarkup } from '../run-ui.js';

const DRAFT_KEY = STORAGE_KEYS.DRAFT[RUN_KIND.DELIVERY_REMOVE];

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

export async function render(container) {
  const cfg = (await getStorage(DRAFT_KEY)) || {};
  const skipProd = cfg.skipProd ?? DELIVERY_DEFAULTS.skipProd;

  container.innerHTML = `
    <form id="dr-form" class="dt-form" autocomplete="off">
      <p class="dt-hint">Desactiva el Tag de Delivery del producto: desmarca "Use", marca la fila y guarda.</p>

      <label class="dt-field">
        <span class="dt-label">SKUs (uno por línea, "Sales Model" exacto)</span>
        <textarea id="dr-skus" rows="4" class="dt-input dt-textarea" placeholder="OLED65B5PSA.AWH&#10;OLED55C5PSA.AWH">${escapeHtml(cfg.skus ?? '')}</textarea>
      </label>

      <label class="dt-check">
        <input id="dr-skip-prod" type="checkbox" ${skipProd ? 'checked' : ''} />
        <span>Sólo STG (no enviar a PROD)</span>
      </label>

      <div class="dt-actions">
        <button id="dr-run"    type="button" class="ct-btn ct-btn--primary">Quitar</button>
        <button id="dr-cancel" type="button" class="ct-btn ct-btn--ghost" disabled>Cancelar</button>
      </div>
    </form>

    ${progressMarkup('dr')}
  `;

  mountRunSection(container, {
    prefix: 'dr',
    kind: RUN_KIND.DELIVERY_REMOVE,
    stepLabels: STEP_LABELS,
    formSelectors: ['#dr-skus', '#dr-skip-prod'],
    collect: () => collect(container),
    draft: { key: DRAFT_KEY, collect: () => collectDraft(container) },
  });
}

function collect(container) {
  const skus = parseSkus(container.querySelector('#dr-skus').value);
  const skipProd = container.querySelector('#dr-skip-prod').checked;
  if (skus.length === 0) { alert('Ingresá al menos un SKU.'); return null; }
  return { config: { skipProd }, skus, message: `Quitar Delivery — ${skus.length} SKU(s)` };
}

function collectDraft(container) {
  return {
    skus:     container.querySelector('#dr-skus').value,
    skipProd: container.querySelector('#dr-skip-prod').checked,
  };
}

function parseSkus(raw) {
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}
