// "Revisión" de Revisar Destacados.
//
// El service worker hace el trabajo (abre pestañas de fondo EN PARALELO, lee el
// DOM renderizado) y persiste el progreso en STORAGE_KEYS.DESTACADOS_RUN. Esta
// vista solo refleja ese estado: total, cuántas faltan, qué página se está
// revisando ahora y los resultados por página/producto. Como lee de storage y
// escucha storage.onChanged, el estado sobrevive a cambiar de tab o cerrar el
// popup: al volver, muestra la corrida tal cual va.

import {
  DESTACADOS_URLS,
  MESSAGES,
  PAGE_STATUS,
  PRODUCT_ISSUE,
  STORAGE_KEYS,
} from '../../../constants.js';
import { getStorage } from '../../../../../shared/storage/storage.js';
import { toMessage } from '../../../../../shared/errors/index.js';
import { logger } from '../../../../../shared/utils/logger.js';
import { escapeHtml, formatTime } from '../../utils.js';

const log = logger('lgcom/popup');

let containerRef = null;
let storageListener = null;

export function render(container) {
  containerRef = container;
  renderShell(container);
  installStorageListener();

  getStorage(STORAGE_KEYS.DESTACADOS_RUN).then((run) => {
    if (containerRef !== container) return;
    if (run?.items) renderRun(container, run);
  });
}

function renderShell(container) {
  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Revisar destacados</h3>
        <p class="lt-hint">
          Revisa las ${DESTACADOS_URLS.length} categorías configuradas y marca los
          productos destacados que estén <strong>sin tag</strong> o <strong>sin stock</strong>.
          Abre cada categoría en una pestaña de fondo (varias a la vez); no
          necesita que tenga www.lg.com abierto.
        </p>
        <div class="lt-actions">
          <button type="button" id="lg-dest-run" class="ct-btn ct-btn--primary">Revisar ahora</button>
        </div>
      </section>
      <div id="lg-dest-results"></div>
    </div>`;

  container.querySelector('#lg-dest-run')?.addEventListener('click', () => runReview(container));
}

// Mantiene la vista al día con el progreso que escribe el service worker.
function installStorageListener() {
  if (storageListener) return;
  storageListener = (changes, area) => {
    if (area !== 'local') return;
    const change = changes[STORAGE_KEYS.DESTACADOS_RUN];
    if (!change || !containerRef?.isConnected) return;
    if (change.newValue?.items) renderRun(containerRef, change.newValue);
  };
  try { chrome.storage.onChanged.addListener(storageListener); } catch { /* noop */ }
}

async function runReview(container) {
  // El SW arranca y persiste el estado; la UI se actualiza por storage.onChanged.
  try {
    await chrome.runtime.sendMessage({ type: MESSAGES.RUN_DESTACADOS });
  } catch (err) {
    log.error('destacados: no se pudo iniciar', new Error(toMessage(err)));
    const results = container.querySelector('#lg-dest-results');
    if (results) {
      results.innerHTML = `
        <div class="ct-state ct-state--warn">
          <p>No se pudo iniciar la revisión.</p>
          <p class="ct-state-hint">${escapeHtml(toMessage(err))}</p>
        </div>`;
    }
  }
}

// -----------------------------------------------------------------------------
// render del estado de la corrida
// -----------------------------------------------------------------------------

function renderRun(container, run) {
  const results = container.querySelector('#lg-dest-results');
  const btn = container.querySelector('#lg-dest-run');
  if (!results) return;

  const items = run.items || [];
  const active = Boolean(run.active);

  // Botón: deshabilitado mientras corre.
  if (btn) {
    btn.disabled = active;
    btn.textContent = active ? 'Revisando…' : 'Revisar de nuevo';
  }

  if (!items.length) {
    results.innerHTML = `<p class="ct-empty">No hay categorías configuradas.</p>`;
    return;
  }

  const done = run.doneCount ?? items.filter((it) => isTerminal(it.status)).length;
  const total = run.total ?? items.length;
  const okCount = items.filter((it) => it.status === PAGE_STATUS.OK).length;
  const issueCount = items.filter((it) => it.status === PAGE_STATUS.ISSUES).length;
  const otherCount = items.filter((it) =>
    it.status === PAGE_STATUS.NO_SPOTLIGHT || it.status === PAGE_STATUS.ERROR).length;

  const pct = total ? Math.round((done / total) * 100) : 0;

  const head = active
    ? `
      <div class="lg-dest-progress">
        <div class="lg-dest-progress-top">
          <span><span class="ct-spinner lg-dest-spin"></span>Revisando ${done}/${total} categorías…</span>
        </div>
        <div class="lg-dest-bar"><span style="width:${pct}%"></span></div>
      </div>`
    : `
      ${run.finishedAt ? `<p class="lg-dest-stamp">Última revisión: ${escapeHtml(formatTime(run.finishedAt))} (${run.trigger === 'auto' ? 'automática' : 'manual'})</p>` : ''}
      <div class="lg-dest-summary">
        <span class="lg-dest-chip lg-dest-chip--ok">${okCount} OK</span>
        <span class="lg-dest-chip lg-dest-chip--bad">${issueCount} con problemas</span>
        ${otherCount ? `<span class="lg-dest-chip lg-dest-chip--other">${otherCount} sin datos</span>` : ''}
      </div>`;

  results.innerHTML = `
    ${head}
    <ul class="lg-dest-pages">
      ${items.map(renderItem).join('')}
    </ul>`;
}

function isTerminal(status) {
  return status === PAGE_STATUS.OK || status === PAGE_STATUS.ISSUES ||
    status === PAGE_STATUS.NO_SPOTLIGHT || status === PAGE_STATUS.ERROR;
}

function renderItem(item) {
  const title = escapeHtml(item.label || item.url);
  const linkUrl = escapeHtml(item.url);

  let badge;
  let body = '';

  switch (item.status) {
    case PAGE_STATUS.PENDING:
      badge = `<span class="lg-dest-status lg-dest-status--pending">En cola</span>`;
      break;
    case PAGE_STATUS.CHECKING:
      badge = `<span class="lg-dest-status lg-dest-status--checking"><span class="ct-spinner lg-dest-spin"></span>Revisando…</span>`;
      break;
    case PAGE_STATUS.OK:
      badge = `<span class="lg-dest-status lg-dest-status--ok">Todo bien</span>`;
      body = `<p class="lg-dest-note lg-dest-note--ok">Los ${item.spotlightCount} destacados tienen tag y stock.</p>`;
      break;
    case PAGE_STATUS.ISSUES: {
      const bad = (item.products || []).filter((p) => p.issues?.length);
      badge = `<span class="lg-dest-status lg-dest-status--bad">${bad.length} con problemas</span>`;
      body = `<ul class="lg-dest-prods">${bad.map(renderProduct).join('')}</ul>`;
      break;
    }
    case PAGE_STATUS.NO_SPOTLIGHT:
      badge = `<span class="lg-dest-status lg-dest-status--other">Sin destacados</span>`;
      body = `<p class="lg-dest-note">No se encontró el recuadro de destacados en esta página.</p>`;
      break;
    default: // ERROR
      badge = `<span class="lg-dest-status lg-dest-status--err">Error</span>`;
      body = `<p class="lg-dest-note lg-dest-note--err">${escapeHtml(item.error || 'No se pudo leer la página.')}</p>`;
  }

  return `
    <li class="lg-dest-page lg-dest-page--${item.status}">
      <div class="lg-dest-page-head">
        <a class="lg-dest-page-title" href="${linkUrl}" target="_blank" rel="noopener" title="${linkUrl}">${title}</a>
        ${badge}
      </div>
      ${body}
    </li>`;
}

function renderProduct(p) {
  const name = escapeHtml(p.modelName || p.sku || 'Producto');
  const sku = p.sku ? `<span class="lg-dest-prod-sku">${escapeHtml(p.sku)}</span>` : '';
  const flags = (p.issues || []).map((i) => {
    if (i === PRODUCT_ISSUE.NO_TAG) return `<span class="lg-dest-flag lg-dest-flag--tag">Sin tag</span>`;
    if (i === PRODUCT_ISSUE.NO_STOCK) return `<span class="lg-dest-flag lg-dest-flag--stock">Sin stock</span>`;
    return '';
  }).join('');
  return `
    <li class="lg-dest-prod">
      <span class="lg-dest-prod-name">${name} ${sku}</span>
      <span class="lg-dest-flags">${flags}</span>
    </li>`;
}
