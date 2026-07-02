// UI de "Creación de producto" (PIM): verificar si uno o varios SKU existen en
// PIM (Staging). El usuario pega los SKU (uno por línea o separados por coma);
// al Iniciar se escribe un `run` en storage y el content script en la pestaña de
// PIM verifica cada SKU. Progreso y resultados en vivo vía storage.onChanged.

import { getDraft, getRun, makeRun, setDraft, setRun } from '../../state.js';
import { logger } from '../../../../shared/utils/logger.js';
import { debounce } from '../../../../shared/ui/persist.js';
import { parseSkus } from '../utils.js';
import { progressHtml, renderProgress, toggleButtons, wireRunControls } from '../run-ui.js';

const log = logger('pim');

// Estado local de la vista (sólo el borrador se persiste).
const ui = { text: '' };

export async function render(container) {
  const draft = await getDraft();
  if (draft && typeof draft.text === 'string') ui.text = draft.text;

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Creación de producto — ¿existe en PIM?</h3>
        <p class="lt-hint">
          Verifica si uno o varios <strong>SKU</strong> existen en PIM (vista <strong>Staging / STG</strong>).
          Abra la pantalla de PIM con el buscador por SKU visible y recién entonces presione
          <strong>Iniciar</strong>. La extensión sólo busca (no modifica nada) y arroja
          <code>SKU/YES</code> o <code>SKU/NO</code>, e indica el contenido de la columna
          <strong>Spec Assign</strong> de cada producto encontrado, con opción de copiar y descargar CSV.
        </p>

        <label class="lt-hint" for="pim-skus">SKU a verificar (uno por línea o separados por coma):</label>
        <textarea id="pim-skus" class="dt-input scf-textarea" rows="6" spellcheck="false"
          placeholder="75QNED85BSG.AWH&#10;OLED55C4PSA.AWH"></textarea>

        <div id="pim-preview" class="lt-hint"></div>

        <div class="lt-actions">
          <button type="button" id="pim-start" class="ct-btn ct-btn--primary" disabled>Iniciar</button>
          <button type="button" id="pim-stop"  class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="pim-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      ${progressHtml()}
    </div>
  `;

  const textarea = container.querySelector('#pim-skus');
  textarea.value = ui.text;

  const onInput = debounce(() => {
    ui.text = textarea.value;
    setDraft({ text: ui.text }).catch(() => {});
    updatePreview(container);
  }, 300);
  textarea.addEventListener('input', onInput);

  container.querySelector('#pim-start').addEventListener('click', () => onStart(container));

  updatePreview(container);
  const run = await getRun();
  if (run) renderProgress(container, run);
  toggleButtons(container, run);
  wireRunControls(container);
}

function updatePreview(container) {
  const skus = parseSkus(ui.text);
  const box = container.querySelector('#pim-preview');
  if (box) {
    box.innerHTML = skus.length
      ? `<strong>${skus.length}</strong> SKU a verificar.`
      : 'Pegue al menos un SKU.';
  }
  const startBtn = container.querySelector('#pim-start');
  if (startBtn) {
    startBtn.disabled = skus.length === 0;
    startBtn.textContent = skus.length > 0 ? `Iniciar (${skus.length})` : 'Iniciar';
  }
}

async function onStart(container) {
  const skus = parseSkus(ui.text);
  if (skus.length === 0) { alert('Pegue al menos un SKU.'); return; }

  const run = await getRun();
  if (run?.active) { alert('Ya hay un proceso en curso.'); return; }

  if (!confirm(`Se verificarán ${skus.length} SKU en PIM (STG) en la pestaña activa. ¿Continuar?`)) return;

  const newRun = makeRun({ skus, message: `Run iniciado — ${skus.length} SKU` });
  await setRun(newRun);
  log.info('run lanzado', { total: skus.length });
  renderProgress(container, newRun);
  toggleButtons(container, newRun);
}
