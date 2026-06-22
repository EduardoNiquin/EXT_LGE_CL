// "Revisión" de Revisar Destacados.
//
// Pide al content script (pestaña de www.lg.com) que revise el recuadro de
// destacados de cada categoría configurada y reporta, por página, qué productos
// quedaron sin tag o sin stock — y qué páginas están todas bien.
//
// El último resultado (manual o de la revisión automática de fondo) se guarda
// en storage, así que al abrir el popup se muestra lo último revisado y se
// actualiza en vivo cuando la revisión automática corre en una pestaña.

import {
  DESTACADOS_URLS,
  MESSAGES,
  PAGE_STATUS,
  PRODUCT_ISSUE,
  STORAGE_KEYS,
} from '../../../constants.js';
import { sendMessageToActiveTab } from '../../../../../shared/messaging/messaging.js';
import { getStorage, setStorage } from '../../../../../shared/storage/storage.js';
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

  getStorage(STORAGE_KEYS.DESTACADOS_LAST).then((last) => {
    if (containerRef !== container) return;
    if (last?.results) renderResults(container, last);
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
          Abra una pestaña de www.lg.com para poder revisar.
        </p>
        <div class="lt-actions">
          <button type="button" id="lg-dest-run" class="ct-btn ct-btn--primary">Revisar ahora</button>
        </div>
      </section>
      <div id="lg-dest-results"></div>
    </div>`;

  container.querySelector('#lg-dest-run')?.addEventListener('click', () => runReview(container));
}

// Actualiza la vista en vivo cuando la revisión automática (u otra pestaña)
// guarda un nuevo resultado.
function installStorageListener() {
  if (storageListener) return;
  storageListener = (changes, area) => {
    if (area !== 'local') return;
    const change = changes[STORAGE_KEYS.DESTACADOS_LAST];
    if (!change || !containerRef?.isConnected) return;
    if (change.newValue?.results) renderResults(containerRef, change.newValue);
  };
  try { chrome.storage.onChanged.addListener(storageListener); } catch { /* noop */ }
}

async function runReview(container) {
  const btn = container.querySelector('#lg-dest-run');
  const results = container.querySelector('#lg-dest-results');
  if (btn) { btn.disabled = true; btn.textContent = 'Revisando…'; }
  results.innerHTML = `
    <div class="ct-state">
      <span class="ct-spinner"></span>
      <p>Revisando ${DESTACADOS_URLS.length} categorías…</p>
    </div>`;

  try {
    const res = await sendMessageToActiveTab({
      type: MESSAGES.CHECK_SPOTLIGHTS,
      urls: DESTACADOS_URLS,
    });
    if (!res?.ok) throw new Error(res?.reason || 'No se pudo revisar.');
    const last = { ranAt: Date.now(), trigger: 'manual', results: res.results || [] };
    await setStorage(STORAGE_KEYS.DESTACADOS_LAST, last);
    renderResults(container, last);
  } catch (err) {
    log.error('destacados: revisión fallida', new Error(toMessage(err)));
    renderError(results, err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Revisar de nuevo'; }
  }
}

function renderError(results, err) {
  results.innerHTML = `
    <div class="ct-state ct-state--warn">
      <p>No se pudo revisar.</p>
      <p class="ct-state-hint">
        Abra una pestaña de <strong>www.lg.com</strong> y vuelva a intentar.
      </p>
      <p class="ct-state-hint">${escapeHtml(toMessage(err))}</p>
    </div>`;
}

// -----------------------------------------------------------------------------
// render de resultados
// -----------------------------------------------------------------------------

function renderResults(container, last) {
  const results = container.querySelector('#lg-dest-results');
  if (!results) return;
  const pages = last.results || [];

  if (!pages.length) {
    results.innerHTML = `<p class="ct-empty">No hay categorías configuradas.</p>`;
    return;
  }

  const okCount = pages.filter((p) => p.status === PAGE_STATUS.OK).length;
  const issueCount = pages.filter((p) => p.status === PAGE_STATUS.ISSUES).length;
  const otherCount = pages.length - okCount - issueCount;

  // Páginas con problemas primero (lo importante), luego OK, luego el resto.
  const order = { [PAGE_STATUS.ISSUES]: 0, [PAGE_STATUS.OK]: 1, [PAGE_STATUS.NO_SPOTLIGHT]: 2, [PAGE_STATUS.ERROR]: 3 };
  const sorted = [...pages].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  const stamp = last.ranAt
    ? `Última revisión: ${formatTime(last.ranAt)} (${last.trigger === 'auto' ? 'automática' : 'manual'})`
    : '';

  results.innerHTML = `
    ${stamp ? `<p class="lg-dest-stamp">${escapeHtml(stamp)}</p>` : ''}
    <div class="lg-dest-summary">
      <span class="lg-dest-chip lg-dest-chip--ok">${okCount} OK</span>
      <span class="lg-dest-chip lg-dest-chip--bad">${issueCount} con problemas</span>
      ${otherCount ? `<span class="lg-dest-chip lg-dest-chip--other">${otherCount} sin datos</span>` : ''}
    </div>
    <ul class="lg-dest-pages">
      ${sorted.map(renderPage).join('')}
    </ul>`;
}

function renderPage(page) {
  const title = escapeHtml(page.label || page.url);
  const linkUrl = escapeHtml(page.url);

  let badge;
  let body;

  if (page.status === PAGE_STATUS.OK) {
    badge = `<span class="lg-dest-status lg-dest-status--ok">Todo bien</span>`;
    body = `<p class="lg-dest-note lg-dest-note--ok">Los ${page.spotlightCount} destacados tienen tag y stock.</p>`;
  } else if (page.status === PAGE_STATUS.ISSUES) {
    const bad = page.products.filter((p) => p.issues.length);
    badge = `<span class="lg-dest-status lg-dest-status--bad">${bad.length} con problemas</span>`;
    body = `<ul class="lg-dest-prods">${bad.map(renderProduct).join('')}</ul>`;
  } else if (page.status === PAGE_STATUS.NO_SPOTLIGHT) {
    badge = `<span class="lg-dest-status lg-dest-status--other">Sin destacados</span>`;
    body = `<p class="lg-dest-note">No se encontró el recuadro de destacados en esta página.</p>`;
  } else {
    badge = `<span class="lg-dest-status lg-dest-status--err">Error</span>`;
    body = `<p class="lg-dest-note lg-dest-note--err">${escapeHtml(page.error || 'No se pudo leer la página.')}</p>`;
  }

  return `
    <li class="lg-dest-page lg-dest-page--${page.status}">
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
  const flags = p.issues.map((i) => {
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
