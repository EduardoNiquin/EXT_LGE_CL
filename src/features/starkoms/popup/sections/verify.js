// UI de "Verificar órdenes y stock".
//
// El usuario configura la bodega fija, el valor de stock y opciones (verificar
// existencia, modo simulación, límite). Al Iniciar se escribe un `run` en
// storage; el content script en la pestaña Starkoms lo ejecuta. Progreso en vivo
// vía storage.onChanged.

import { DEFAULTS } from '../../constants.js';
import { getLastConfig, getRun, makeRun, setLastConfig, setRun } from '../../state.js';
import { logger } from '../../../../shared/utils/logger.js';
import { debounce } from '../../../../shared/ui/persist.js';
import { escapeHtml } from '../utils.js';
import { progressHtml, renderProgress, toggleButtons, wireRunControls } from '../run-ui.js';

const log = logger('starkoms');

export async function render(container) {
  const last = (await getLastConfig()) || { ...DEFAULTS };
  const run  = await getRun();

  const cfg = {
    bodega:          last.bodega ?? DEFAULTS.bodega,
    stockValue:      last.stockValue ?? DEFAULTS.stockValue,
    verifyExistence: last.verifyExistence ?? DEFAULTS.verifyExistence,
    dryRun:          last.dryRun ?? DEFAULTS.dryRun,
    limit:           last.limit ?? DEFAULTS.limit,
  };

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Verificar órdenes y stock</h3>
        <p class="lt-hint">
          Detecta las órdenes <strong>"On Hold (Fuera de Stock)"</strong> en Starkoms, asigna stock
          al producto en la bodega indicada cuando falta y cambia el estado del pedido a "Ingresado".
          Abra <strong>app.starkoms.com</strong> con sesión iniciada antes de comenzar.
        </p>

        <div class="dt-field">
          <label class="dt-label" for="sk-bodega">Bodega</label>
          <input id="sk-bodega" class="dt-input" type="text" value="${escapeHtml(cfg.bodega)}"
                 placeholder="Bodega LG Store OBS">
          <p class="lt-hint">Bodega fija donde se asigna el stock (debe coincidir con el nombre en Starkoms).</p>
        </div>

        <div class="dt-field">
          <label class="dt-label" for="sk-stock">Stock a asignar</label>
          <input id="sk-stock" class="dt-input" type="number" min="0" value="${escapeHtml(String(cfg.stockValue))}">
        </div>

        <div class="dt-field">
          <label class="dt-label" for="sk-limit">Límite de órdenes (0 = todas)</label>
          <input id="sk-limit" class="dt-input" type="number" min="0" value="${escapeHtml(String(cfg.limit))}">
          <p class="lt-hint">Útil para probar con pocas órdenes primero.</p>
        </div>

        <label class="dt-check">
          <input type="checkbox" id="sk-verify" ${cfg.verifyExistence ? 'checked' : ''}>
          <span>Verificar que el producto exista (en <code>#/productos</code>) antes de asignar stock</span>
        </label>

        <label class="dt-check">
          <input type="checkbox" id="sk-dry" ${cfg.dryRun ? 'checked' : ''}>
          <span><strong>Modo simulación</strong> — navega y reporta, pero NO guarda stock ni estados (recomendado para la 1ª prueba)</span>
        </label>

        <div class="lt-actions">
          <button type="button" id="sk-start" class="ct-btn ct-btn--primary">Iniciar</button>
          <button type="button" id="sk-stop"  class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="sk-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      ${progressHtml()}
    </div>
  `;

  container.querySelector('#sk-start').addEventListener('click', () => onStart(container));

  const autosave = debounce(() => setLastConfig(readForm(container)), 400);
  container.addEventListener('input', autosave);
  container.addEventListener('change', autosave);

  if (run) renderProgress(container, run);
  toggleButtons(container, run);
  wireRunControls(container);
}

function readForm(container) {
  return {
    bodega:          container.querySelector('#sk-bodega')?.value?.trim() || '',
    stockValue:      Number(container.querySelector('#sk-stock')?.value) || 0,
    limit:           Number(container.querySelector('#sk-limit')?.value) || 0,
    verifyExistence: Boolean(container.querySelector('#sk-verify')?.checked),
    dryRun:          Boolean(container.querySelector('#sk-dry')?.checked),
  };
}

async function onStart(container) {
  const cfg = readForm(container);

  if (!cfg.bodega) { alert('Ingrese el nombre de la bodega.'); return; }
  if (!Number.isFinite(cfg.stockValue) || cfg.stockValue <= 0) {
    alert('El stock a asignar debe ser un número mayor a 0.');
    return;
  }

  await setLastConfig(cfg);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/app\.starkoms\.com/i.test(tab.url)) {
    const ok = confirm('La pestaña activa no parece ser Starkoms (app.starkoms.com). ¿Iniciar igual?');
    if (!ok) return;
  }

  const run = makeRun({
    config: cfg,
    message: `Run iniciado — bodega "${cfg.bodega}", stock ${cfg.stockValue}${cfg.dryRun ? ' [simulación]' : ''}`,
  });
  await setRun(run);
  log.info('run lanzado', run);
  renderProgress(container, run);
  toggleButtons(container, run);
}
