// UI de "Buscar número de órden en caso".
//
// El usuario pega los números de orden que quiere ubicar. Al Iniciar se escribe
// un `run` en storage; el content script (en la pestaña con el listado de casos)
// recorre los casos página por página, abre cada uno, lee la orden asociada y se
// detiene al encontrar todas las órdenes buscadas (o al agotar las páginas).
// Progreso en vivo vía storage.onChanged. Soporta Pausar/Reanudar y Detener.

import { getSearchDraft, getSearchRun, makeSearchRun, setSearchDraft, setSearchRun } from '../../state.js';
import { logger } from '../../../../shared/utils/logger.js';
import { debounce } from '../../../../shared/ui/persist.js';
import { parseOrderList } from '../utils.js';
import { progressHtml, renderProgress, toggleButtons, wireRunControls } from '../case-search-ui.js';

const log = logger('seller-center-falabella');

// Estado local de la vista (persiste sólo el borrador).
const ui = {
  text: '',
  fromFirstPage: true,
  targets: [],
};

export async function render(container) {
  const draft = await getSearchDraft();
  if (draft) {
    ui.text = typeof draft.text === 'string' ? draft.text : '';
    ui.fromFirstPage = draft.fromFirstPage !== false;
  }

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Buscar número de órden en caso</h3>
        <p class="lt-hint">
          Pega los <strong>números de orden</strong> que quieres ubicar (uno por línea o
          separados por coma/espacio). Abre la página con el <strong>listado de casos</strong>
          y, cuando esté visible, presiona <strong>Iniciar</strong>. La extensión entra a cada
          caso, lee la orden asociada y avanza de página hasta encontrar todas las órdenes
          buscadas o agotar las páginas. Al final entrega cada orden con su número de caso.
        </p>

        <div class="scf-pane">
          <textarea id="scs-orders" class="dt-input scf-textarea" rows="6" spellcheck="false"
            placeholder="60775188&#10;3243016204&#10;..."></textarea>
        </div>

        <label class="scs-check">
          <input type="checkbox" id="scs-from-first"> Comenzar desde la página 1
        </label>

        <div id="scs-count" class="scf-summary"></div>

        <div class="lt-actions">
          <button type="button" id="scs-start" class="ct-btn ct-btn--primary" disabled>Iniciar</button>
          <button type="button" id="scs-pause" class="ct-btn ct-btn--ghost" disabled>Pausar</button>
          <button type="button" id="scs-stop"  class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="scs-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      ${progressHtml()}
    </div>
  `;

  // Restaurar borrador.
  container.querySelector('#scs-orders').value = ui.text;
  container.querySelector('#scs-from-first').checked = ui.fromFirstPage;

  // Eventos.
  const onInput = debounce(() => {
    ui.text = container.querySelector('#scs-orders').value;
    persistDraft();
    recompute(container);
  }, 250);
  container.querySelector('#scs-orders').addEventListener('input', onInput);

  container.querySelector('#scs-from-first').addEventListener('change', (e) => {
    ui.fromFirstPage = e.target.checked;
    persistDraft();
  });

  container.querySelector('#scs-start').addEventListener('click', () => onStart(container));

  // Estado inicial.
  recompute(container);
  const run = await getSearchRun();
  if (run) renderProgress(container, run);
  toggleButtons(container, run);
  wireRunControls(container);
}

function persistDraft() {
  setSearchDraft({ text: ui.text, fromFirstPage: ui.fromFirstPage }).catch(() => {});
}

function recompute(container) {
  ui.targets = parseOrderList(ui.text);
  const countEl = container.querySelector('#scs-count');
  if (countEl) {
    countEl.textContent = ui.targets.length
      ? `${ui.targets.length} orden(es) a buscar.`
      : '';
  }
  updateStartButton(container);
}

function updateStartButton(container) {
  const startBtn = container.querySelector('#scs-start');
  if (!startBtn) return;
  const n = ui.targets.length;
  startBtn.disabled = n === 0;
  startBtn.textContent = n > 0 ? `Iniciar (${n})` : 'Iniciar';
}

async function onStart(container) {
  const targets = ui.targets;
  if (targets.length === 0) {
    alert('No hay números de orden para buscar. Pega al menos uno.');
    return;
  }

  const run = await getSearchRun();
  if (run?.active) { alert('Ya hay una búsqueda en curso.'); return; }

  if (!confirm(`Se buscarán ${targets.length} orden(es) recorriendo los casos de la pestaña activa. ¿Continuar?`)) return;

  const newRun = makeSearchRun({
    targets,
    fromFirstPage: ui.fromFirstPage,
    message: `Búsqueda iniciada — ${targets.length} orden(es)`,
  });
  await setSearchRun(newRun);
  log.info('búsqueda lanzada', { total: targets.length, fromFirstPage: ui.fromFirstPage });
  renderProgress(container, newRun);
  toggleButtons(container, newRun);
}
