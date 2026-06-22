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

import { RUN_KIND, STEPS, STORAGE_KEYS } from '../../constants.js';
import { getStorage } from '../../../../shared/storage/storage.js';
import { escapeHtml } from '../utils.js';
import { mountRunSection, progressMarkup } from '../run-ui.js';

const DRAFT_KEY = STORAGE_KEYS.DRAFT[RUN_KIND.PRODUCT];

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

export async function render(container) {
  const cfg = (await getStorage(DRAFT_KEY)) || {};
  const tags = Array.isArray(cfg.tags) && cfg.tags.length > 0
    ? cfg.tags.map((t) => ({ ...blankTag(), ...t }))
    : [blankTag()];
  const skipProd = cfg.skipProd ?? true;

  container.innerHTML = `
    <form id="pt-form" class="dt-form" autocomplete="off">
      <label class="dt-field">
        <span class="dt-label">SKUs (uno por línea, "Sales Model" exacto)</span>
        <textarea id="pt-skus" rows="3" class="dt-input dt-textarea" placeholder="OLED65B5PSA.AWH&#10;OLED55C5PSA.AWH">${escapeHtml(cfg.skus ?? '')}</textarea>
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
        <button id="pt-run"    type="button" class="ct-btn ct-btn--primary">Aplicar</button>
        <button id="pt-cancel" type="button" class="ct-btn ct-btn--ghost" disabled>Cancelar</button>
      </div>
    </form>

    ${progressMarkup('pt')}
  `;

  const tagsHost = container.querySelector('#pt-tags');
  renderTagCards(tagsHost, tags);

  container.querySelector('#pt-add-tag').addEventListener('click', () => {
    if (tags.length >= 2) return;
    tags.push(blankTag());
    renderTagCards(tagsHost, tags);
    updateAddTagBtn(container, tags);
  });

  updateAddTagBtn(container, tags);

  mountRunSection(container, {
    prefix: 'pt',
    kind: RUN_KIND.PRODUCT,
    stepLabels: STEP_LABELS,
    formSelectors: ['#pt-skus', '#pt-skip-prod', '#pt-add-tag', '#pt-tags input', '#pt-tags select', '#pt-tags button'],
    collect: () => collect(container, tags),
    draft: {
      key: DRAFT_KEY,
      collect: () => ({
        skus: container.querySelector('#pt-skus').value,
        tags,
        skipProd: container.querySelector('#pt-skip-prod').checked,
      }),
    },
  });
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
// recolección / validación
// -----------------------------------------------------------------------------

function collect(container, tags) {
  const skus     = parseSkus(container.querySelector('#pt-skus').value);
  const skipProd = container.querySelector('#pt-skip-prod').checked;

  if (skus.length === 0) { alert('Ingrese al menos un SKU.'); return null; }

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
    if (!t.category) { alert(`Tag ${n}: elija una categoría.`); return null; }
    if (!t.group)    { alert(`Tag ${n}: complete el grupo.`); return null; }
    if (!t.tag)      { alert(`Tag ${n}: complete el tag.`); return null; }
    if (!t.type)     { alert(`Tag ${n}: elija un type.`); return null; }
    if (!t.beginDay || !t.endDay)   { alert(`Tag ${n}: complete las fechas.`); return null; }
    if (!t.beginTime || !t.endTime) { alert(`Tag ${n}: complete las horas.`); return null; }
  }

  const config = { tags: cleanedTags, skipProd, userType: 'ALL' };
  return { config, skus, message: `Tag de Producto — ${skus.length} SKU(s)` };
}

function parseSkus(raw) {
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

function normalizeTime(t) {
  return String(t || '').slice(0, 5);
}
