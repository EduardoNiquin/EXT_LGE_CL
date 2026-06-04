// UI de la sección "Agregar Regla de Cupón".
//
// Igual que "Quitar Regla", trabaja sobre Cart Price Rules: busca cada cupón
// (por ID o Rule), entra al edit y AGREGA una condición al bloque Actions
// (atributo + operador + valor de texto), luego guarda. Aplica la MISMA
// condición a todos los cupones del batch.
//
// El ciclo de progreso/stop/clear vive en popup/run-ui.js (compartido con
// "Quitar Regla"); acá sólo el formulario y el onStart.

import {
  CONDITION_SUGGESTIONS,
  DEFAULTS,
  ITEM_STATUS,
  OPERATORS,
  RUN_KIND,
  SEARCH_BY,
} from '../../constants.js';
import {
  getLastConfigAdd,
  getRun,
  setLastConfigAdd,
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

const DEFAULT_CONFIG = {
  searchBy: DEFAULTS.searchBy,
  rawQueries: '',
  attributeLabel: '',
  operator: '{}',   // "contains" (el caso del ejemplo: Level1 Code contains MN)
  value: '',
};

export async function render(container) {
  const last = { ...DEFAULT_CONFIG, ...((await getLastConfigAdd()) || {}) };
  const run  = await getRun();

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Agregar Regla de Cupón</h3>
        <p class="lt-hint">Agrega una condición (Conditions) al bloque Actions del cupón en Magento y guarda. La misma condición se aplica a todos los cupones del lote.</p>

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
          <textarea id="cu-queries" class="dt-input dt-textarea" rows="5"
                    placeholder="6255&#10;6883&#10;26226">${escapeHtml(last.rawQueries || '')}</textarea>
        </div>

        <fieldset class="cu-condition">
          <legend>Condición a agregar</legend>

          <div class="dt-field">
            <label class="dt-label" for="cu-attribute">Atributo</label>
            <input id="cu-attribute" class="dt-input" list="cu-attribute-options"
                   placeholder="Level1 Code" value="${escapeHtml(last.attributeLabel || '')}">
            <datalist id="cu-attribute-options">
              ${CONDITION_SUGGESTIONS.map((s) => `<option value="${escapeHtml(s)}"></option>`).join('')}
            </datalist>
            <p class="lt-hint">Nombre tal como aparece en el desplegable de Magento (ej: "Level1 Code"). Match por texto, sin distinguir mayúsculas.</p>
          </div>

          <div class="dt-field">
            <label class="dt-label" for="cu-operator">Operador</label>
            <select id="cu-operator" class="dt-input">
              ${OPERATORS.map((o) => `
                <option value="${escapeHtml(o.value)}" ${o.value === last.operator ? 'selected' : ''}>${escapeHtml(o.label)}</option>
              `).join('')}
            </select>
          </div>

          <div class="dt-field">
            <label class="dt-label" for="cu-value">Valor</label>
            <input id="cu-value" class="dt-input" placeholder="MN" value="${escapeHtml(last.value || '')}">
          </div>
        </fieldset>

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

  const autosave = debounce(() => {
    setLastConfigAdd(collectConfig(container));
  }, 400);
  container.addEventListener('input', autosave);
  container.addEventListener('change', autosave);

  if (run) renderProgress(container, run);
  toggleButtons(container, run);

  wireRunControls(container);
}

function collectConfig(container) {
  return {
    searchBy: container.querySelector('input[name="cu-search-by"]:checked')?.value || DEFAULTS.searchBy,
    rawQueries: container.querySelector('#cu-queries')?.value ?? '',
    attributeLabel: container.querySelector('#cu-attribute')?.value?.trim() ?? '',
    operator: container.querySelector('#cu-operator')?.value || DEFAULT_CONFIG.operator,
    value: container.querySelector('#cu-value')?.value ?? '',
  };
}

async function onStart(container) {
  const cfg = collectConfig(container);
  const queries = parseQueries(cfg.rawQueries);

  if (queries.length === 0) {
    alert('Ingresá al menos un cupón.');
    return;
  }
  if (!cfg.attributeLabel) {
    alert('Indicá el atributo de la condición (ej: "Level1 Code").');
    return;
  }
  if (!cfg.value.trim()) {
    alert('Indicá el valor de la condición (ej: "MN").');
    return;
  }
  if (cfg.searchBy === SEARCH_BY.ID) {
    const bad = queries.filter((q) => !/^\d+$/.test(q));
    if (bad.length > 0) {
      alert(`Modo ID: estos valores no son numéricos:\n${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''}`);
      return;
    }
  }

  await setLastConfigAdd(cfg);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/\/sales_rule\/promo_quote/i.test(tab.url)) {
    const ok = confirm(
      'La pestaña activa no parece ser Cart Price Rules. ' +
      '¿Iniciar igual? (deberías abrir Magento primero)',
    );
    if (!ok) return;
  }

  const operatorLabel = OPERATORS.find((o) => o.value === cfg.operator)?.label || cfg.operator;
  const run = {
    active: true,
    kind: RUN_KIND.ADD,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    searchBy: cfg.searchBy,
    condition: {
      attributeLabel: cfg.attributeLabel,
      operator: cfg.operator,
      operatorLabel,
      value: cfg.value,
    },
    currentItemIndex: 0,
    items: queries.map((q) => ({ query: q, status: ITEM_STATUS.PENDING })),
    log: [{
      ts: Date.now(),
      level: 'info',
      message: `Run iniciado (agregar "${cfg.attributeLabel} ${operatorLabel} ${cfg.value}") — ${queries.length} cupón(es), modo: ${cfg.searchBy}`,
    }],
  };
  await setRun(run);
  log.info('run lanzado', run);
  renderProgress(container, run);
  toggleButtons(container, run);
}
