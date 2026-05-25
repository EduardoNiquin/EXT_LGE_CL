import { MESSAGES } from '../constants.js';
import { sendMessageToActiveTab } from '../../../shared/messaging/messaging.js';
import { logger } from '../../../shared/utils/logger.js';

const log = logger('colocar-tags/popup');

export function render(container) {
  container.innerHTML = `
    <div class="ct-view">
      <div id="ct-state" class="ct-state ct-state--loading">
        <span class="ct-spinner"></span>
        <p>Leyendo página de GP1...</p>
      </div>
      <div id="ct-data" class="ct-data hidden"></div>
      <div class="ct-actions">
        <button id="ct-reload" class="ct-btn ct-btn--ghost">Volver a leer</button>
      </div>
    </div>
  `;

  container.querySelector('#ct-reload').addEventListener('click', loadPageData);
  loadPageData();
}

async function loadPageData() {
  const stateEl = document.getElementById('ct-state');
  const dataEl  = document.getElementById('ct-data');

  stateEl.className = 'ct-state ct-state--loading';
  stateEl.innerHTML = '<span class="ct-spinner"></span><p>Leyendo página de GP1...</p>';
  dataEl.classList.add('hidden');

  try {
    const response = await sendMessageToActiveTab({ type: MESSAGES.GET_PAGE_DATA });

    if (!response?.ok) {
      log.warn('detección falló', response);
      stateEl.className = 'ct-state ct-state--warn';
      stateEl.innerHTML = `
        <p>${escapeHtml(response?.reason || 'No se pudo leer la página.')}</p>
        ${response?.diag ? renderDiag(response.diag) : ''}
      `;
      return;
    }
    log.info('detección OK', { rows: response.data?.grid?.rows?.length, frame: response.frame });

    stateEl.classList.add('hidden');
    dataEl.classList.remove('hidden');
    renderData(dataEl, response.data);
  } catch (err) {
    stateEl.className = 'ct-state ct-state--error';
    stateEl.innerHTML = `<p>Error: ${err.message}</p><p class="ct-state-hint">Asegúrate de tener la pestaña de GP1 abierta y refresca la página.</p>`;
  }
}

function renderData(container, data) {
  const { searchForm, grid } = data;

  const appliedFilters = Object.entries(searchForm).filter(([, v]) => v);
  const filtersHTML = appliedFilters.length
    ? appliedFilters
        .map(([k, v]) => `
          <div class="ct-filter">
            <span class="ct-filter-key">${labelOf(k)}</span>
            <span class="ct-filter-val">${escapeHtml(String(v))}</span>
          </div>
        `).join('')
    : '<p class="ct-empty">Sin filtros aplicados.</p>';

  const rowsHTML = grid.rows.length
    ? grid.rows.map(rowCard).join('')
    : '<p class="ct-empty">El listado está vacío. Realiza una búsqueda en GP1.</p>';

  container.innerHTML = `
    <section class="ct-section">
      <h3 class="ct-section-title">
        Filtros de búsqueda
        <span class="ct-section-meta">${appliedFilters.length}</span>
      </h3>
      <div class="ct-filters">${filtersHTML}</div>
    </section>

    <section class="ct-section">
      <h3 class="ct-section-title">
        Productos <span class="ct-tab-badge">${grid.activeTab}</span>
        <span class="ct-section-meta">${grid.rows.length} en lista · ${grid.totals.selected} seleccionado(s)</span>
      </h3>
      <div class="ct-rows">${rowsHTML}</div>
    </section>
  `;
}

function rowCard(r) {
  const status = (r.modelStatus || '').toLowerCase();
  return `
    <article class="ct-row ${r.isSelected ? 'ct-row--selected' : ''}">
      <header class="ct-row-head">
        <span class="ct-row-num">#${r.rowIndex ?? '-'}</span>
        <span class="ct-pill ct-pill--${status}">${escapeHtml(r.modelStatus || '—')}</span>
        <span class="ct-pill ct-pill--type">${escapeHtml(r.modelType || '—')}</span>
        ${r.isSelected ? '<span class="ct-pill ct-pill--check">✓</span>' : ''}
      </header>
      <dl class="ct-row-body">
        <div><dt>Sales Model</dt><dd>${escapeHtml(r.salesModel)}</dd></div>
        <div><dt>Model Name</dt><dd>${escapeHtml(r.modelName)}</dd></div>
        <div><dt>Product ID</dt><dd>${escapeHtml(r.productId)}</dd></div>
        <div><dt>PIM SKU</dt><dd>${escapeHtml(r.pimSku)}</dd></div>
        <div><dt>Categoría</dt><dd>${escapeHtml([r.superCategory, r.category, r.subCategory].filter(Boolean).join(' / '))}</dd></div>
        <div><dt>Publish</dt><dd>${escapeHtml(r.publish)}</dd></div>
      </dl>
      <footer class="ct-row-foot">
        <span class="ct-row-meta">editIndex: <code>${r.editIndex ?? '—'}</code> · rowId: <code>${r.rowId ?? '—'}</code></span>
      </footer>
    </article>
  `;
}

function labelOf(key) {
  const labels = {
    site:          'Site',
    superCategory: 'Super Category',
    category:      'Category',
    subCategory:   'Sub Category',
    salesModel:    'Sales Model',
    modelName:     'Model Name',
    productId:     'Product ID',
    modelStatus:   'Model Status',
    modelType:     'Model Type',
    promotionId:   'Promotion ID',
    publish:       'Publish',
  };
  return labels[key] || key;
}

function renderDiag(diag) {
  const selRows = Object.entries(diag.selectors || {}).map(([key, info]) => `
    <tr>
      <td>${info.present ? '✓' : '✗'}</td>
      <td><code>${escapeHtml(key)}</code></td>
      <td><code>${escapeHtml(info.selector)}</code></td>
    </tr>
  `).join('');

  const iframesList = (diag.iframes || []).length
    ? `<ul class="ct-diag-iframes">${
        diag.iframes.map(f => `
          <li>
            ${f.id ? `<code>#${escapeHtml(f.id)}</code> ` : ''}
            ${f.name ? `<code>name=${escapeHtml(f.name)}</code> ` : ''}
            <span class="ct-diag-src">${escapeHtml(f.src || '')}</span>
          </li>
        `).join('')
      }</ul>`
    : '<p class="ct-empty">No hay iframes en este frame.</p>';

  return `
    <details class="ct-diag" open>
      <summary>Diagnóstico</summary>
      <div class="ct-diag-body">
        <p><strong>URL:</strong> <code>${escapeHtml(diag.url || '')}</code></p>
        <p><strong>Frame:</strong> ${diag.isTopFrame ? 'top' : 'iframe'} · <strong>iframes hijos:</strong> ${diag.iframeCount ?? 0}</p>
        <p><strong>Faltantes:</strong> ${diag.missing?.length ? diag.missing.map(m => `<code>${escapeHtml(m)}</code>`).join(', ') : '—'}</p>
        <table class="ct-diag-table">
          <thead><tr><th></th><th>Clave</th><th>Selector</th></tr></thead>
          <tbody>${selRows}</tbody>
        </table>
        <p><strong>Iframes:</strong></p>
        ${iframesList}
        <p class="ct-state-hint">
          Debug rápido: en GP1 abre DevTools (F12) → consola → cambia el contexto a <code>EXT LGE CL</code> →
          tipea <code>__extLgeCl.help()</code>.
        </p>
      </div>
    </details>
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
