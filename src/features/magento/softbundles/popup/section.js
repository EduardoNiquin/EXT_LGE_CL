import { toMessage } from '../../../../shared/errors/index.js';
import { getActiveTab } from '../../../../shared/messaging/messaging.js';
import { logger } from '../../../../shared/utils/logger.js';
import {
  ADMIN_BASE_RE,
  BUNDLE_STATUS,
  BUNDLE_STATUS_LABEL,
  CHILD_STATUS,
  DEFAULT_CONFIG,
  DEFAULT_ADMIN_BASE,
  FINISH_REASON,
  LISTING_PATH,
  LISTING_URL_RE,
  RUN_PHASE,
  STORE_VIEW_LABEL,
  WEBSITE_LABEL,
} from '../constants.js';
import { buildMatrix, matrixToCsv } from '../csv.js';
import { countOffers, parseBundleLines, parsePercent } from '../parse-input.js';
import {
  clearRun, getDraft, getRun, makeRun, setDraft, setRun, subscribeToRun, updateRun,
} from '../state.js';
import { downloadText, escapeHtml, formatTime } from '../../popup/utils.js';

const log = logger('magento/popup');
const PLACEHOLDER = 'SKU_PADRE,SKU_HIJO1,SKU_HIJO2\nSKU_PADRE2,SKU_HIJO1:10,SKU_HIJO2:8:40';

let unsubscribeRun = null;

export async function render(container) {
  if (unsubscribeRun) unsubscribeRun();
  const [run, draft] = await Promise.all([getRun(), getDraft()]);
  const config = { ...defaultConfig(), ...(draft || {}) };

  container.innerHTML = `
    <div class="lt-view sb-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Crear Softbundles</h3>
        <p class="lt-hint">Crea package rules en lote: por cada linea arma el bundle con su producto principal y agrega una oferta por cada producto hijo.</p>
        <div class="mg-notice">
          <strong>Antes de iniciar</strong>
          <span>Deja la pestana en el listado de Package Rule de Magento con la sesion iniciada. El proceso navega solo entre el listado y cada formulario, y sigue aunque cierres este panel.</span>
        </div>

        <div class="ct-tabs sb-source">
          <button type="button" class="ct-tab" data-source="text">Pegar texto</button>
          <button type="button" class="ct-tab" data-source="file">Subir archivo CSV</button>
        </div>

        <div class="dt-field" data-source-panel="text">
          <label class="dt-label" for="sb-text">Un bundle por linea: primero el SKU principal y despues los hijos</label>
          <textarea id="sb-text" class="dt-textarea" rows="6" spellcheck="false"
                    placeholder="${escapeHtml(PLACEHOLDER)}">${escapeHtml(config.text || '')}</textarea>
          <p class="lt-hint">Separadores: coma, punto y coma o tabulador. Un hijo puede llevar su propio descuento con <code>SKU:5</code> y tambien el % que se reparte al principal con <code>SKU:5:50</code>.</p>
        </div>

        <div class="dt-field hidden" data-source-panel="file">
          <label class="dt-label" for="sb-file">Archivo CSV con las mismas columnas</label>
          <input type="file" id="sb-file" class="dt-input" accept=".csv,text/csv,text/plain">
          <p class="lt-hint" id="sb-file-name">${config.fileName ? `Cargado: ${escapeHtml(config.fileName)}` : 'Primera columna: SKU principal. Las siguientes: los hijos.'}</p>
        </div>

        <div id="sb-preview" class="sb-preview"></div>

        <details class="ct-diag sb-config">
          <summary>Datos del bundle (producto principal)</summary>
          <div class="sb-config-body">
            <div class="dt-row">
              <div class="dt-field dt-field--half">
                <label class="dt-label" for="sb-store">Apply To (store view)</label>
                <input type="text" id="sb-store" class="dt-input" value="${escapeHtml(config.storeView)}">
              </div>
              <div class="dt-field dt-field--half">
                <label class="dt-label" for="sb-descriptions">Descriptions</label>
                <input type="text" id="sb-descriptions" class="dt-input" value="${escapeHtml(config.descriptions)}">
              </div>
            </div>
            <div class="dt-row">
              <div class="dt-field dt-field--half">
                <label class="dt-label" for="sb-from-date">Active From</label>
                <div class="dt-datetime">
                  <input type="date" id="sb-from-date" class="dt-input" value="${escapeHtml(config.fromDate)}">
                  <input type="time" id="sb-from-time" class="dt-input" value="${escapeHtml(config.fromTime)}">
                </div>
              </div>
              <div class="dt-field dt-field--half">
                <label class="dt-label" for="sb-to-date">Active To</label>
                <div class="dt-datetime">
                  <input type="date" id="sb-to-date" class="dt-input" value="${escapeHtml(config.toDate)}">
                  <input type="time" id="sb-to-time" class="dt-input" value="${escapeHtml(config.toTime)}">
                </div>
              </div>
            </div>
            <div class="dt-field">
              <label class="dt-label" for="sb-max-related">Maximum number of related products can be added to cart</label>
              <input type="text" id="sb-max-related" class="dt-input" value="${escapeHtml(config.maxRelated)}" placeholder="vacio = sin limite">
            </div>
            <label class="dt-check"><input type="checkbox" id="sb-active" ${config.active ? 'checked' : ''}><span>Active</span></label>
            <label class="dt-check"><input type="checkbox" id="sb-combinable" ${config.combinable ? 'checked' : ''}><span>Combinable discount with normal coupon</span></label>
            <label class="dt-check"><input type="checkbox" id="sb-out-of-stock" ${config.showOutOfStock ? 'checked' : ''}><span>Show related product when out of stock</span></label>
          </div>
        </details>

        <details class="ct-diag sb-config">
          <summary>Datos de cada oferta (productos hijos)</summary>
          <div class="sb-config-body">
            <div class="dt-row">
              <div class="dt-field dt-field--half">
                <label class="dt-label" for="sb-discount">Discount rate (%)</label>
                <input type="number" id="sb-discount" class="dt-input" min="0" max="100" step="0.01" value="${escapeHtml(config.discountRate)}">
              </div>
              <div class="dt-field dt-field--half">
                <label class="dt-label" for="sb-main-discount">% del descuento aplicado al principal</label>
                <input type="number" id="sb-main-discount" class="dt-input" min="1" max="99" step="1" value="${escapeHtml(config.mainDiscountRate)}">
              </div>
            </div>
            <label class="dt-check"><input type="checkbox" id="sb-split" ${config.split ? 'checked' : ''}><span>Enable splitting discount to main product</span></label>
            <div class="dt-row">
              <div class="dt-field dt-field--half">
                <label class="dt-label" for="sb-limited-qty">Maximum Qty to Offer</label>
                <input type="text" id="sb-limited-qty" class="dt-input" value="${escapeHtml(config.limitedQty)}" placeholder="vacio = 1">
              </div>
              <div class="dt-field dt-field--half">
                <label class="dt-label" for="sb-priority">Priority</label>
                <input type="text" id="sb-priority" class="dt-input" value="${escapeHtml(config.priority)}">
              </div>
            </div>
            <div class="dt-field">
              <label class="dt-label" for="sb-promotion-text">Promotion Text</label>
              <input type="text" id="sb-promotion-text" class="dt-input" value="${escapeHtml(config.promotionText)}" placeholder="vacio = no se muestra">
            </div>
            <div class="dt-field">
              <label class="dt-label" for="sb-promotion-desc">Promotion Description</label>
              <input type="text" id="sb-promotion-desc" class="dt-input" value="${escapeHtml(config.promotionDesc)}" placeholder="vacio = no se muestra">
            </div>
            <label class="dt-check"><input type="checkbox" id="sb-child-active" ${config.childActive ? 'checked' : ''}><span>Oferta activa</span></label>
            <label class="dt-check"><input type="checkbox" id="sb-zero-percent" ${config.showZeroPercent ? 'checked' : ''}><span>Display discount rate of 0%</span></label>
          </div>
        </details>

        <label class="dt-check"><input type="checkbox" id="sb-skip-existing" ${config.skipExisting ? 'checked' : ''}><span>Omitir los SKU que ya tienen package rule</span></label>
        <label class="dt-check"><input type="checkbox" id="sb-dry-run" ${config.dryRun ? 'checked' : ''}><span>Modo simulacion (no guarda nada)</span></label>
        <p class="lt-hint" id="sb-dry-hint"></p>

        <div class="lt-actions">
          <button type="button" id="sb-start" class="ct-btn ct-btn--primary">Iniciar</button>
          <button type="button" id="sb-stop" class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="sb-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      <section id="sb-progress" class="lt-progress hidden">
        <div class="lt-progress-head">
          <strong id="sb-progress-title">Preparando...</strong>
          <span id="sb-progress-counter" class="dt-progress-counter"></span>
        </div>
        <div id="sb-progress-bar" class="lt-progress-bar"><span></span></div>
        <p id="sb-progress-detail" class="lt-hint"></p>
        <ul id="sb-bundle-list" class="lt-region-list"></ul>
        <div class="bo-results-actions">
          <button type="button" id="sb-copy" class="ct-btn ct-btn--ghost">Copiar resultado</button>
          <button type="button" id="sb-export" class="ct-btn ct-btn--primary">Descargar CSV</button>
        </div>
        <details class="ct-diag lt-log-details">
          <summary>Registro</summary>
          <ul id="sb-log" class="lt-log"></ul>
        </details>
      </section>
    </div>`;

  wireForm(container, config);
  container.querySelector('#sb-start').addEventListener('click', () => onStart(container));
  container.querySelector('#sb-stop').addEventListener('click', onStop);
  container.querySelector('#sb-clear').addEventListener('click', () => onClear(container));
  container.querySelector('#sb-export').addEventListener('click', onExport);
  container.querySelector('#sb-copy').addEventListener('click', (event) => onCopy(event.currentTarget));

  setSource(container, config.source);
  updatePreview(container);
  updateDryHint(container);
  if (run) renderProgress(container, run);
  toggleButtons(container, run);

  unsubscribeRun = subscribeToRun((newRun) => {
    // El popup no llama a un unmount: si el usuario volvio al menu, este
    // contenedor ya no esta en el documento y seguir pintandolo revienta.
    if (!container.isConnected) {
      unsubscribeRun?.();
      unsubscribeRun = null;
      return;
    }
    if (newRun) renderProgress(container, newRun);
    else container.querySelector('#sb-progress')?.classList.add('hidden');
    toggleButtons(container, newRun);
  });
}

// -----------------------------------------------------------------------------
// formulario
// -----------------------------------------------------------------------------

function defaultConfig() {
  return {
    ...DEFAULT_CONFIG,
    source: 'text',
    text: '',
    fileName: '',
    storeView: STORE_VIEW_LABEL,
    fromDate: isoDate(new Date()),
  };
}

function isoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** ISO del <input type="date"> -> formato del datepicker de Magento (m/dd/yyyy). */
export function toMagentoDate(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const [, year, month, day] = match;
  return `${Number(month)}/${day}/${year}`;
}

function setSource(container, source) {
  const active = source === 'file' ? 'file' : 'text';
  container.querySelectorAll('[data-source]').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.source === active);
  });
  container.querySelectorAll('[data-source-panel]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.sourcePanel !== active);
  });
}

function wireForm(container, config) {
  container.querySelectorAll('[data-source]').forEach((tab) => {
    tab.addEventListener('click', () => {
      setSource(container, tab.dataset.source);
      persistDraft(container);
    });
  });

  container.querySelector('#sb-text').addEventListener('input', () => {
    updatePreview(container);
    persistDraft(container);
  });

  container.querySelector('#sb-file').addEventListener('change', async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      container.querySelector('#sb-text').value = text;
      container.querySelector('#sb-file-name').textContent = `Cargado: ${file.name}`;
      container.dataset.fileName = file.name;
      updatePreview(container);
      persistDraft(container);
    } catch (err) {
      container.querySelector('#sb-file-name').textContent = `No se pudo leer el archivo: ${toMessage(err)}`;
    }
  });

  container.querySelector('#sb-dry-run').addEventListener('change', () => updateDryHint(container));
  container.querySelectorAll('.sb-config input, #sb-skip-existing, #sb-dry-run').forEach((input) => {
    input.addEventListener('change', () => persistDraft(container));
  });
  container.dataset.fileName = config.fileName || '';
}

function readConfig(container) {
  const value = (id) => container.querySelector(id)?.value?.trim() ?? '';
  const checked = (id) => Boolean(container.querySelector(id)?.checked);
  return {
    source: container.querySelector('[data-source].is-active')?.dataset.source || 'text',
    text: container.querySelector('#sb-text').value,
    fileName: container.dataset.fileName || '',
    // padre
    storeView:      value('#sb-store'),
    descriptions:   value('#sb-descriptions'),
    active:         checked('#sb-active'),
    combinable:     checked('#sb-combinable'),
    fromDate:       value('#sb-from-date'),
    fromTime:       value('#sb-from-time'),
    toDate:         value('#sb-to-date'),
    toTime:         value('#sb-to-time'),
    maxRelated:     value('#sb-max-related'),
    showOutOfStock: checked('#sb-out-of-stock'),
    // hijo
    childActive:      checked('#sb-child-active'),
    discountRate:     value('#sb-discount'),
    limitedQty:       value('#sb-limited-qty'),
    priority:         value('#sb-priority'),
    promotionText:    value('#sb-promotion-text'),
    promotionDesc:    value('#sb-promotion-desc'),
    showZeroPercent:  checked('#sb-zero-percent'),
    split:            checked('#sb-split'),
    mainDiscountRate: value('#sb-main-discount'),
    // run
    skipExisting: checked('#sb-skip-existing'),
    dryRun:       checked('#sb-dry-run'),
  };
}

function persistDraft(container) {
  setDraft(readConfig(container)).catch((err) => log.warn('no se pudo guardar el borrador', err));
}

function updateDryHint(container) {
  const dry = container.querySelector('#sb-dry-run').checked;
  container.querySelector('#sb-dry-hint').textContent = dry
    ? 'En simulacion se llena el formulario del bundle (lo que confirma que el SKU principal existe en Magento) y se vuelve al listado sin guardar. Las ofertas no se pueden probar sin crear antes el bundle.'
    : 'Se van a crear package rules reales en Magento.';
}

function updatePreview(container) {
  const host = container.querySelector('#sb-preview');
  const { bundles, warnings } = parseBundleLines(container.querySelector('#sb-text').value);
  if (!bundles.length && !warnings.length) {
    host.innerHTML = '<p class="ct-empty">Escribe o carga los bundles para verlos aca.</p>';
    return;
  }
  const preview = bundles.slice(0, 4).map((bundle) => `
    <li><strong>${escapeHtml(bundle.parentSku)}</strong> → ${bundle.children.map((child) =>
      escapeHtml(child.sku + (child.discountRate ? ` (${child.discountRate}%${child.mainDiscountRate ? `/${child.mainDiscountRate}%` : ''})` : ''))).join(', ')}</li>`).join('');

  host.innerHTML = `
    <p class="lt-hint"><strong>${bundles.length}</strong> bundle(s) y <strong>${countOffers(bundles)}</strong> oferta(s) por crear.</p>
    <ul class="sb-preview-list">${preview}</ul>
    ${bundles.length > 4 ? `<p class="lt-hint">y ${bundles.length - 4} mas...</p>` : ''}
    ${warnings.length ? `<details class="ct-diag"><summary>${warnings.length} aviso(s)</summary><ul class="lt-log">${
      warnings.map((warning) => `<li class="lt-log-item lt-log-item--warn">${escapeHtml(warning)}</li>`).join('')}</ul></details>` : ''}`;
}

// -----------------------------------------------------------------------------
// acciones
// -----------------------------------------------------------------------------

async function onStart(container) {
  const previous = await getRun();
  if (previous?.active) return;

  const config = readConfig(container);
  const { bundles, warnings } = parseBundleLines(config.text);
  if (!bundles.length) {
    alert('No hay ningun bundle valido para crear. Cada linea necesita el SKU principal y al menos un hijo.');
    return;
  }
  if (!config.storeView) { alert('Indica el store view de "Apply To".'); return; }
  if (!config.fromDate) { alert('"Active From" es obligatorio en Magento.'); return; }
  if (config.toDate && config.toDate < config.fromDate) {
    alert('"Active To" tiene que ser posterior a "Active From".');
    return;
  }
  if (parsePercent(config.discountRate) === null) {
    alert('El "Discount rate (%)" tiene que ser un porcentaje entre 0 y 100.');
    return;
  }
  if (config.split && parsePercent(config.mainDiscountRate, { min: 1, max: 99 }) === null) {
    alert('El % aplicado al producto principal tiene que ir entre 1 y 99 (Magento no acepta 0).');
    return;
  }

  const offers = countOffers(bundles);
  if (!config.dryRun && !confirm(
    `Se van a crear ${bundles.length} package rule(s) con ${offers} oferta(s) en Magento (website ${WEBSITE_LABEL}).\n\n`
    + `${warnings.length ? `Hay ${warnings.length} aviso(s) en la lista.\n\n` : ''}Continuar?`,
  )) return;

  let tab = null;
  try {
    tab = await getActiveTab();
  } catch (err) {
    log.warn('no hay pestana activa', err);
  }

  const onListing = LISTING_URL_RE.test(tab?.url || '');
  const listingUrl = onListing ? tab.url : `${deriveAdminBase(tab?.url)}${LISTING_PATH}`;
  if (!onListing && !confirm(`La pestana activa no es el listado de Package Rule. Se va a navegar a:\n\n${listingUrl}\n\nContinuar?`)) {
    return;
  }

  await setDraft(config);
  const runConfig = {
    ...config,
    fromDate: toMagentoDate(config.fromDate),
    toDate: toMagentoDate(config.toDate),
  };
  delete runConfig.text;
  delete runConfig.fileName;

  const run = makeRun({ config: runConfig, bundles, listingUrl });
  await setRun(run);
  renderProgress(container, run);
  toggleButtons(container, run);

  if (onListing) return;
  try {
    if (!tab?.id) throw new Error('No hay pestana activa para abrir el listado de Package Rule.');
    await chrome.tabs.update(tab.id, { url: listingUrl });
  } catch (err) {
    const message = toMessage(err);
    await updateRun((current) => ({
      ...current,
      active: false,
      finishedAt: Date.now(),
      finishReason: FINISH_REASON.ERROR,
      error: message,
    }));
    log.error('no se pudo abrir el listado de Package Rule', err);
  }
}

function deriveAdminBase(url) {
  return url?.match(ADMIN_BASE_RE)?.[1] || DEFAULT_ADMIN_BASE;
}

async function onStop() {
  if (!confirm('Detener el proceso? Los bundles ya creados quedan en Magento.')) return;
  await updateRun((run) => ({
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: FINISH_REASON.CANCELLED,
  }));
}

async function onClear(container) {
  const run = await getRun();
  if (run?.active && !confirm('Hay un proceso activo. Detenerlo y borrar el resultado?')) return;
  await clearRun();
  container.querySelector('#sb-progress')?.classList.add('hidden');
  toggleButtons(container, null);
}

async function onExport() {
  const run = await getRun();
  if (!run) return;
  const matrix = buildMatrix(run);
  if (!matrix.rows.length) { alert('Todavia no hay resultados para exportar.'); return; }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadText(matrixToCsv(matrix), `magento-softbundles-${stamp}.csv`);
}

async function onCopy(button) {
  const run = await getRun();
  if (!run) return;
  const text = matrixToCsv(buildMatrix(run));
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } finally { area.remove(); }
  }
  const original = button.textContent;
  button.textContent = 'Copiado';
  setTimeout(() => { button.textContent = original; }, 1200);
}

// -----------------------------------------------------------------------------
// render
// -----------------------------------------------------------------------------

const DONE_STATUSES = [
  BUNDLE_STATUS.OK,
  BUNDLE_STATUS.PARTIAL,
  BUNDLE_STATUS.ERROR,
  BUNDLE_STATUS.SKIPPED,
  BUNDLE_STATUS.SIMULATED,
];

export function computeStats(run) {
  const items = run?.items || [];
  const count = (status) => items.filter((item) => item.status === status).length;
  return {
    total: items.length,
    done: items.filter((item) => DONE_STATUSES.includes(item.status)).length,
    ok: count(BUNDLE_STATUS.OK),
    partial: count(BUNDLE_STATUS.PARTIAL),
    errors: count(BUNDLE_STATUS.ERROR),
    skipped: count(BUNDLE_STATUS.SKIPPED),
    simulated: count(BUNDLE_STATUS.SIMULATED),
  };
}

function renderProgress(container, run) {
  const wrap = container.querySelector('#sb-progress');
  if (!wrap) return;
  wrap.classList.remove('hidden');

  const stats = computeStats(run);
  container.querySelector('#sb-progress-title').textContent = progressTitle(run);
  container.querySelector('#sb-progress-counter').textContent = `${stats.done} / ${stats.total}`;
  container.querySelector('#sb-progress-bar span').style.width =
    `${stats.total ? Math.round((stats.done / stats.total) * 100) : 0}%`;

  const detail = container.querySelector('#sb-progress-detail');
  if (run.error) detail.textContent = run.error;
  else if (run.active && run.phase === RUN_PHASE.CHECKING) detail.textContent = 'Revisando cuales SKU ya tienen package rule...';
  else if (run.active) detail.textContent = `Quedan ${Math.max(0, stats.total - stats.done)} bundle(s).`;
  else detail.textContent = summaryLine(stats, run);

  renderBundles(container.querySelector('#sb-bundle-list'), run);
  renderLog(container.querySelector('#sb-log'), run.log || []);
}

function summaryLine(stats, run) {
  if (run.config?.dryRun) {
    return `${stats.simulated} bundle(s) verificados en simulacion, ${stats.errors} con error, ${stats.skipped} omitidos.`;
  }
  return `${stats.ok} creados, ${stats.partial} con ofertas fallidas, ${stats.errors} con error, ${stats.skipped} omitidos.`;
}

const STATUS_CLASS = {
  [BUNDLE_STATUS.PENDING]:   'pending',
  [BUNDLE_STATUS.CREATING]:  'running',
  [BUNDLE_STATUS.SAVING]:    'running',
  [BUNDLE_STATUS.OK]:        'done',
  [BUNDLE_STATUS.SIMULATED]: 'done',
  [BUNDLE_STATUS.SKIPPED]:   'done',
  [BUNDLE_STATUS.PARTIAL]:   'error',
  [BUNDLE_STATUS.ERROR]:     'error',
};

function renderBundles(list, run) {
  if (!list) return;
  list.innerHTML = '';
  (run.items || []).forEach((item, index) => {
    const li = document.createElement('li');
    li.className = `lt-region lt-region--${STATUS_CLASS[item.status] || 'pending'}`;
    if (index === run.currentIndex && run.active) li.classList.add('lt-region--current');

    const okCount = item.children.filter((child) => child.status === CHILD_STATUS.OK).length;
    li.innerHTML = `
      <div class="lt-region-head">
        <span class="lt-region-name">${escapeHtml(item.parentSku)}</span>
        <span class="lt-region-leadtimes">${okCount}/${item.children.length} ofertas</span>
        <span class="lt-region-status">${escapeHtml(BUNDLE_STATUS_LABEL[item.status] || item.status)}</span>
      </div>
      <div class="sb-children">${item.children.map((child) => `
        <span class="ct-pill sb-child sb-child--${child.status}" title="${escapeHtml(child.error || '')}">
          ${escapeHtml(child.chosenSku || child.sku)}
        </span>`).join('')}</div>
      ${item.error ? `<div class="lt-region-detail">${escapeHtml(item.error)}</div>` : ''}`;
    list.appendChild(li);
  });
}

function renderLog(list, entries) {
  if (!list) return;
  list.innerHTML = '';
  entries.slice(-60).reverse().forEach((entry) => {
    const row = document.createElement('li');
    row.className = `lt-log-item lt-log-item--${entry.level}`;
    row.innerHTML = `<span class="lt-log-time">${formatTime(entry.ts)}</span><span class="lt-log-msg">${escapeHtml(entry.message)}</span>`;
    list.appendChild(row);
  });
}

function toggleButtons(container, run) {
  const active = Boolean(run?.active);
  const finished = Boolean(run && !run.active);
  const start = container.querySelector('#sb-start');
  const stop = container.querySelector('#sb-stop');
  const clear = container.querySelector('#sb-clear');
  if (!start || !stop || !clear) return;
  start.disabled = active;
  stop.disabled = !active;
  clear.classList.toggle('hidden', !finished);
}

function progressTitle(run) {
  if (run.active && run.phase === RUN_PHASE.CHECKING) return 'Revisando el listado...';
  if (run.active) return run.config?.dryRun ? 'Simulando...' : 'Creando bundles...';
  if (run.finishReason === FINISH_REASON.CANCELLED) return 'Proceso detenido';
  if (run.finishReason === FINISH_REASON.ERROR) return 'Proceso con error';
  return run.config?.dryRun ? 'Simulacion terminada' : 'Proceso terminado';
}
