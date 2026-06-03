// Sección "Info de Producto" del feature LG.com.
//
// Pide al content script de la pestaña activa las capturas GraphQL acumuladas,
// elige una operación (por defecto getPbpProduct = PDP) y la muestra en grupos
// legibles con buscador y botones de copia. Las operaciones desconocidas caen a
// una vista de JSON crudo.
//
// Auto-captura: la página dispara el GraphQL un instante después de cargar, y a
// veces el popup se abre antes (o hay una captura vieja). En vez de obligar al
// usuario a tocar "Actualizar" repetidamente, hacemos polling durante unos
// segundos: re-renderizamos automáticamente cuando llega una captura más nueva.

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

const POLL_INTERVAL = 700;   // ms entre intentos
const POLL_MAX = 20;         // ~14s de ventana de auto-captura

let selectedOperation = null;
let renderToken = 0;         // invalida loops de polling de renders previos
let pollTimer = null;
let displayedTs = null;      // ts de la captura mostrada (para detectar novedad)
let displayedOp = null;

export function render(container) {
  renderToken += 1;
  const token = renderToken;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  displayedTs = null;
  displayedOp = null;

  container.innerHTML = `<div class="ct-state"><span class="ct-spinner"></span><p>Leyendo la pestaña…</p></div>`;

  getActiveTab().then((tab) => {
    if (token !== renderToken) return;
    if (!tab?.id) { renderWarn(container, 'No hay pestaña activa.'); return; }
    poll(container, token, tab, 0);
  });
}

// -----------------------------------------------------------------------------
// loop de polling / auto-captura
// -----------------------------------------------------------------------------

async function poll(container, token, tab, attempt) {
  if (token !== renderToken) return;

  const res = await safeSend(tab.id, { type: MESSAGES.GET_CAPTURES });
  if (token !== renderToken) return;

  const captures = res?.ok && Array.isArray(res.captures) ? res.captures : [];

  if (captures.length === 0) {
    if (attempt < POLL_MAX) {
      renderWaiting(container, tab, attempt);
      pollTimer = setTimeout(() => poll(container, token, tab, attempt + 1), POLL_INTERVAL);
    } else {
      renderEmpty(container, tab);
    }
    return;
  }

  // Elegir operación: la previa si sigue disponible, si no getPbpProduct, si no
  // la primera.
  const names = captures.map((c) => c.operationName);
  if (!names.includes(selectedOperation)) {
    selectedOperation = names.includes('getPbpProduct') ? 'getPbpProduct' : names[0];
  }

  const summary = captures.find((c) => c.operationName === selectedOperation);
  const latestTs = summary?.ts ?? null;

  // Re-render solo si hay una captura más nueva o cambió la operación.
  if (latestTs !== displayedTs || selectedOperation !== displayedOp) {
    await showOperation(container, token, tab, captures);
  }

  // Seguir en ventana de polling para capturar respuestas que lleguen tarde.
  if (attempt < POLL_MAX) {
    setAutoIndicator(container, true);
    pollTimer = setTimeout(() => poll(container, token, tab, attempt + 1), POLL_INTERVAL);
  } else {
    setAutoIndicator(container, false);
  }
}

async function showOperation(container, token, tab, captures) {
  const op = await safeSend(tab.id, {
    type: MESSAGES.GET_OPERATION,
    operationName: selectedOperation,
  });
  if (token !== renderToken) return;
  if (!op?.ok) return;
  renderData(container, tab, captures, op);
  displayedTs = op.ts ?? null;
  displayedOp = selectedOperation;
}

// -----------------------------------------------------------------------------
// estados vacíos / espera / error
// -----------------------------------------------------------------------------

function renderWarn(container, message) {
  container.innerHTML = `
    <div class="lt-view">
      <div class="ct-state ct-state--warn"><p>${escapeHtml(message)}</p></div>
    </div>`;
}

function renderWaiting(container, tab, attempt) {
  const isLg = /(^|\.)lg\.com/i.test(safeHost(tab?.url));
  if (!isLg) { renderEmpty(container, tab); return; }
  container.innerHTML = `
    <div class="lt-view">
      <div class="ct-state">
        <span class="ct-spinner"></span>
        <p>Esperando datos de la página…</p>
        <p class="ct-state-hint">Capturando la respuesta GraphQL automáticamente${attempt > 2 ? ` (intento ${attempt + 1})` : ''}.</p>
      </div>
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
            ? 'No se captó ninguna respuesta GraphQL en esta pestaña. Recargá o navegá una página de producto (PDP) en www.lg.com.'
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
// render principal de datos
// -----------------------------------------------------------------------------

function renderData(container, tab, captures, op) {
  const prevFilter = container.querySelector('#lg-filter')?.value || '';

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
          <span class="lg-head-right">
            <span id="lg-auto" class="lg-auto hidden"><span class="ct-spinner lg-auto-spin"></span>auto</span>
            <span class="lg-ts">${op.ts ? `captado ${formatTime(op.ts)}` : ''}</span>
          </span>
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
          <button type="button" id="lg-refresh" class="ct-btn ct-btn--primary lg-refresh" title="Volver a capturar">↻</button>
        </div>
        <div class="lg-copy-all">
          <button type="button" id="lg-copy-text" class="ct-btn ct-btn--ghost" title="Copiar todo como texto">Copiar todo</button>
          <button type="button" id="lg-copy-json" class="ct-btn ct-btn--ghost" title="Copiar respuesta JSON cruda">JSON</button>
        </div>

        <div id="lg-body" class="lg-body"></div>
      </section>
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
    displayedTs = null;
    displayedOp = null;
    showOperation(container, renderToken, tab, captures);
  });
  container.querySelector('#lg-refresh')?.addEventListener('click', () => render(container));
  container.querySelector('#lg-copy-json')?.addEventListener('click', (e) =>
    flashCopy(e.currentTarget, JSON.stringify(op.response, null, 2)));
  container.querySelector('#lg-copy-text')?.addEventListener('click', (e) =>
    flashCopy(e.currentTarget, groups ? groupsToText(groups) : JSON.stringify(op.response, null, 2)));

  const filter = container.querySelector('#lg-filter');
  if (filter) {
    filter.value = prevFilter;
    filter.addEventListener('input', () => applyFilter(body, filter.value));
    if (prevFilter) applyFilter(body, prevFilter);
  }

  log.info('render', { operation: selectedOperation, groups: groups?.length });
}

function setAutoIndicator(container, on) {
  const el = container.querySelector('#lg-auto');
  if (el) el.classList.toggle('hidden', !on);
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
    g.classList.toggle('hidden', Boolean(q) && visible === 0);
  });
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

async function flashCopy(btn, text) {
  const ok = await copyToClipboard(text);
  const hasIcon = btn.querySelector('svg');
  if (!hasIcon) {
    if (btn.dataset.label == null) btn.dataset.label = btn.textContent;
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

async function safeSend(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function safeHost(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}
