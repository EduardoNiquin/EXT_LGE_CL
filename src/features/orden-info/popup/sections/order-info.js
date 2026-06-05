// Sección "Información de Orden".
//
// - Buscador: navega la pestaña activa al listado de órdenes de Magento, deja
//   la búsqueda en storage (el content aplica el fulltext y abre la orden).
// - Detalle: hace polling de la pestaña activa (mensaje GET_ORDER_DATA) y, si
//   está en el detalle de una orden, muestra la info ordenada en grupos +
//   alertas con el motivo de aprobación/rechazo del pago.
//
// Reusa las clases .lt-* / .lg-* / .ct-* de popup.css; agrega algunas .oi-*.

import {
  DEFAULT_ADMIN_BASE,
  MESSAGES,
  ORDERS_LISTING_PATH,
  SEARCH_STATUS,
  STORAGE_KEYS,
} from '../../constants.js';
import { getLastQuery, setLastQuery, setSearch } from '../../state.js';
import { logger } from '../../../../shared/utils/logger.js';
import {
  copyToClipboard,
  escapeHtml,
  groupsToText,
  groupToText,
} from '../utils.js';

const log = logger('orden-info');

const POLL_INTERVAL = 900;
const POLL_MAX_IDLE = 12;   // ~11s en reposo
const POLL_MAX_SEARCH = 40; // ~36s tras disparar una búsqueda (cubre navegación)

let renderToken = 0;
let pollTimer = null;
let pollMax = POLL_MAX_IDLE;
let displayedOrder = null;

export async function render(container) {
  renderToken += 1;
  const token = renderToken;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  displayedOrder = null;

  const lastQuery = await getLastQuery();

  container.innerHTML = `
    <div class="lt-view lg-view oi-view">
      <section class="lt-form-card oi-search-card">
        <h3 class="lt-section-title">Información de Orden</h3>
        <p class="lt-hint">Buscá una orden por su número (Magento) o abrí una orden para ver su detalle.</p>
        <div class="oi-search-row">
          <div class="search-wrapper oi-search-input">
            <svg class="search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.6"/>
              <path d="M13 13l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <input type="text" id="oi-query" class="search-input" placeholder="Número de orden…"
                   value="${escapeHtml(lastQuery)}" autocomplete="off" spellcheck="false" inputmode="numeric" />
          </div>
          <button type="button" id="oi-search" class="ct-btn ct-btn--primary oi-search-btn">Buscar</button>
          <button type="button" id="oi-refresh" class="ct-btn ct-btn--ghost oi-refresh-btn" title="Detectar la orden abierta en la pestaña">Actualizar</button>
        </div>
        <p id="oi-search-msg" class="oi-msg hidden"></p>
      </section>
      <div id="oi-body" class="lg-body oi-body"></div>
    </div>`;

  const input = container.querySelector('#oi-query');
  const btn = container.querySelector('#oi-search');
  btn.addEventListener('click', () => onSearch(container));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSearch(container); });
  container.querySelector('#oi-refresh').addEventListener('click', () => {
    pollMax = POLL_MAX_IDLE;
    render(container); // reinicia el polling y re-lee la pestaña activa al instante
  });

  poll(container, token, 0);
}

// -----------------------------------------------------------------------------
// búsqueda → navegación
// -----------------------------------------------------------------------------

async function onSearch(container) {
  const input = container.querySelector('#oi-query');
  const orderNumber = String(input.value || '').trim();
  if (!orderNumber) {
    showMsg(container, 'Ingresá un número de orden.', 'warn');
    return;
  }

  await setLastQuery(orderNumber);

  const tab = await getActiveTab();
  const adminBase = deriveAdminBase(tab?.url);
  const listingUrl = `${adminBase}${ORDERS_LISTING_PATH}`;

  await setSearch({
    active: true,
    orderNumber,
    status: SEARCH_STATUS.PENDING,
    startedAt: Date.now(),
    finishedAt: null,
  });

  showMsg(container, `Buscando la orden ${orderNumber}…`, 'info');

  try {
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { url: listingUrl });
    }
  } catch (err) {
    log.warn('no se pudo navegar la pestaña', err);
    showMsg(container, 'No se pudo navegar a Magento. Abrí el admin e intentá de nuevo.', 'warn');
    return;
  }

  // Ampliar la ventana de polling para cubrir la navegación + carga del grid.
  pollMax = POLL_MAX_SEARCH;
  render(container);
}

function deriveAdminBase(url) {
  if (url) {
    const m = url.match(/^(https?:\/\/[^/]+\/[^/]*obsadm)\//i);
    if (m) return m[1];
  }
  return DEFAULT_ADMIN_BASE;
}

// -----------------------------------------------------------------------------
// polling de la orden
// -----------------------------------------------------------------------------

async function poll(container, token, attempt) {
  if (token !== renderToken) return;

  const tab = await getActiveTab();
  if (token !== renderToken) return;

  const res = tab?.id ? await safeSend(tab.id, { type: MESSAGES.GET_ORDER_DATA }) : null;
  if (token !== renderToken) return;

  if (res?.ok && res.data) {
    if (res.data.orderNumber !== displayedOrder) {
      renderData(container, res.data);
      displayedOrder = res.data.orderNumber;
      hideMsg(container);
    }
    pollMax = POLL_MAX_IDLE;
    schedule(container, token, attempt, true);
    return;
  }

  // Sin orden todavía: ¿hay una búsqueda en curso?
  const search = await getStoredSearch();
  if (token !== renderToken) return;

  if (search?.active) {
    showMsg(container, `Buscando la orden ${escapeHtml(search.orderNumber)}…`, 'info');
    renderWaiting(container);
    schedule(container, token, attempt, false);
    return;
  }
  if (search && search.status === SEARCH_STATUS.NOT_FOUND) {
    showMsg(container, `No se encontró la orden ${escapeHtml(search.orderNumber)}.`, 'warn');
  } else if (search && search.status === SEARCH_STATUS.ERROR) {
    showMsg(container, search.error || 'Error al buscar la orden.', 'warn');
  }

  renderIdle(container, tab, res);
  schedule(container, token, attempt, false);
}

function schedule(container, token, attempt, idle) {
  const max = idle ? POLL_MAX_IDLE : pollMax;
  if (attempt < max) {
    pollTimer = setTimeout(() => poll(container, token, attempt + 1), POLL_INTERVAL);
  }
}

// -----------------------------------------------------------------------------
// render de estados
// -----------------------------------------------------------------------------

function renderWaiting(container) {
  if (displayedOrder) return; // ya hay una orden mostrada; no la pisamos
  const body = container.querySelector('#oi-body');
  if (!body) return;
  body.innerHTML = `
    <div class="ct-state">
      <span class="ct-spinner"></span>
      <p>Buscando y abriendo la orden…</p>
    </div>`;
}

function renderIdle(container, tab, res) {
  if (displayedOrder) return;
  const body = container.querySelector('#oi-body');
  if (!body) return;

  const isMagento = /\/(obsadm|admin)\//i.test(tab?.url || '') || /\/sales\/order\//i.test(tab?.url || '');
  let msg;
  if (res && !res.ok && res.diag?.page === 'listing') {
    msg = 'Estás en el listado de órdenes. Buscá una orden arriba o hacé click en una fila.';
  } else if (isMagento) {
    msg = 'Abrí el detalle de una orden en Magento para ver su información, o usá el buscador.';
  } else {
    msg = 'Abrí Magento (admin de órdenes) en esta pestaña para usar esta función.';
  }
  body.innerHTML = `
    <section class="lt-form-card">
      <p class="lt-hint">${escapeHtml(msg)}</p>
    </section>`;
}

// -----------------------------------------------------------------------------
// render de datos
// -----------------------------------------------------------------------------

function renderData(container, data) {
  const body = container.querySelector('#oi-body');
  if (!body) return;

  const alertsHtml = (data.alerts || []).map((a) => `
    <div class="oi-alert oi-alert--${escapeHtml(a.level)}">
      <span class="oi-alert-title">${escapeHtml(a.title)}</span>
      <span class="oi-alert-msg">${escapeHtml(a.message)}</span>
    </div>`).join('');

  const groupsHtml = (data.groups || []).map((g) => `
    <details class="lg-group" open data-group="${escapeHtml(g.id)}">
      <summary class="lg-group-head">
        <span class="lg-group-title">${escapeHtml(g.label)}</span>
        <button type="button" class="lg-copy-group" data-group="${escapeHtml(g.id)}" title="Copiar este grupo">Copiar</button>
      </summary>
      <ul class="lg-fields">
        ${g.fields.map((f) => `
          <li class="lg-field" data-search="${escapeHtml((f.label + ' ' + f.value).toLowerCase())}">
            <span class="lg-field-label">${escapeHtml(f.label)}</span>
            <span class="lg-field-value">${escapeHtml(f.value)}</span>
            <button type="button" class="lg-copy-field" data-raw="${escapeHtml(f.raw)}" title="Copiar valor" aria-label="Copiar ${escapeHtml(f.label)}">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" width="16" height="16">
                <rect x="5" y="5" width="8" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            </button>
          </li>`).join('')}
      </ul>
    </details>`).join('');

  body.innerHTML = `
    <div class="oi-head">
      <strong class="oi-head-title">Orden #${escapeHtml(data.orderNumber || '—')}</strong>
      ${data.status ? `<span class="oi-head-status">${escapeHtml(data.status)}</span>` : ''}
    </div>
    ${alertsHtml ? `<div class="oi-alerts">${alertsHtml}</div>` : ''}
    <div class="lg-toolbar oi-toolbar">
      <div class="search-wrapper lg-search">
        <svg class="search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.6"/>
          <path d="M13 13l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
        <input type="text" id="oi-filter" class="search-input" placeholder="Filtrar campos…" autocomplete="off" spellcheck="false" />
      </div>
      <button type="button" id="oi-copy-all" class="ct-btn ct-btn--ghost" title="Copiar todo como texto">Copiar todo</button>
    </div>
    <div id="oi-groups" class="lg-body">${groupsHtml}</div>`;

  wireData(body, data);
}

function wireData(body, data) {
  body.querySelectorAll('.lg-copy-field').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.preventDefault(); flashCopy(btn, btn.dataset.raw); });
  });
  body.querySelectorAll('.lg-copy-group').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const g = data.groups.find((x) => x.id === btn.dataset.group);
      if (g) flashCopy(btn, groupToText(g));
    });
  });
  body.querySelector('#oi-copy-all')?.addEventListener('click', (e) =>
    flashCopy(e.currentTarget, groupsToText(data.groups || [])));

  const filter = body.querySelector('#oi-filter');
  filter?.addEventListener('input', () => applyFilter(body, filter.value));
}

function applyFilter(body, query) {
  const q = String(query || '').trim().toLowerCase();
  body.querySelectorAll('.lg-field').forEach((li) => {
    const hit = !q || (li.dataset.search || '').includes(q);
    li.classList.toggle('hidden', !hit);
  });
  body.querySelectorAll('.lg-group').forEach((g) => {
    const visible = g.querySelectorAll('.lg-field:not(.hidden)').length;
    g.classList.toggle('hidden', Boolean(q) && visible === 0);
  });
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function showMsg(container, text, kind) {
  const el = container.querySelector('#oi-search-msg');
  if (!el) return;
  el.textContent = text;
  el.className = `oi-msg oi-msg--${kind}`;
}

function hideMsg(container) {
  const el = container.querySelector('#oi-search-msg');
  if (el) el.className = 'oi-msg hidden';
}

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
  try { return await chrome.tabs.sendMessage(tabId, message); }
  catch { return null; }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getStoredSearch() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SEARCH);
    return result[STORAGE_KEYS.SEARCH] || null;
  } catch {
    return null;
  }
}
