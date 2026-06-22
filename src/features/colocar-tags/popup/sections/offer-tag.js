// UI del feature "Tag de Oferta".
//
// Permite cargar SKU(s) + activar de 1 a 4 ofertas (Gift, Discount, Coupon,
// Truck — fijas por fila en GP1). Cada oferta activada tiene: toggle "Use",
// Description (texto) y rango Start/End Date (sólo fecha, sin hora).
//
// Comunicación con el content script: port `colocar-tags:offer-run`.
// Reutiliza las clases CSS `.dt-*` / `.pt-*` de las otras secciones de tags.

import { RUN_KIND, STEPS, OFFER_TYPES, STORAGE_KEYS } from '../../constants.js';
import { getStorage } from '../../../../shared/storage/storage.js';
import { escapeHtml } from '../utils.js';
import { mountRunSection, progressMarkup } from '../run-ui.js';

const DRAFT_KEY = STORAGE_KEYS.DRAFT[RUN_KIND.OFFER];

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

export async function render(container) {
  const cfg = (await getStorage(DRAFT_KEY)) || {};
  const offers = mergeOffers(cfg.offers);
  const skipProd = cfg.skipProd ?? true;

  container.innerHTML = `
    <form id="of-form" class="dt-form" autocomplete="off">
      <label class="dt-field">
        <span class="dt-label">SKUs (uno por línea, "Sales Model" exacto)</span>
        <textarea id="of-skus" rows="3" class="dt-input dt-textarea" placeholder="OLED65B5PSA.AWH&#10;OLED55C5PSA.AWH">${escapeHtml(cfg.skus ?? '')}</textarea>
      </label>

      <p class="dt-hint">Active las ofertas que desea aplicar (1 a 4).</p>
      <div id="of-cards" class="pt-tags"></div>

      <label class="dt-check">
        <input id="of-skip-prod" type="checkbox" ${skipProd ? 'checked' : ''} />
        <span>Sólo STG (no enviar a PROD)</span>
      </label>

      <div class="dt-actions">
        <button id="of-run"    type="button" class="ct-btn ct-btn--primary">Aplicar</button>
        <button id="of-cancel" type="button" class="ct-btn ct-btn--ghost" disabled>Cancelar</button>
      </div>
    </form>

    ${progressMarkup('of')}
  `;

  renderOfferCards(container.querySelector('#of-cards'), offers);

  mountRunSection(container, {
    prefix: 'of',
    kind: RUN_KIND.OFFER,
    stepLabels: STEP_LABELS,
    formSelectors: ['#of-skus', '#of-skip-prod', '#of-cards input', '#of-cards textarea'],
    collect: () => collect(container, offers),
    draft: {
      key: DRAFT_KEY,
      collect: () => ({
        skus: container.querySelector('#of-skus').value,
        offers,
        skipProd: container.querySelector('#of-skip-prod').checked,
      }),
    },
  });
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
// recolección / validación
// -----------------------------------------------------------------------------

function collect(container, offers) {
  const skus = parseSkus(container.querySelector('#of-skus').value);
  const skipProd = container.querySelector('#of-skip-prod').checked;

  if (skus.length === 0) { alert('Ingrese al menos un SKU.'); return null; }

  const enabled = offers.filter((o) => o.enabled);
  if (enabled.length === 0) { alert('Active al menos una oferta.'); return null; }

  const cleaned = enabled.map((o) => ({
    index:       o.index,
    label:       o.label,
    use:         Boolean(o.use),
    description: String(o.description || '').trim(),
    startDate:   String(o.startDate || ''),
    endDate:     String(o.endDate || ''),
  }));
  for (const o of cleaned) {
    if (o.use) {
      if (!o.description) { alert(`Oferta ${o.label}: complete la descripción.`); return null; }
      if (!o.startDate || !o.endDate) { alert(`Oferta ${o.label}: complete Start y End Date.`); return null; }
    } else if ((o.startDate && !o.endDate) || (!o.startDate && o.endDate)) {
      alert(`Oferta ${o.label}: complete ambas fechas o ninguna.`); return null;
    }
    if (o.startDate && o.endDate && o.startDate > o.endDate) {
      alert(`Oferta ${o.label}: Start Date es posterior a End Date.`); return null;
    }
  }

  const config = { offers: cleaned, skipProd };
  return { config, skus, message: `Tag de Oferta — ${skus.length} SKU(s)` };
}

function parseSkus(raw) {
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}
