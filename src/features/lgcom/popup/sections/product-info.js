// Sección "Info de Producto" del feature LG.com.
//
// Pide al content script de la pestaña activa las capturas GraphQL acumuladas,
// elige una operación (por defecto getPbpProduct = PDP) y la muestra en grupos
// legibles con buscador y botones de copia. Las operaciones desconocidas caen a
// una vista de JSON crudo.

import { MESSAGES, OPERATIONS } from '../../constants.js';
import { extract, hasExtractor } from '../../content/extractors/index.js';
import { logger } from '../../../../shared/utils/logger.js';
import {
  copyToClipboard,
  escapeHtml,
  formatTime,
  groupsToText,
  groupToText,
} from '../utils.js';

const log = logger('lgcom/popup');

let selectedOperation = null;

export async function render(container) {
  container.innerHTML = `<div class="ct-state"><span class="ct-spinner"></span><p>Leyendo la pestaña…</p></div>`;

  const tab = await getActiveTab();
  if (!tab?.id) {
    renderWarn(container, 'No hay pestaña activa.');
    return;
  }

  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: MESSAGES.GET_CAPTURES });
  } catch {
    res = null;
  }

  if (!res?.ok || !Array.isArray(res.captures) || res.captures.length === 0) {
    renderEmpty(container, tab);
    return;
  }

  // Elegir operación: la previamente seleccionada si sigue disponible, si no
  // getPbpProduct, si no la primera.
  const names = res.captures.map((c) => c.operationName);
  if (!names.includes(selectedOperation)) {
    selectedOperation = names.includes('getPbpProduct') ? 'getPbpProduct' : names[0];
  }

  await renderData(container, tab, res.captures);
}

// -----------------------------------------------------------------------------
// estados vacíos / error
// -----------------------------------------------------------------------------

function renderWarn(container, message) {
  container.innerHTML = `
    <div class="lt-view">
      <div class="ct-state ct-state--warn"><p>${escapeHtml(message)}</p></div>
    </div>`;
}

function renderEmpty(container, tab) {
  const isLg = /(^|\.)lg\.com/i.test(safeHost(tab?.url));
  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Info de Producto</h3>
        <p class="lt-hint">
          ${isLg
            ? 'Todavía no se captó ninguna respuesta GraphQL en esta pestaña. Abrí o recargá una página de producto (PDP) en www.lg.com y volvé a intentar.'
            : 'Esta pestaña no es www.lg.com. Abrí una página de producto en www.lg.com para ver su información.'}
        </p>
        <div class="lt-actions">
          <button type="button" id="lg-refresh" class="ct-btn ct-btn--primary">Actualizar</button>
        </div>
      </section>
    </div>`;
  container.querySelector('#lg-refresh')?.addEventListener('click', () => render(container));
}

// -----------------------------------------------------------------------------
// render principal
// -----------------------------------------------------------------------------

async function renderData(container, tab, captures) {
  let op;
  try {
    op = await chrome.tabs.sendMessage(tab.id, {
      type: MESSAGES.GET_OPERATION,
      operationName: selectedOperation,
    });
  } catch {
    op = null;
  }

  if (!op?.ok) {
    renderWarn(container, op?.reason || 'No se pudo leer la operación seleccionada.');
    return;
  }

  const meta = OPERATIONS[selectedOperation];
  const groups = hasExtractor(selectedOperation)
    ? (extract(selectedOperation, op.response) || [])
    : null;

  const selectHtml = captures.length > 1
    ? `
      <div class="dt-field lg-op-field">
        <label class="dt-label" for="lg-op">Operación GraphQL</label>
        <select id="lg-op" class="dt-input">
          ${captures.map((c) => {
            const m = OPERATIONS[c.operationName];
            const label = m ? `${c.operationName} — ${m.label}` : c.operationName;
            return `<option value="${escapeHtml(c.operationName)}" ${c.operationName === selectedOperation ? 'selected' : ''}>${escapeHtml(label)}</option>`;
          }).join('')}
        </select>
      </div>`
    : '';

  container.innerHTML = `
    <div class="lt-view lg-view">
      <section class="lt-form-card">
        <div class="lg-head">
          <h3 class="lt-section-title">${escapeHtml(meta?.label || selectedOperation)}</h3>
          <span class="lg-ts">${op.ts ? `captado ${formatTime(op.ts)}` : ''}</span>
        </div>
        ${meta?.description ? `<p class="lt-hint">${escapeHtml(meta.description)}</p>` : ''}
        ${selectHtml}

        <div class="lg-toolbar">
          <div class="search-wrapper lg-search">
            <svg class="search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.6"/>
              <path d="M13 13l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <input type="text" id="lg-filter" class="search-input" placeholder="Filtrar campos…" autocomplete="off" spellcheck="false" />
          </div>
          <div class="lg-copy-all">
            <button type="button" id="lg-copy-text" class="ct-btn ct-btn--ghost" title="Copiar todo como texto">Copiar todo</button>
            <button type="button" id="lg-copy-json" class="ct-btn ct-btn--ghost" title="Copiar respuesta JSON cruda">JSON</button>
          </div>
        </div>

        <div id="lg-body" class="lg-body"></div>
      </section>
      <div class="lt-actions">
        <button type="button" id="lg-refresh" class="ct-btn ct-btn--primary">Actualizar</button>
      </div>
    </div>`;

  const body = container.querySelector('#lg-body');
  if (groups) {
    renderGroups(body, groups);
  } else {
    renderRaw(body, op.response);
  }

  // Eventos
  container.querySelector('#lg-op')?.addEventListener('change', (e) => {
    selectedOperation = e.target.value;
    renderData(container, tab, captures);
  });
  container.querySelector('#lg-refresh')?.addEventListener('click', () => render(container));
  container.querySelector('#lg-copy-json')?.addEventListener('click', (e) =>
    flashCopy(e.currentTarget, JSON.stringify(op.response, null, 2)));
  container.querySelector('#lg-copy-text')?.addEventListener('click', (e) =>
    flashCopy(e.currentTarget, groups ? groupsToText(groups) : JSON.stringify(op.response, null, 2)));

  const filter = container.querySelector('#lg-filter');
  filter?.addEventListener('input', () => applyFilter(body, filter.value));

  log.info('render', { operation: selectedOperation, groups: groups?.length });
}

// -----------------------------------------------------------------------------
// grupos
// -----------------------------------------------------------------------------

function renderGroups(body, groups) {
  if (!groups.length) {
    body.innerHTML = `<p class="ct-empty">La respuesta no trae datos reconocibles.</p>`;
    return;
  }
  body.innerHTML = groups.map((g) => `
    <details class="lg-group" open data-group="${escapeHtml(g.id)}">
      <summary class="lg-group-head">
        <span class="lg-group-title">${escapeHtml(g.label)}</span>
        <button type="button" class="lg-copy-group" data-group="${escapeHtml(g.id)}" title="Copiar este grupo">Copiar</button>
      </summary>
      <ul class="lg-fields">
        ${g.fields.map((f) => `
          <li class="lg-field" data-search="${escapeHtml((f.label + ' ' + f.raw).toLowerCase())}">
            <span class="lg-field-label">${escapeHtml(f.label)}</span>
            <span class="lg-field-value">${escapeHtml(f.value)}</span>
            <button type="button" class="lg-copy-field" data-raw="${escapeHtml(f.raw)}" title="Copiar valor" aria-label="Copiar ${escapeHtml(f.label)}">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" width="13" height="13">
                <rect x="5" y="5" width="8" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            </button>
          </li>
        `).join('')}
      </ul>
    </details>
  `).join('');

  body.querySelectorAll('.lg-copy-field').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      flashCopy(btn, btn.dataset.raw);
    });
  });
  body.querySelectorAll('.lg-copy-group').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const group = groups.find((g) => g.id === btn.dataset.group);
      if (group) flashCopy(btn, groupToText(group));
    });
  });
}

function renderRaw(body, response) {
  body.innerHTML = `
    <p class="lt-hint">Operación sin vista detallada — se muestra el JSON crudo.</p>
    <pre class="lg-raw" data-search="">${escapeHtml(JSON.stringify(response, null, 2))}</pre>`;
}

// -----------------------------------------------------------------------------
// filtro
// -----------------------------------------------------------------------------

function applyFilter(body, query) {
  const q = String(query || '').trim().toLowerCase();
  const fields = body.querySelectorAll('.lg-field');
  fields.forEach((li) => {
    const hit = !q || (li.dataset.search || '').includes(q);
    li.classList.toggle('hidden', !hit);
  });
  // Ocultar grupos sin coincidencias.
  body.querySelectorAll('.lg-group').forEach((g) => {
    const visible = g.querySelectorAll('.lg-field:not(.hidden)').length;
    g.classList.toggle('hidden', q && visible === 0);
  });
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

async function flashCopy(btn, text) {
  const ok = await copyToClipboard(text);
  const prev = btn.dataset.label ?? btn.textContent;
  const hasIcon = btn.querySelector('svg');
  if (!hasIcon) {
    btn.dataset.label = prev;
    btn.textContent = ok ? '¡Copiado!' : 'Error';
  }
  btn.classList.add(ok ? 'is-copied' : 'is-error');
  setTimeout(() => {
    btn.classList.remove('is-copied', 'is-error');
    if (!hasIcon && btn.dataset.label != null) {
      btn.textContent = btn.dataset.label;
      delete btn.dataset.label;
    }
  }, 1100);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function safeHost(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}
