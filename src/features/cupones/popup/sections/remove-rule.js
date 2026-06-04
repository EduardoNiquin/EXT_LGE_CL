// UI principal de la sección "Quitar Regla de Cupón".
//
// Responsabilidades:
//   - Permitir al usuario elegir el modo de búsqueda (ID o Rule) y pegar la
//     lista de cupones a procesar (uno por línea).
//   - Persistir esa configuración como último config (para próximas aperturas).
//   - Disparar un run escribiendo a chrome.storage.local. El content script en
//     la pestaña de Magento detecta el cambio y empieza a procesar.
//   - Mostrar progreso en vivo suscribiéndose a chrome.storage.onChanged.
//   - Botón de detención de emergencia (set active=false en storage).
//
// Reusa las clases CSS .lt-*  /  .ct-*  ya definidas en popup.css para
// mantener consistencia visual con las otras features.

import {
  DEFAULTS,
  ITEM_STATUS,
  RUN_KIND,
  SEARCH_BY,
} from '../../constants.js';
import {
  getLastConfig,
  getRun,
  setLastConfig,
  setRun,
} from '../../state.js';
import { logger } from '../../../../shared/utils/logger.js';
import { debounce } from '../../../../shared/ui/persist.js';
import { escapeHtml, parseQueries } from '../utils.js';
import {
  progressHtml,
  renderProgress,
  toggleButtons,
  wireRunControls,
} from '../run-ui.js';

const log = logger('cupones/popup');

export async function render(container) {
  const last = (await getLastConfig()) || { searchBy: DEFAULTS.searchBy, rawQueries: '' };
  const run  = await getRun();

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Quitar Regla de Cupón</h3>
        <p class="lt-hint">Eliminará todas las condiciones (Conditions) del cupón en Magento y guardará. Funciona sobre Cart Price Rules.</p>

        <div class="dt-field">
          <label class="dt-label">Buscar por</label>
          <div class="cu-radio-row">
            <label class="cu-radio">
              <input type="radio" name="cu-search-by" value="${SEARCH_BY.ID}"
                     ${last.searchBy === SEARCH_BY.ID ? 'checked' : ''}>
              <span>ID</span>
            </label>
            <label class="cu-radio">
              <input type="radio" name="cu-search-by" value="${SEARCH_BY.RULE}"
                     ${last.searchBy === SEARCH_BY.RULE ? 'checked' : ''}>
              <span>Rule (nombre)</span>
            </label>
          </div>
          <p class="lt-hint">No se pueden mezclar IDs con Rules — todo el batch usa el mismo modo.</p>
        </div>

        <div class="dt-field">
          <label class="dt-label" for="cu-queries">Cupones (uno por línea)</label>
          <textarea id="cu-queries" class="dt-input dt-textarea" rows="6"
                    placeholder="6255&#10;6883&#10;26226">${escapeHtml(last.rawQueries || '')}</textarea>
        </div>

        <div class="lt-actions">
          <button type="button" id="cu-start" class="ct-btn ct-btn--primary">Iniciar</button>
          <button type="button" id="cu-stop"  class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="cu-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      ${progressHtml()}
    </div>
  `;

  container.querySelector('#cu-start').addEventListener('click', () => onStart(container));

  // Autosave as-you-type: no perder lo cargado si el popup se cierra.
  const autosave = debounce(() => {
    const searchBy = container.querySelector('input[name="cu-search-by"]:checked')?.value || DEFAULTS.searchBy;
    const rawQueries = container.querySelector('#cu-queries')?.value ?? '';
    setLastConfig({ searchBy, rawQueries });
  }, 400);
  container.addEventListener('input', autosave);
  container.addEventListener('change', autosave);

  if (run) renderProgress(container, run);
  toggleButtons(container, run);

  wireRunControls(container);
}

// -----------------------------------------------------------------------------
// start / stop / clear
// -----------------------------------------------------------------------------

async function onStart(container) {
  const searchBy = container.querySelector('input[name="cu-search-by"]:checked')?.value || DEFAULTS.searchBy;
  const rawQueries = container.querySelector('#cu-queries').value;
  const queries = parseQueries(rawQueries);

  if (queries.length === 0) {
    alert('Ingresá al menos un cupón.');
    return;
  }

  if (searchBy === SEARCH_BY.ID) {
    const bad = queries.filter((q) => !/^\d+$/.test(q));
    if (bad.length > 0) {
      alert(`Modo ID: estos valores no son numéricos:\n${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''}`);
      return;
    }
  }

  // Persistir config como último usado.
  await setLastConfig({ searchBy, rawQueries });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/\/sales_rule\/promo_quote/i.test(tab.url)) {
    const ok = confirm(
      'La pestaña activa no parece ser Cart Price Rules. ' +
      '¿Iniciar igual? (deberías abrir Magento primero)',
    );
    if (!ok) return;
  }

  const run = {
    active: true,
    kind: RUN_KIND.REMOVE,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    searchBy,
    currentItemIndex: 0,
    items: queries.map((q) => ({ query: q, status: ITEM_STATUS.PENDING })),
    log: [{
      ts: Date.now(),
      level: 'info',
      message: `Run iniciado (quitar) — ${queries.length} cupón(es), modo: ${searchBy}`,
    }],
  };
  await setRun(run);
  log.info('run lanzado', run);
  renderProgress(container, run);
  toggleButtons(container, run);
}

// Expuesto para testing / debug:
export const __test = { parseQueries };
