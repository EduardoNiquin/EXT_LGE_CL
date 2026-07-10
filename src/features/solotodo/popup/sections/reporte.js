// UI de "SoloTodo — Generar reporte".
//
// El usuario elige una categoría (por ahora solo "Televisores"), opcionalmente
// activa el modo simulación (llena el form pero NO clickea "Generar"), y presiona
// Iniciar. Se escribe un `run` en storage con la config resuelta; el content
// script en la pestaña del backoffice lo ejecuta. Progreso en vivo por storage.

import { CATEGORIES, DEFAULT_CATEGORY_ID, HOST, REPORT_PATH, getCategory } from '../../constants.js';
import { getDraft, getRun, makeRun, setDraft, setRun } from '../../state.js';
import { logger } from '../../../../shared/utils/logger.js';
import { buildFilename, escapeHtml } from '../utils.js';
import { progressHtml, renderProgress, toggleButtons, wireRunControls } from '../run-ui.js';

const log = logger('solotodo');

const ui = {
  categoryId: DEFAULT_CATEGORY_ID,
  dryRun: false,
};

export async function render(container) {
  const draft = await getDraft();
  if (draft) {
    if (getCategory(draft.categoryId)) ui.categoryId = draft.categoryId;
    ui.dryRun = Boolean(draft.dryRun);
  }

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">SoloTodo — Generar reporte</h3>
        <p class="lt-hint">
          Abra <strong>backoffice.solotodo.com/reports/current_prices</strong> y presione
          <strong>Iniciar</strong>. La extensión clickea <strong>Exportar</strong>, completa
          los campos de la categoría elegida y presiona <strong>Generar</strong> (el archivo
          llega por correo).
        </p>

        <div class="dt-field">
          <label class="dt-label" for="st-category">Categoría</label>
          <select id="st-category" class="dt-input">
            ${CATEGORIES.map((c) => `
              <option value="${escapeHtml(c.id)}" ${c.id === ui.categoryId ? 'selected' : ''}>${escapeHtml(c.label)}</option>
            `).join('')}
          </select>
        </div>

        <div id="st-summary" class="lt-hint"></div>

        <label class="dt-check">
          <input type="checkbox" id="st-dryrun" ${ui.dryRun ? 'checked' : ''}>
          <span><strong>Modo simulación</strong> — llena el formulario pero NO presiona "Generar" (útil para revisar)</span>
        </label>

        <div class="lt-actions">
          <button type="button" id="st-start" class="ct-btn ct-btn--primary">Iniciar</button>
          <button type="button" id="st-stop"  class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="st-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      ${progressHtml()}
    </div>
  `;

  container.querySelector('#st-category').addEventListener('change', (e) => {
    ui.categoryId = e.target.value;
    persistDraft();
    renderSummary(container);
  });
  container.querySelector('#st-dryrun').addEventListener('change', (e) => {
    ui.dryRun = e.target.checked;
    persistDraft();
  });
  container.querySelector('#st-start').addEventListener('click', () => onStart(container));

  renderSummary(container);
  const run = await getRun();
  if (run) renderProgress(container, run);
  toggleButtons(container, run);
  wireRunControls(container);
}

function persistDraft() {
  setDraft({ categoryId: ui.categoryId, dryRun: ui.dryRun }).catch(() => {});
}

function renderSummary(container) {
  const box = container.querySelector('#st-summary');
  if (!box) return;
  const cat = getCategory(ui.categoryId);
  if (!cat) { box.innerHTML = ''; return; }
  box.innerHTML = `
    Se seleccionará:
    <ul class="st-summary-list">
      <li><strong>Categoría:</strong> ${escapeHtml(cat.category)}</li>
      <li><strong>Moneda:</strong> ${escapeHtml(cat.currency)}</li>
      <li><strong>Tiendas:</strong> ${cat.stores.length}</li>
      <li><strong>Países:</strong> ${escapeHtml(cat.countries.join(', '))}</li>
      <li><strong>Nombre de archivo:</strong> <code>${escapeHtml(buildFilename(cat.filenamePrefix))}</code></li>
    </ul>
  `;
}

function resolveConfig() {
  const cat = getCategory(ui.categoryId);
  if (!cat) return null;
  return {
    categoryId: cat.id,
    categoryLabel: cat.label,
    category: cat.category,
    currency: cat.currency,
    stores: [...cat.stores],
    countries: [...cat.countries],
    filename: buildFilename(cat.filenamePrefix),
    dryRun: ui.dryRun,
  };
}

async function onStart(container) {
  const config = resolveConfig();
  if (!config) { alert('Categoría no válida.'); return; }

  const run = await getRun();
  if (run?.active) { alert('Ya hay un proceso en curso.'); return; }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onReportPage = tab?.url && tab.url.includes(HOST) && tab.url.includes(REPORT_PATH);
  if (!onReportPage) {
    if (!confirm(`La pestaña activa no parece ser ${HOST}${REPORT_PATH}. ¿Iniciar igual?`)) return;
  }

  const modo = config.dryRun ? ' (modo simulación: no se presionará "Generar")' : '';
  if (!confirm(`Se llenará el formulario de "${config.categoryLabel}" en la pestaña activa${modo}. ¿Continuar?`)) return;

  const newRun = makeRun({ config, message: `Run iniciado — ${config.categoryLabel}` });
  await setRun(newRun);
  log.info('run lanzado', { category: config.categoryId, dryRun: config.dryRun });
  renderProgress(container, newRun);
  toggleButtons(container, newRun);
}
