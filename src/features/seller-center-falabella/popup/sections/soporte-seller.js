// UI de "SoporteSeller — Detalle Orden".
//
// El usuario carga un CSV (subiendo un archivo o pegando texto), ve una
// previsualización de las primeras filas y el total de "Detalle Orden" que se
// crearán (aplicando la regla de múltiples Nro Guia). Al Iniciar se escribe un
// `run` en storage; el content script en la pestaña de Soporte lo ejecuta.
// Progreso en vivo vía storage.onChanged.

import { COLUMNS } from '../../constants.js';
import { getDraft, getRun, makeRun, setDraft, setRun } from '../../state.js';
import { logger } from '../../../../shared/utils/logger.js';
import { debounce } from '../../../../shared/ui/persist.js';
import { buildDetalles, escapeHtml, parseCsv } from '../utils.js';
import { progressHtml, renderProgress, toggleButtons, wireRunControls } from '../run-ui.js';

const log = logger('seller-center-falabella');

const PREVIEW_ROWS = 4;

// Estado local de la vista (no se persiste salvo el borrador).
const ui = {
  mode: 'file',     // 'file' | 'paste'
  text: '',         // contenido CSV crudo (de archivo o pegado)
  fileName: '',
  result: null,     // { detalles, errors, dataRowCount }
};

export async function render(container) {
  const draft = await getDraft();
  if (draft) {
    ui.mode = draft.mode === 'paste' ? 'paste' : 'file';
    ui.text = typeof draft.text === 'string' ? draft.text : '';
    ui.fileName = draft.fileName || '';
  }

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">SoporteSeller — Detalle Orden</h3>
        <p class="lt-hint">
          Completa automáticamente los <strong>"Detalle Orden"</strong> en la página de Soporte del
          Seller Center. Abrí la página y configurá los campos hasta que el formulario
          "Detalle Orden" sea visible; recién entonces presioná <strong>Iniciar</strong>.
          La extensión sólo completa los campos: revisá y guardá manualmente en el sitio.
        </p>

        <div class="scf-mode-row" role="tablist">
          <button type="button" class="scf-mode-btn" data-mode="file">Subir archivo CSV</button>
          <button type="button" class="scf-mode-btn" data-mode="paste">Pegar texto</button>
        </div>

        <div class="lt-hint scf-cols-hint">
          Columnas requeridas, <strong>en este orden</strong> (la primera fila son los encabezados):
          <ol class="scf-cols">
            ${COLUMNS.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}
          </ol>
          Si una orden tiene más de un <em>Nro Guia</em>, sepáralos con un espacio dentro de la
          misma celda (ej: <code>123456 789456</code>): se creará un "Detalle Orden" por cada guía,
          manteniendo el número de orden y la cantidad de paquetes.
        </div>

        <div id="scf-pane-file" class="scf-pane">
          <input type="file" id="scf-file" class="dt-input" accept=".csv,text/csv,text/plain">
          ${ui.fileName ? `<p class="lt-hint">Archivo cargado: <strong>${escapeHtml(ui.fileName)}</strong></p>` : ''}
        </div>

        <div id="scf-pane-paste" class="scf-pane hidden">
          <textarea id="scf-paste" class="dt-input scf-textarea" rows="6" spellcheck="false"
            placeholder="${escapeHtml(COLUMNS.join(','))}\n123456,123456 789456,2"></textarea>
        </div>

        <div id="scf-preview" class="scf-preview hidden"></div>

        <div class="lt-actions">
          <button type="button" id="scf-start" class="ct-btn ct-btn--primary" disabled>Iniciar</button>
          <button type="button" id="scf-stop"  class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="scf-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      ${progressHtml()}
    </div>
  `;

  // Restaurar valores del borrador.
  if (ui.mode === 'paste') container.querySelector('#scf-paste').value = ui.text;
  applyMode(container);

  // Eventos de modo.
  container.querySelectorAll('.scf-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.mode = btn.dataset.mode;
      applyMode(container);
      persistDraft();
      recompute(container);
    });
  });

  // Archivo.
  container.querySelector('#scf-file').addEventListener('change', (e) => onFile(e, container));

  // Pegar texto (debounced).
  const onPaste = debounce(() => {
    ui.text = container.querySelector('#scf-paste').value;
    ui.fileName = '';
    persistDraft();
    recompute(container);
  }, 300);
  container.querySelector('#scf-paste').addEventListener('input', onPaste);

  // Acciones.
  container.querySelector('#scf-start').addEventListener('click', () => onStart(container));

  // Estado inicial: preview del borrador + progreso si hay run.
  recompute(container);
  const run = await getRun();
  if (run) renderProgress(container, run);
  toggleButtons(container, run);
  wireRunControls(container);
}

function applyMode(container) {
  container.querySelectorAll('.scf-mode-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.mode === ui.mode);
  });
  container.querySelector('#scf-pane-file').classList.toggle('hidden', ui.mode !== 'file');
  container.querySelector('#scf-pane-paste').classList.toggle('hidden', ui.mode !== 'paste');
}

function persistDraft() {
  setDraft({ mode: ui.mode, text: ui.text, fileName: ui.fileName }).catch(() => {});
}

function onFile(event, container) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    ui.text = String(reader.result || '');
    ui.fileName = file.name;
    persistDraft();
    recompute(container);
  };
  reader.onerror = () => {
    ui.result = null;
    renderPreview(container, { error: 'No se pudo leer el archivo.' });
    updateStartButton(container);
  };
  reader.readAsText(file);
}

function recompute(container) {
  const text = ui.text || '';
  if (text.trim() === '') {
    ui.result = null;
    renderPreview(container, null);
    updateStartButton(container);
    return;
  }
  const { rows } = parseCsv(text);
  ui.result = { ...buildDetalles(rows), rows };
  renderPreview(container, ui.result);
  updateStartButton(container);
}

function renderPreview(container, result) {
  const box = container.querySelector('#scf-preview');
  if (!box) return;

  if (!result) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');

  if (result.error) {
    box.innerHTML = `<p class="scf-error-line">${escapeHtml(result.error)}</p>`;
    return;
  }

  const { detalles, errors, dataRowCount, rows } = result;
  const dataRows = (rows || []).slice(1, 1 + PREVIEW_ROWS);

  const tableHtml = dataRows.length
    ? `
      <table class="scf-table">
        <thead>
          <tr>${COLUMNS.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${dataRows.map((r) => `
            <tr>
              <td>${escapeHtml(r[0] ?? '')}</td>
              <td>${escapeHtml(r[1] ?? '')}</td>
              <td>${escapeHtml(r[2] ?? '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${dataRowCount > dataRows.length ? `<p class="lt-hint">… y ${dataRowCount - dataRows.length} fila(s) más.</p>` : ''}
    `
    : '';

  const summaryHtml = `
    <p class="scf-summary">
      <strong>${dataRowCount}</strong> fila(s) de datos →
      <strong>${detalles.length}</strong> "Detalle Orden" a crear.
    </p>
  `;

  const errorsHtml = errors.length
    ? `
      <details class="ct-diag scf-errors" open>
        <summary>${errors.length} advertencia(s) — esas filas se omiten</summary>
        <ul class="lt-log">
          ${errors.map((e) => `<li class="lt-log-item lt-log-item--warn">${escapeHtml(e)}</li>`).join('')}
        </ul>
      </details>
    `
    : '';

  box.innerHTML = summaryHtml + tableHtml + errorsHtml;
}

function updateStartButton(container) {
  const startBtn = container.querySelector('#scf-start');
  if (!startBtn) return;
  const n = ui.result?.detalles?.length || 0;
  startBtn.disabled = n === 0;
  startBtn.textContent = n > 0 ? `Iniciar (${n})` : 'Iniciar';
}

async function onStart(container) {
  const detalles = ui.result?.detalles || [];
  if (detalles.length === 0) {
    alert('No hay "Detalle Orden" para cargar. Revisá el CSV.');
    return;
  }

  const run = await getRun();
  if (run?.active) { alert('Ya hay un proceso en curso.'); return; }

  if (!confirm(`Se completarán ${detalles.length} "Detalle Orden" en la pestaña activa. ¿Continuar?`)) return;

  const newRun = makeRun({
    items: detalles,
    message: `Run iniciado — ${detalles.length} "Detalle Orden"`,
  });
  await setRun(newRun);
  log.info('run lanzado', { total: detalles.length });
  renderProgress(container, newRun);
  toggleButtons(container, newRun);
}
