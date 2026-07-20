// Sección "Búsqueda" de LG.com.
//
// El usuario pega uno o varios SKUs (uno por línea) y la extensión busca cada
// uno en el buscador de www.lg.com para saber si el producto APARECE y su
// disponibilidad (con stock / sin stock / descontinuado, según
// data-shop-stock-status). El trabajo lo hace el service worker
// (abre pestañas de fondo EN PARALELO y lee el DOM renderizado) y persiste el
// progreso en STORAGE_KEYS.BUSQUEDA_RUN. Esta vista solo refleja ese estado:
// como lee de storage y escucha storage.onChanged, sobrevive a cambiar de tab o
// cerrar el popup.

import {
  BUSQUEDA_MAX_SKUS,
  BUSQUEDA_POOL,
  BUSQUEDA_POOL_MAX,
  BUSQUEDA_POOL_MIN,
  MESSAGES,
  SEARCH_ESTADO_LABEL,
  SEARCH_FINISH,
  SEARCH_STATUS,
  STORAGE_KEYS,
  buildSearchUrl,
  clampBusquedaPool,
} from '../../constants.js';
import { getStorage, setStorage, removeStorage } from '../../../../shared/storage/storage.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';
import { downloadText, escapeHtml, formatTime } from '../utils.js';

const log = logger('lgcom/popup');

let containerRef = null;
let storageListener = null;

export function render(container) {
  containerRef = container;
  renderShell(container);
  installStorageListener();

  getStorage(STORAGE_KEYS.BUSQUEDA_SKUS).then((value) => {
    if (containerRef !== container) return;
    const ta = container.querySelector('#lg-bus-skus');
    if (ta && typeof value === 'string') ta.value = value;
  });

  getStorage(STORAGE_KEYS.BUSQUEDA_POOL).then((value) => {
    if (containerRef !== container) return;
    const pool = container.querySelector('#lg-bus-pool');
    if (pool && value != null) pool.value = String(clampBusquedaPool(value));
  });

  getStorage(STORAGE_KEYS.BUSQUEDA_RUN).then((run) => {
    if (containerRef !== container) return;
    if (run?.items) renderRun(container, run);
  });
}

function renderShell(container) {
  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Buscar productos por SKU</h3>
        <p class="lt-hint">
          Pega uno o varios <strong>SKUs</strong> (uno por línea) y se buscarán en
          <strong>www.lg.com</strong> para saber si aparecen y su
          <strong>disponibilidad</strong> (con stock / sin stock / descontinuado).
          Cada SKU se abre brevemente en una pestaña de fondo; no necesitas tener
          lg.com abierto. Máximo ${BUSQUEDA_MAX_SKUS} SKUs.
          El proceso corre en segundo plano: puedes cerrar este panel.
        </p>
        <div class="dt-field">
          <label class="dt-label" for="lg-bus-skus">SKUs</label>
          <textarea id="lg-bus-skus" class="dt-input dt-textarea lg-bus-skus"
                    rows="4" placeholder="86MRGB95BSA&#10;OLED55C4PSA&#10;..."></textarea>
        </div>
        <div class="dt-field lg-bus-pool-field">
          <label class="dt-label" for="lg-bus-pool">Pestañas en paralelo</label>
          <select id="lg-bus-pool" class="dt-input lg-bus-pool">${poolOptions()}</select>
          <p class="lt-hint">Cuántos SKUs se buscan a la vez (${BUSQUEDA_POOL_MIN}–${BUSQUEDA_POOL_MAX}). Más pestañas = más rápido, pero más carga.</p>
        </div>
        <div class="lt-actions">
          <button type="button" id="lg-bus-start" class="ct-btn ct-btn--primary">Iniciar</button>
          <button type="button" id="lg-bus-stop" class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="lg-bus-clear" class="ct-btn ct-btn--ghost">Limpiar</button>
          <button type="button" id="lg-bus-export" class="ct-btn ct-btn--ghost" disabled>Exportar CSV</button>
        </div>
      </section>
      <div id="lg-bus-results"></div>
    </div>`;

  container.querySelector('#lg-bus-start')?.addEventListener('click', () => onStart(container));
  container.querySelector('#lg-bus-stop')?.addEventListener('click', () => onStop(container));
  container.querySelector('#lg-bus-clear')?.addEventListener('click', () => onClear(container));
  container.querySelector('#lg-bus-export')?.addEventListener('click', () => onExport());

  const ta = container.querySelector('#lg-bus-skus');
  ta?.addEventListener('input', () => setStorage(STORAGE_KEYS.BUSQUEDA_SKUS, ta.value));

  const pool = container.querySelector('#lg-bus-pool');
  pool?.addEventListener('change', () => setStorage(STORAGE_KEYS.BUSQUEDA_POOL, clampBusquedaPool(pool.value)));
}

// <option> del selector de pestañas en paralelo (BUSQUEDA_POOL_MIN..MAX).
function poolOptions() {
  const opts = [];
  for (let n = BUSQUEDA_POOL_MIN; n <= BUSQUEDA_POOL_MAX; n += 1) {
    const selected = n === BUSQUEDA_POOL ? ' selected' : '';
    opts.push(`<option value="${n}"${selected}>${n}</option>`);
  }
  return opts.join('');
}

// Mantiene la vista al día con el progreso que escribe el service worker.
function installStorageListener() {
  if (storageListener) return;
  storageListener = (changes, area) => {
    if (area !== 'local') return;
    const change = changes[STORAGE_KEYS.BUSQUEDA_RUN];
    if (!change || !containerRef?.isConnected) return;
    if (change.newValue?.items) renderRun(containerRef, change.newValue);
  };
  try { chrome.storage.onChanged.addListener(storageListener); } catch { /* noop */ }
}

function parseSkus(text) {
  const seen = new Set();
  const out = [];
  for (const token of String(text || '').split(/[\n,;]+/)) {
    const sku = token.trim();
    if (!sku) continue;
    const key = sku.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sku);
    if (out.length >= BUSQUEDA_MAX_SKUS) break;
  }
  return out;
}

function showNotice(container, message, hint) {
  const results = container.querySelector('#lg-bus-results');
  if (!results) return;
  results.innerHTML = `
    <div class="ct-state ct-state--warn">
      <p>${escapeHtml(message)}</p>
      ${hint ? `<p class="ct-state-hint">${escapeHtml(hint)}</p>` : ''}
    </div>`;
}

async function onStart(container) {
  const ta = container.querySelector('#lg-bus-skus');
  const skus = parseSkus(ta?.value);

  if (!skus.length) {
    showNotice(container, 'Ingresa al menos un SKU.');
    return;
  }

  const run = await getStorage(STORAGE_KEYS.BUSQUEDA_RUN);
  if (run?.active) {
    showNotice(container, 'Ya hay una búsqueda en curso.');
    return;
  }

  const pool = clampBusquedaPool(container.querySelector('#lg-bus-pool')?.value);

  // El SW arranca y persiste el estado; la UI se actualiza por storage.onChanged.
  try {
    await chrome.runtime.sendMessage({ type: MESSAGES.RUN_BUSQUEDA, skus, pool });
    log.info('busqueda iniciada', { skus: skus.length, pool });
  } catch (err) {
    log.error('busqueda: no se pudo iniciar', new Error(toMessage(err)));
    showNotice(container, 'No se pudo iniciar la búsqueda.', toMessage(err));
  }
}

async function onStop(container) {
  const stopBtn = container.querySelector('#lg-bus-stop');
  if (stopBtn) { stopBtn.disabled = true; stopBtn.textContent = 'Deteniendo…'; }
  try {
    await chrome.runtime.sendMessage({ type: MESSAGES.STOP_BUSQUEDA });
    log.info('busqueda: detención pedida desde el popup');
  } catch (err) {
    log.error('busqueda: no se pudo detener', new Error(toMessage(err)));
  }
}

async function onClear(container) {
  // Si hay una corrida activa, primero la detenemos.
  const run = await getStorage(STORAGE_KEYS.BUSQUEDA_RUN);
  if (run?.active) {
    try { await chrome.runtime.sendMessage({ type: MESSAGES.STOP_BUSQUEDA }); } catch { /* sigue */ }
  }
  await removeStorage(STORAGE_KEYS.BUSQUEDA_RUN);
  await removeStorage(STORAGE_KEYS.BUSQUEDA_SKUS);
  const ta = container.querySelector('#lg-bus-skus');
  if (ta) ta.value = '';
  const results = container.querySelector('#lg-bus-results');
  if (results) results.innerHTML = '';
  const startBtn = container.querySelector('#lg-bus-start');
  const stopBtn = container.querySelector('#lg-bus-stop');
  const exportBtn = container.querySelector('#lg-bus-export');
  const poolSel = container.querySelector('#lg-bus-pool');
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) { stopBtn.disabled = true; stopBtn.textContent = 'Detener'; }
  if (exportBtn) exportBtn.disabled = true;
  if (ta) ta.disabled = false;
  if (poolSel) poolSel.disabled = false;
  log.info('busqueda: limpiada');
}

// Escapa un campo para CSV (comillas/comas/saltos de línea).
function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Arma el CSV "SKU,estado" con las filas ya terminadas de la corrida.
function buildCsv(items) {
  const rows = items
    .filter((it) => SEARCH_ESTADO_LABEL[it.status])
    .map((it) => `${csvCell(it.sku)},${csvCell(SEARCH_ESTADO_LABEL[it.status])}`);
  return ['SKU,estado', ...rows].join('\r\n');
}

async function onExport() {
  const run = await getStorage(STORAGE_KEYS.BUSQUEDA_RUN);
  const items = Array.isArray(run?.items) ? run.items : [];
  const exportable = items.filter((it) => SEARCH_ESTADO_LABEL[it.status]);
  if (!exportable.length) {
    log.warn('busqueda: nada que exportar');
    return;
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadText(buildCsv(items), `busqueda-lgcom-${stamp}.csv`);
  log.info('busqueda: CSV exportado', { filas: exportable.length });
}

// -----------------------------------------------------------------------------
// render del estado de la corrida
// -----------------------------------------------------------------------------

function isTerminal(status) {
  return status === SEARCH_STATUS.FOUND_IN_STOCK ||
    status === SEARCH_STATUS.FOUND_OUT_OF_STOCK ||
    status === SEARCH_STATUS.FOUND_DISCONTINUED ||
    status === SEARCH_STATUS.NOT_FOUND ||
    status === SEARCH_STATUS.ERROR;
}

function renderRun(container, run) {
  const results = container.querySelector('#lg-bus-results');
  const startBtn = container.querySelector('#lg-bus-start');
  const stopBtn = container.querySelector('#lg-bus-stop');
  const clearBtn = container.querySelector('#lg-bus-clear');
  const exportBtn = container.querySelector('#lg-bus-export');
  const ta = container.querySelector('#lg-bus-skus');
  const poolSel = container.querySelector('#lg-bus-pool');
  if (!results) return;

  const items = run.items || [];
  const active = Boolean(run.active);
  const anyTerminal = items.some((it) => isTerminal(it.status));

  // Controles: mientras corre, se bloquea Iniciar, el textarea y el selector de
  // pestañas, y se habilita Detener. Al terminar, se invierte. Exportar se
  // habilita si hay resultados.
  if (startBtn) { startBtn.disabled = active; startBtn.textContent = active ? 'Buscando…' : 'Iniciar'; }
  if (stopBtn) { stopBtn.disabled = !active; if (!active) stopBtn.textContent = 'Detener'; }
  if (clearBtn) clearBtn.disabled = false;
  if (exportBtn) exportBtn.disabled = !anyTerminal;
  if (ta) ta.disabled = active;
  if (poolSel) poolSel.disabled = active;

  if (!items.length) {
    results.innerHTML = `<p class="ct-empty">No hay SKUs para buscar.</p>`;
    return;
  }

  const done = run.doneCount ?? items.filter((it) => isTerminal(it.status)).length;
  const total = run.total ?? items.length;
  const inStock = items.filter((it) => it.status === SEARCH_STATUS.FOUND_IN_STOCK).length;
  const outOfStock = items.filter((it) => it.status === SEARCH_STATUS.FOUND_OUT_OF_STOCK).length;
  const discontinued = items.filter((it) => it.status === SEARCH_STATUS.FOUND_DISCONTINUED).length;
  const notFound = items.filter((it) => it.status === SEARCH_STATUS.NOT_FOUND).length;
  const errors = items.filter((it) => it.status === SEARCH_STATUS.ERROR).length;

  const pct = total ? Math.round((done / total) * 100) : 0;

  const head = active
    ? `
      <div class="lg-dest-progress">
        <div class="lg-dest-progress-top">
          <span><span class="ct-spinner lg-dest-spin"></span>Buscando ${done}/${total} SKUs…</span>
        </div>
        <div class="lg-dest-bar"><span style="width:${pct}%"></span></div>
      </div>`
    : `
      <p class="lg-dest-stamp">${finishLabel(run)}</p>
      <div class="lg-dest-summary">
        <span class="lg-dest-chip lg-dest-chip--ok">${inStock} con stock</span>
        ${outOfStock ? `<span class="lg-dest-chip lg-dest-chip--warn">${outOfStock} sin stock</span>` : ''}
        ${discontinued ? `<span class="lg-dest-chip lg-dest-chip--other">${discontinued} descontinuados</span>` : ''}
        ${notFound ? `<span class="lg-dest-chip lg-dest-chip--bad">${notFound} sin resultados</span>` : ''}
        ${errors ? `<span class="lg-dest-chip lg-dest-chip--other">${errors} con error</span>` : ''}
      </div>`;

  // Preserva si el usuario tenía el Registro abierto entre re-renders en vivo.
  const logWasOpen = results.querySelector('.lg-bus-log')?.open;

  results.innerHTML = `
    ${head}
    <ul class="lg-dest-pages">
      ${items.map(renderItem).join('')}
    </ul>
    ${renderLog(run.log)}`;

  if (logWasOpen) {
    const details = results.querySelector('.lg-bus-log');
    if (details) details.open = true;
  }
}

function finishLabel(run) {
  const when = run.finishedAt ? ` (${escapeHtml(formatTime(run.finishedAt))})` : '';
  if (run.finishReason === SEARCH_FINISH.STOPPED) return `Detenida por el usuario${when}`;
  if (run.finishReason === SEARCH_FINISH.ERROR) return `Finalizada con error${when}`;
  return `Última búsqueda${when}`;
}

function renderLog(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return '';
  const rows = list.slice(-50).reverse().map((e) => `
    <li class="lt-log-item lt-log-item--${escapeHtml(e.level || 'info')}">
      <span class="lt-log-time">${escapeHtml(formatTime(e.ts))}</span>
      <span class="lt-log-msg">${escapeHtml(e.message || '')}</span>
    </li>`).join('');
  return `
    <details class="ct-diag lt-log-details lg-bus-log">
      <summary>Registro (${list.length})</summary>
      <ul class="lt-log">${rows}</ul>
    </details>`;
}

function renderItem(item) {
  const sku = escapeHtml(item.sku || '');
  const searchUrl = escapeHtml(buildSearchUrl(item.sku || ''));

  let badge;
  let body = '';

  switch (item.status) {
    case SEARCH_STATUS.PENDING:
      badge = `<span class="lg-dest-status lg-dest-status--pending">En cola</span>`;
      break;
    case SEARCH_STATUS.CHECKING:
      badge = `<span class="lg-dest-status lg-dest-status--checking"><span class="ct-spinner lg-dest-spin"></span>Buscando…</span>`;
      break;
    case SEARCH_STATUS.FOUND_IN_STOCK:
      badge = `<span class="lg-dest-status lg-dest-status--ok">Con stock</span>`;
      body = renderFound(item, 'Aparece y con stock.', 'ok');
      break;
    case SEARCH_STATUS.FOUND_OUT_OF_STOCK:
      badge = `<span class="lg-dest-status lg-dest-status--warn">Sin stock</span>`;
      body = renderFound(item, 'Aparece pero sin stock.', 'warn');
      break;
    case SEARCH_STATUS.FOUND_DISCONTINUED:
      badge = `<span class="lg-dest-status lg-dest-status--other">Descontinuado</span>`;
      body = renderFound(item, 'Aparece pero descontinuado.', 'other');
      break;
    case SEARCH_STATUS.NOT_FOUND:
      badge = `<span class="lg-dest-status lg-dest-status--bad">Sin resultados</span>`;
      body = `<p class="lg-dest-note">El producto no aparece en el buscador.</p>`;
      break;
    default: // ERROR
      badge = `<span class="lg-dest-status lg-dest-status--err">Error</span>`;
      body = `<p class="lg-dest-note lg-dest-note--err">${escapeHtml(item.error || 'No se pudo leer la página.')}</p>`;
  }

  return `
    <li class="lg-dest-page lg-dest-page--${item.status}">
      <div class="lg-dest-page-head">
        <a class="lg-dest-page-title" href="${searchUrl}" target="_blank" rel="noopener" title="Abrir búsqueda de ${sku}">${sku}</a>
        ${badge}
      </div>
      ${body}
    </li>`;
}

function renderFound(item, noteText, noteKind) {
  const name = escapeHtml(item.modelName || item.foundSku || item.sku || 'Producto');
  const price = item.price ? `<span class="lg-bus-price">${escapeHtml(item.price)}</span>` : '';
  const noteClass = noteKind === 'ok' ? ' lg-dest-note--ok' : noteKind === 'warn' ? ' lg-dest-note--warn' : '';
  return `
    <div class="lg-bus-prod">
      <span class="lg-bus-prod-name">${name}</span>
      ${price}
    </div>
    <p class="lg-dest-note${noteClass}">${escapeHtml(noteText)}</p>`;
}
