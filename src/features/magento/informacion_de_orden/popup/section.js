// Vista del modulo "Informacion de Orden": pide el rango (y opcionalmente una
// lista de ordenes), lanza la captura y deja el CSV listo para bajar.
//
// La vista solo REFLEJA el estado: el trabajo corre en el content script de la
// pestana del admin y sigue aunque se cierre el panel.

import {
  ADMIN_BASE_RE,
  CONCURRENCY_DEFAULT,
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  DEFAULT_RANGE_DAYS,
  DEFAULT_SECTIONS,
  DETAIL_SECTION_CHOICES,
  FINISH_REASON,
  MAX_RANGE_DAYS,
  PREVIEW_ROWS,
  RUN_PHASE,
  SOURCE_MODE,
  clampConcurrency,
} from '../constants.js';
import {
  clearResult,
  clearRun,
  getDraft,
  getResult,
  getRun,
  makeRun,
  setDraft,
  setRun,
  subscribeToResult,
  subscribeToRun,
  updateRun,
} from '../state.js';
import { buildMatrix, matrixToCsv } from '../csv.js';
import { downloadText, escapeHtml, formatTime } from '../../popup/utils.js';
import { getActiveTab } from '../../../../shared/messaging/messaging.js';
import { logger } from '../../../../shared/utils/logger.js';
import { parseOrderNumbers } from '../parse-input.js';
import { rangeDays } from '../grid-request.js';
import { toMessage } from '../../../../shared/errors/index.js';

const log = logger('magento/popup');

let unsubscribeRun = null;
let unsubscribeResult = null;

const PHASE_TITLE = {
  [RUN_PHASE.STARTING]: 'Preparando...',
  [RUN_PHASE.ENDPOINT]: 'Resolviendo la sesion del admin...',
  [RUN_PHASE.DISCOVERING]: 'Buscando las ordenes y sus enlaces...',
  [RUN_PHASE.FETCHING]: 'Entrando a la ficha de cada orden...',
  [RUN_PHASE.BUILDING]: 'Armando el CSV...',
  [RUN_PHASE.DONE]: 'Captura terminada',
};

const FINISH_TITLE = {
  [FINISH_REASON.DONE]: 'Captura terminada',
  [FINISH_REASON.CANCELLED]: 'Captura detenida',
  [FINISH_REASON.ERROR]: 'La captura fallo',
  [FINISH_REASON.NOT_DETECTED]: 'No se encontro el admin de Magento',
};

export async function render(container) {
  if (unsubscribeRun) unsubscribeRun();
  if (unsubscribeResult) unsubscribeResult();

  const [run, draft] = await Promise.all([getRun(), getDraft()]);
  const config = { ...defaultConfig(), ...(draft || {}) };

  container.innerHTML = `
    <div class="lt-view io-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Informacion de Orden</h3>
        <p class="lt-hint">Entra a la ficha de cada orden del rango y deja lo que hay ahi en un CSV, una fila por orden: cliente y direcciones completas, items, totales, pago e historial. Pide las paginas con tu misma sesion, sin navegar la pestana ni abrir ventanas.</p>
        <div class="mg-notice">
          <strong>Antes de iniciar</strong>
          <span>Deja una pestana abierta en el admin de Magento con la sesion iniciada. Magento exige un rango de fechas de hasta ${MAX_RANGE_DAYS} dias.</span>
        </div>

        <div class="dt-row">
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="io-from">Desde</label>
            <input type="date" id="io-from" class="dt-input" value="${escapeHtml(config.from)}">
          </div>
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="io-to">Hasta</label>
            <input type="date" id="io-to" class="dt-input" value="${escapeHtml(config.to)}">
          </div>
        </div>
        <p class="lt-hint" id="io-range-hint"></p>

        <div class="io-modes">
          <label class="dt-check">
            <input type="radio" name="io-mode" value="${SOURCE_MODE.RANGE}" ${config.mode !== SOURCE_MODE.LIST ? 'checked' : ''}>
            <span>Todo el rango</span>
          </label>
          <label class="dt-check">
            <input type="radio" name="io-mode" value="${SOURCE_MODE.LIST}" ${config.mode === SOURCE_MODE.LIST ? 'checked' : ''}>
            <span>Solo estas ordenes</span>
          </label>
        </div>

        <div class="io-list-block ${config.mode === SOURCE_MODE.LIST ? '' : 'hidden'}" id="io-list-block">
          <div class="dt-field">
            <label class="dt-label" for="io-orders">Numeros de orden (coma, punto y coma o un salto de linea)</label>
            <textarea id="io-orders" class="dt-input io-textarea" rows="4" placeholder="123001427905, 123001427943">${escapeHtml(config.orders)}</textarea>
          </div>
          <div class="io-file-row">
            <label class="ct-btn ct-btn--ghost io-file-btn">
              Subir CSV
              <input type="file" id="io-file" accept=".csv,.txt,text/csv,text/plain" hidden>
            </label>
            <span class="lt-hint" id="io-orders-hint"></span>
          </div>
        </div>

        <div class="dt-row">
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="io-concurrency">Consultas simultaneas</label>
            <select id="io-concurrency" class="dt-input">
              ${concurrencyOptions(config.concurrency)}
            </select>
          </div>
        </div>

        <div class="io-sections">
          <p class="dt-label">Que capturar de cada ficha</p>
          ${DETAIL_SECTION_CHOICES.map((choice) => `
            <label class="dt-check io-section">
              <input type="checkbox" data-section="${choice.key}" ${config.sections?.[choice.key] === false ? '' : 'checked'}>
              <span>
                <strong>${escapeHtml(choice.label)}</strong>
                <em class="lt-hint">${escapeHtml(choice.hint)}</em>
              </span>
            </label>`).join('')}
        </div>
        <p class="lt-hint io-raw-warning" id="io-raw-warning">
          La ficha trae los datos del cliente SIN enmascarar (nombre y correo completos, direccion con numero y telefono). Trata el archivo como dato sensible.
        </p>

        <div class="lt-actions">
          <button type="button" id="io-start" class="ct-btn ct-btn--primary">Iniciar captura</button>
          <button type="button" id="io-stop" class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="io-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      <section id="io-progress" class="lt-progress hidden">
        <div class="lt-progress-head">
          <strong id="io-progress-title">Preparando...</strong>
          <span id="io-progress-counter" class="dt-progress-counter"></span>
        </div>
        <div id="io-progress-bar" class="lt-progress-bar"><span></span></div>
        <p id="io-progress-detail" class="lt-hint"></p>

        <div class="io-results-head">
          <span class="lt-hint" id="io-results-summary"></span>
          <div class="io-results-actions">
            <button type="button" id="io-copy" class="ct-btn ct-btn--ghost">Copiar CSV</button>
            <button type="button" id="io-export" class="ct-btn ct-btn--primary">Descargar CSV</button>
          </div>
        </div>
        <div id="io-table-wrap" class="io-table-wrap"><p class="ct-empty">Sin datos todavia.</p></div>

        <details class="ct-diag lt-log-details">
          <summary>Registro</summary>
          <ul id="io-log" class="lt-log"></ul>
        </details>
      </section>
    </div>`;

  wireForm(container);
  container.querySelector('#io-start').addEventListener('click', () => onStart(container));
  container.querySelector('#io-stop').addEventListener('click', onStop);
  container.querySelector('#io-clear').addEventListener('click', () => onClear(container));
  container.querySelector('#io-export').addEventListener('click', onExport);
  container.querySelector('#io-copy').addEventListener('click', (event) => onCopy(event.currentTarget));

  updateRangeHint(container);
  updateOrdersHint(container);
  if (run) renderProgress(container, run);
  toggleButtons(container, run);
  renderResults(container);

  unsubscribeRun = subscribeToRun((newRun) => {
    // El popup no llama a un unmount: si el usuario volvio al menu, este
    // contenedor ya no esta en el documento y seguir pintandolo revienta.
    if (!alive(container)) return;
    if (newRun) renderProgress(container, newRun);
    else container.querySelector('#io-progress')?.classList.add('hidden');
    toggleButtons(container, newRun);
  });

  unsubscribeResult = subscribeToResult(() => {
    if (!alive(container)) return;
    renderResults(container);
  });
}

function alive(container) {
  if (container.isConnected) return true;
  unsubscribeRun?.();
  unsubscribeResult?.();
  unsubscribeRun = null;
  unsubscribeResult = null;
  return false;
}

// -----------------------------------------------------------------------------
// formulario
// -----------------------------------------------------------------------------

function concurrencyOptions(selected) {
  const value = clampConcurrency(selected);
  const options = [];
  for (let n = CONCURRENCY_MIN; n <= CONCURRENCY_MAX; n += 1) {
    options.push(`<option value="${n}" ${n === value ? 'selected' : ''}>${n}</option>`);
  }
  return options.join('');
}

function wireForm(container) {
  container.querySelectorAll('#io-from, #io-to').forEach((input) => {
    input.addEventListener('change', () => {
      updateRangeHint(container);
      persistDraft(container);
    });
  });

  container.querySelectorAll('input[name="io-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const isList = readMode(container) === SOURCE_MODE.LIST;
      container.querySelector('#io-list-block').classList.toggle('hidden', !isList);
      persistDraft(container);
    });
  });

  container.querySelector('#io-orders').addEventListener('input', () => {
    updateOrdersHint(container);
    persistDraft(container);
  });

  container.querySelector('#io-concurrency').addEventListener('change', () => persistDraft(container));

  container.querySelectorAll('[data-section]').forEach((box) => {
    box.addEventListener('change', () => persistDraft(container));
  });

  container.querySelector('#io-file').addEventListener('change', (event) => onFile(container, event.currentTarget));
}

function readMode(container) {
  const checked = container.querySelector('input[name="io-mode"]:checked');
  return checked?.value === SOURCE_MODE.LIST ? SOURCE_MODE.LIST : SOURCE_MODE.RANGE;
}

function readSections(container) {
  const sections = {};
  container.querySelectorAll('[data-section]').forEach((box) => {
    sections[box.dataset.section] = box.checked;
  });
  return sections;
}

function readConfig(container) {
  return {
    from: container.querySelector('#io-from').value,
    to: container.querySelector('#io-to').value,
    mode: readMode(container),
    orders: container.querySelector('#io-orders').value,
    concurrency: clampConcurrency(container.querySelector('#io-concurrency').value),
    sections: readSections(container),
  };
}

function persistDraft(container) {
  setDraft(readConfig(container)).catch((err) => log.warn('no se pudo guardar el borrador', err));
}

function defaultConfig() {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - DEFAULT_RANGE_DAYS);
  return {
    from: isoDate(from),
    to: isoDate(today),
    mode: SOURCE_MODE.RANGE,
    orders: '',
    concurrency: CONCURRENCY_DEFAULT,
    sections: { ...DEFAULT_SECTIONS },
  };
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function updateRangeHint(container) {
  const hint = container.querySelector('#io-range-hint');
  const { from, to } = readConfig(container);
  const days = rangeDays(from, to);
  hint.classList.remove('io-hint--error');

  if (Number.isNaN(days)) {
    hint.textContent = 'Indica el rango de fechas (Magento lo exige para filtrar el listado).';
    hint.classList.add('io-hint--error');
    return;
  }
  if (days < 0) {
    hint.textContent = 'La fecha "Hasta" es anterior a "Desde".';
    hint.classList.add('io-hint--error');
    return;
  }
  if (days > MAX_RANGE_DAYS) {
    hint.textContent = `El rango es de ${days + 1} dias. Magento corta en 1 mes: usa ${MAX_RANGE_DAYS} dias o menos.`;
    hint.classList.add('io-hint--error');
    return;
  }
  hint.textContent = `Rango de ${days + 1} dia(s).`;
}

function updateOrdersHint(container) {
  const hint = container.querySelector('#io-orders-hint');
  const { numbers, warnings } = parseOrderNumbers(container.querySelector('#io-orders').value);
  const parts = [`${numbers.length} orden(es) reconocidas.`, ...warnings];
  hint.textContent = parts.join(' ');
}

async function onFile(container, input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    container.querySelector('#io-orders').value = text;
    updateOrdersHint(container);
    persistDraft(container);
  } catch (err) {
    alert(`No se pudo leer el archivo: ${toMessage(err)}`);
  } finally {
    input.value = '';
  }
}

// -----------------------------------------------------------------------------
// acciones
// -----------------------------------------------------------------------------

async function onStart(container) {
  const current = await getRun();
  if (current?.active) return;

  const form = readConfig(container);
  const days = rangeDays(form.from, form.to);
  if (Number.isNaN(days)) {
    alert('Indica el rango de fechas: Magento lo exige para filtrar el listado de ordenes.');
    return;
  }
  if (days < 0) {
    alert('La fecha "Hasta" es anterior a "Desde".');
    return;
  }
  if (days > MAX_RANGE_DAYS) {
    alert(`El rango no puede superar ${MAX_RANGE_DAYS} dias: Magento rechaza la consulta.`);
    return;
  }

  const { numbers } = parseOrderNumbers(form.orders);
  if (form.mode === SOURCE_MODE.LIST && !numbers.length) {
    alert('No se reconocio ningun numero de orden. Pega la lista o sube un CSV.');
    return;
  }

  try {
    const tab = await getActiveTab();
    if (!ADMIN_BASE_RE.test(tab.url || '')) {
      alert('Abre el admin de Magento (/obsadm) en esta pestana y vuelve a iniciar: la captura usa la sesion de esa pagina.');
      return;
    }
  } catch (err) {
    log.warn('no se pudo leer la pestana activa', err);
  }

  await setDraft(form);
  await clearResult();
  await setRun(makeRun({
    config: {
      from: form.from,
      to: form.to,
      mode: form.mode,
      orderNumbers: form.mode === SOURCE_MODE.LIST ? numbers : [],
      concurrency: form.concurrency,
      sections: form.sections,
    },
  }));

  const run = await getRun();
  if (run) renderProgress(container, run);
  toggleButtons(container, run);
  renderResults(container);
}

async function onStop() {
  if (!confirm('Detener la captura? Se conserva lo capturado hasta ahora.')) return;
  await updateRun((run) => ({
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: FINISH_REASON.CANCELLED,
  }));
}

async function onClear(container) {
  if (!confirm('Limpiar el resultado de la ultima captura?')) return;
  await Promise.all([clearRun(), clearResult()]);
  container.querySelector('#io-progress')?.classList.add('hidden');
  renderResults(container);
}

async function onExport() {
  const matrix = await currentMatrix();
  if (!matrix.rows.length) {
    alert('Todavia no hay filas para exportar.');
    return;
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadText(matrixToCsv(matrix), `magento-ordenes-${stamp}.csv`);
}

async function onCopy(button) {
  const matrix = await currentMatrix();
  if (!matrix.rows.length) {
    alert('Todavia no hay filas para copiar.');
    return;
  }
  const text = matrixToCsv(matrix);
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const helper = document.createElement('textarea');
    helper.value = text;
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
  }
  button.textContent = 'Copiado';
  setTimeout(() => { button.textContent = original; }, 1200);
}

async function currentMatrix() {
  const result = await getResult();
  return buildMatrix(result?.records || []);
}

// -----------------------------------------------------------------------------
// render
// -----------------------------------------------------------------------------

function renderProgress(container, run) {
  const section = container.querySelector('#io-progress');
  if (!section) return;
  section.classList.remove('hidden');

  const total = run.total || 0;
  const done = run.doneCount || 0;
  container.querySelector('#io-progress-title').textContent = progressTitle(run);
  container.querySelector('#io-progress-counter').textContent = total ? `${done} / ${total}` : '';

  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const bar = container.querySelector('#io-progress-bar span');
  if (bar) bar.style.width = `${pct}%`;

  container.querySelector('#io-progress-detail').textContent = progressDetail(run);
  renderLog(container.querySelector('#io-log'), run.log || []);
}

function progressTitle(run) {
  if (!run.active && run.finishReason) return FINISH_TITLE[run.finishReason] || 'Captura terminada';
  return PHASE_TITLE[run.phase] || 'Capturando ordenes...';
}

function progressDetail(run) {
  if (run.error) return run.error;
  const parts = [];
  if (run.totalRecords) parts.push(`${run.totalRecords} orden(es) en el rango`);
  if (run.okCount) parts.push(`${run.okCount} capturada(s)`);
  if (run.notFoundCount) parts.push(`${run.notFoundCount} no encontrada(s)`);
  if (run.errorCount) parts.push(`${run.errorCount} con error`);
  return parts.join(' - ');
}

async function renderResults(container) {
  const wrap = container.querySelector('#io-table-wrap');
  const summary = container.querySelector('#io-results-summary');
  if (!wrap) return;

  const result = await getResult();
  if (!alive(container)) return;

  const records = result?.records || [];
  if (!records.length) {
    wrap.innerHTML = '<p class="ct-empty">Sin datos todavia.</p>';
    if (summary) summary.textContent = '';
    return;
  }

  // La misma matriz que el CSV: lo que se ve es lo que se exporta.
  const { headers, rows } = buildMatrix(records);
  const visible = rows.slice(0, PREVIEW_ROWS);
  wrap.innerHTML = `
    <table class="io-table">
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>
        ${visible.map((row) => `<tr>${row.map((cell) => `<td title="${escapeHtml(cell)}">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>`;
  if (summary) {
    summary.textContent = rows.length > visible.length
      ? `Se muestran ${visible.length} de ${rows.length} filas.`
      : `${rows.length} fila(s).`;
  }
}

function renderLog(list, entries) {
  if (!list) return;
  list.innerHTML = entries.slice(-60).reverse().map((entry) => `
    <li class="lt-log-item lt-log-item--${escapeHtml(entry.level || 'info')}">
      <span class="lt-log-time">${formatTime(entry.ts)}</span>
      <span class="lt-log-msg">${escapeHtml(entry.message || '')}</span>
    </li>`).join('');
}

function toggleButtons(container, run) {
  const active = !!run?.active;
  const finished = !!run && !run.active;
  container.querySelector('#io-start').disabled = active;
  container.querySelector('#io-stop').disabled = !active;
  container.querySelector('#io-clear').classList.toggle('hidden', !finished);
}
