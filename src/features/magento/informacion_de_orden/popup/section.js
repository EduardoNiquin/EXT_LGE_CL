// Vista del modulo "Informacion de Orden": pide el rango (y opcionalmente una
// lista de ordenes), lanza la captura y deja el CSV listo para bajar.
//
// La vista solo REFLEJA el estado: el trabajo corre en el content script de la
// pestana del admin y sigue aunque se cierre el panel.

import {
  ADMIN_BASE_RE,
  CONCURRENCY_DEFAULT,
  CONCURRENCY_MIN,
  CONCURRENCY_WARN,
  CSV_MIME,
  DEFAULT_RANGE_DAYS,
  DEFAULT_SECTIONS,
  DETAIL_SECTION_CHOICES,
  DOWNLOAD_FOLDER,
  FINISH_REASON,
  MAX_RANGE_DAYS,
  ORDERS_PER_MINUTE,
  PART_SIZE_DEFAULT,
  PART_SIZE_MAX,
  PART_SIZE_MIN,
  PREVIEW_ROWS,
  RUN_PHASE,
  SOURCE_MODE,
  clampConcurrency,
  clampPartSize,
  partFileName,
} from '../constants.js';
import {
  clearResult,
  clearRun,
  getDraft,
  getResultIndex,
  getRun,
  makeRun,
  readResultPart,
  setDraft,
  setRun,
  subscribeToResult,
  subscribeToRun,
  updateRun,
} from '../state.js';
import {
  CSV_BOM,
  CSV_EOL,
  buildMatrix,
  matrixToCsv,
  matrixToCsvText,
  mergeColumns,
  recordColumnKeys,
} from '../csv.js';
import { describeSummary, formatDuration, summarizeRun } from '../stats.js';
import { downloadBlob, escapeHtml, formatTime } from '../../popup/utils.js';
import { getActiveTab } from '../../../../shared/messaging/messaging.js';
import { logger } from '../../../../shared/utils/logger.js';
import { parseOrderNumbers } from '../parse-input.js';
import { rangeDays, splitDateRange } from '../grid-request.js';
import { toMessage } from '../../../../shared/errors/index.js';

const log = logger('magento/popup');

let unsubscribeRun = null;
let unsubscribeResult = null;
let resultsTimer = null;

// El resultado se vuelca varias veces por minuto y cada volcado trae TODOS los
// registros: repintar la tabla en cada uno era leer y matrizar miles de filas
// por cada avance. Se repinta como mucho cada tanto, leyendo lo ultimo.
const RESULTS_RENDER_THROTTLE_MS = 2000;

// Copiar al portapapeles arma TODO el CSV como un solo string en memoria, que es
// justo lo que la exportacion por partes evita: con muchas filas se avisa.
const COPY_WARN_ROWS = 2000;

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
          <span>Deja una pestana abierta en el admin de Magento con la sesion iniciada. Magento filtra hasta ${MAX_RANGE_DAYS + 1} dias por consulta; un rango mas largo se pide en bloques y se junta solo. <strong>No hay tope de ordenes</strong>, pero el ritmo es de ~${ORDERS_PER_MINUTE} fichas/min: 47.000 ordenes son unas 20 h con esta pestana abierta. Para una corrida asi, marca "bajar cada archivo al cerrarlo".</span>
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
            <input type="number" id="io-concurrency" class="dt-input" min="${CONCURRENCY_MIN}" step="1" value="${clampConcurrency(config.concurrency)}">
          </div>
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="io-part-size">Ordenes por archivo</label>
            <input type="number" id="io-part-size" class="dt-input" min="${PART_SIZE_MIN}" max="${PART_SIZE_MAX}" step="50" value="${clampPartSize(config.partSize)}">
          </div>
        </div>
        <p class="lt-hint" id="io-concurrency-hint"></p>
        <label class="dt-check">
          <input type="checkbox" id="io-auto-download" ${config.autoDownload ? 'checked' : ''}>
          <span>Bajar cada archivo al cerrarlo (copia de respaldo)</span>
        </label>
        <p class="lt-hint" id="io-part-size-hint"></p>

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
        <p id="io-progress-timing" class="lt-hint"></p>

        <div class="io-results-head">
          <span class="lt-hint" id="io-results-summary"></span>
          <div class="io-results-actions">
            <label class="dt-check io-columns-toggle" title="Agrega cliente, direcciones, cupones y logs ERP/OSMS. No cambia lo capturado, solo lo que se muestra y se exporta.">
              <input type="checkbox" id="io-all-columns" ${config.allColumns ? 'checked' : ''}>
              <span>Todas las columnas</span>
            </label>
            <button type="button" id="io-copy" class="ct-btn ct-btn--ghost">Copiar CSV</button>
            <button type="button" id="io-export-joined" class="ct-btn ct-btn--ghost hidden" title="Un solo archivo con las filas de todos los archivos y el encabezado una sola vez.">Descargar todo unido</button>
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
  container.querySelector('#io-export').addEventListener('click', () => onExport(container));
  container.querySelector('#io-export-joined').addEventListener('click', () => onExportJoined(container));
  container.querySelector('#io-all-columns').addEventListener('change', () => {
    persistDraft(container);
    renderResults(container);
  });
  container.querySelector('#io-copy').addEventListener('click', (event) => onCopy(container, event.currentTarget));

  updateRangeHint(container);
  updateOrdersHint(container);
  updateConcurrencyHint(container);
  updatePartSizeHint(container);
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
    scheduleRenderResults(container);
  });
}

function scheduleRenderResults(container) {
  if (resultsTimer) return;
  resultsTimer = setTimeout(() => {
    resultsTimer = null;
    if (alive(container)) renderResults(container);
  }, RESULTS_RENDER_THROTTLE_MS);
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

  // El campo no tiene tope, pero 0, vacio o "abc" dejarian el pool sin carriles:
  // se escribe de vuelta el valor que realmente se va a usar.
  const concurrency = container.querySelector('#io-concurrency');
  concurrency.addEventListener('input', () => updateConcurrencyHint(container));
  concurrency.addEventListener('change', () => {
    concurrency.value = clampConcurrency(concurrency.value);
    updateConcurrencyHint(container);
    persistDraft(container);
  });

  // Cuantas ordenes entran en cada CSV. No cambia lo que se captura: cambia en
  // cuantos archivos queda el resultado y, sobre todo, cuanto se reescribe en
  // cada guardado durante la corrida.
  const partSize = container.querySelector('#io-part-size');
  partSize.addEventListener('input', () => updatePartSizeHint(container));
  partSize.addEventListener('change', () => {
    partSize.value = clampPartSize(partSize.value);
    updatePartSizeHint(container);
    persistDraft(container);
  });

  container.querySelector('#io-auto-download').addEventListener('change', () => {
    updatePartSizeHint(container);
    persistDraft(container);
  });

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
    partSize: clampPartSize(container.querySelector('#io-part-size').value),
    autoDownload: !!container.querySelector('#io-auto-download')?.checked,
    sections: readSections(container),
    allColumns: !!container.querySelector('#io-all-columns')?.checked,
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
    partSize: PART_SIZE_DEFAULT,
    autoDownload: false,
    sections: { ...DEFAULT_SECTIONS },
    // Por defecto solo las columnas que se miran a diario (ESSENTIAL_COLUMNS).
    allColumns: false,
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
    const blocks = splitDateRange(from, to).length;
    hint.textContent = `Rango de ${days + 1} dias: se consultara en ${blocks} bloques de hasta ${MAX_RANGE_DAYS + 1} dias y se juntaran los resultados.`;
    return;
  }
  hint.textContent = `Rango de ${days + 1} dia(s).`;
}

function updateConcurrencyHint(container) {
  const hint = container.querySelector('#io-concurrency-hint');
  if (!hint) return;
  const value = clampConcurrency(container.querySelector('#io-concurrency').value);
  const high = value >= CONCURRENCY_WARN;
  hint.classList.toggle('io-hint--warn', high);
  hint.textContent = high
    ? `${value} a la vez: por encima de ${CONCURRENCY_WARN - 1} el tunel de la VPN ya va lleno y solo se alargan las descargas (medido: 6 y 12 carriles rinden igual). Bajalo.`
    : `Sin tope; ${CONCURRENCY_DEFAULT} por defecto. El limite es el tunel de la VPN (~320 KB/s con fichas de ~600 KB), asi que entre 4 y 8 rinde lo mismo: unas 30 fichas por minuto.`;
}

function updatePartSizeHint(container) {
  const hint = container.querySelector('#io-part-size-hint');
  if (!hint) return;
  const value = clampPartSize(container.querySelector('#io-part-size').value);
  const auto = !!container.querySelector('#io-auto-download')?.checked;
  const base = `El resultado se corta en archivos de ${value} orden(es) (entre ${PART_SIZE_MIN} y ${PART_SIZE_MAX}). Un rango amplio en un solo archivo se cae por memoria, porque cada guardado reescribe todo lo capturado. Al terminar se bajan de a uno o todos unidos.`;
  hint.textContent = auto
    ? `${base} Con la copia de respaldo marcada, cada ${value} ordenes ese CSV se guarda solo en Descargas/${DOWNLOAD_FOLDER}/<fecha>/parte-001.csv, numerado en orden: si la pestana se cierra a mitad de camino, lo bajado ya esta a salvo. Esos archivos llevan las columnas conocidas al cerrar cada parte.`
    : base;
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
  // Un rango largo ya no se rechaza: se parte en ventanas de las que Magento si
  // acepta y los resultados se juntan.
  const blocks = splitDateRange(form.from, form.to).length;
  if (blocks > 1) log.info(`el rango se consultara en ${blocks} bloques`);

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
      partSize: form.partSize,
      autoDownload: form.autoDownload,
      // El perfil de columnas de los archivos que se bajan solos hay que
      // decidirlo ANTES de correr: se toma el que esta marcado al iniciar.
      allColumns: form.allColumns,
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

/**
 * Un archivo por parte. Cada parte se lee, se convierte y se baja antes de pasar
 * a la siguiente: en ningun momento hay mas de una parte en memoria, que es todo
 * el punto de haberlas cortado.
 */
async function onExport(container) {
  const context = await loadExport(container, 'exportar');
  if (!context) return;
  const { index, allColumns, columns, stamp } = context;
  const total = index.parts.length;
  const button = container.querySelector('#io-export');

  await withBusy(button, total > 1 ? `Bajando 1/${total}...` : 'Bajando...', async () => {
    for (const part of index.parts) {
      const matrix = buildMatrix(await readResultPart(part), { allColumns, columns });
      if (!matrix.rows.length) continue;
      const blob = new Blob([matrixToCsv(matrix)], { type: CSV_MIME });
      await downloadBlob(blob, exportFileName(stamp, part.index, total));
      if (total > 1) button.textContent = `Bajando ${part.index + 2}/${total}...`;
    }
  });
}

/**
 * Las partes en un solo archivo: el encabezado una vez y despues las filas de
 * cada una. El texto no se concatena --se junta como pedazos de un Blob--, asi
 * que lo unico grande que se arma es el archivo mismo.
 *
 * Es correcto anexar las filas de una parte debajo de otra porque todas las
 * partes comparten el encabezado (`columns`).
 */
async function onExportJoined(container) {
  const context = await loadExport(container, 'unir');
  if (!context) return;
  const { index, allColumns, columns, stamp } = context;

  await withBusy(container.querySelector('#io-export-joined'), 'Uniendo...', async () => {
    const pieces = [];
    for (const part of index.parts) {
      const matrix = buildMatrix(await readResultPart(part), { allColumns, columns });
      if (!pieces.length) pieces.push(`${CSV_BOM}${matrixToCsvText({ headers: matrix.headers, rows: [] })}`);
      if (!matrix.rows.length) continue;
      pieces.push(CSV_EOL + matrixToCsvText(matrix, { header: false }));
    }
    if (pieces.length < 2) {
      alert('Todavia no hay filas para exportar.');
      return;
    }
    await downloadBlob(new Blob(pieces, { type: CSV_MIME }), `magento-ordenes-${stamp}-completo.csv`);
  });
}

async function onCopy(container, button) {
  const context = await loadExport(container, 'copiar');
  if (!context) return;
  const { index, allColumns, columns } = context;
  if (index.total > COPY_WARN_ROWS
    && !confirm(`Son ${index.total} filas: copiarlas arma todo el CSV en memoria y puede colgar el panel. Para un resultado asi conviene "Descargar todo unido". Copiar igual?`)) {
    return;
  }

  const original = button.textContent;
  await withBusy(button, 'Copiando...', async () => {
    const pieces = [];
    for (const part of index.parts) {
      const matrix = buildMatrix(await readResultPart(part), { allColumns, columns });
      if (!pieces.length) pieces.push(`${CSV_BOM}${matrixToCsvText({ headers: matrix.headers, rows: [] })}`);
      if (matrix.rows.length) pieces.push(CSV_EOL + matrixToCsvText(matrix, { header: false }));
    }
    const text = pieces.join('');
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
  });
  button.textContent = 'Copiado';
  setTimeout(() => { button.textContent = original; }, 1200);
}

/** Lo que necesita cualquier exportacion, o null si no hay nada que exportar. */
async function loadExport(container, verb) {
  const index = await getResultIndex();
  if (!index?.total) {
    alert(`Todavia no hay filas para ${verb}.`);
    return null;
  }
  const allColumns = readAllColumns(container);
  return {
    index,
    allColumns,
    columns: await resolveColumns(index, allColumns),
    stamp: new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'),
  };
}

/**
 * El encabezado comun de todas las partes. Con el perfil corto las columnas son
 * fijas (null: las pone `buildMatrix`); con "todas las columnas" es la union de
 * la corrida, que el indice ya trae.
 *
 * Un resultado capturado ANTES de las partes no la trae: se recorre para
 * calcularla, porque exportar cada archivo con la union de sus propias filas
 * daria encabezados distintos entre archivos, y unirlos seria imposible.
 */
async function resolveColumns(index, allColumns) {
  if (!allColumns) return null;
  if (index.columns?.length) return index.columns;
  let columns = [];
  for (const part of index.parts) {
    for (const record of await readResultPart(part)) {
      columns = mergeColumns(columns, recordColumnKeys(record));
    }
  }
  return columns;
}

/**
 * Varias partes van a su propia carpeta y numeradas (`partFileName`, el mismo
 * nombre que usa la descarga automatica); una sola parte es un archivo suelto.
 */
function exportFileName(stamp, partIndex, total) {
  return total > 1 ? partFileName(stamp, partIndex, total) : `magento-ordenes-${stamp}.csv`;
}

/** Deja el boton fuera de juego mientras dura la exportacion. */
async function withBusy(button, label, task) {
  if (!button) return task();
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await task();
  } catch (err) {
    alert(`No se pudo completar la descarga: ${toMessage(err)}`);
    return undefined;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function readAllColumns(container) {
  return !!container?.querySelector('#io-all-columns')?.checked;
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
  container.querySelector('#io-progress-timing').textContent = progressTiming(run);
  renderLog(container.querySelector('#io-log'), run.log || []);
}

/** Ritmo, lo que falta y donde se va el tiempo de cada ficha. */
function progressTiming(run) {
  const summary = summarizeRun(run);
  if (!summary) return '';
  const parts = [describeSummary(summary)];
  if (run.active && summary.pending && summary.etaMs != null) {
    parts.push(`faltan ~${formatDuration(summary.etaMs)}`);
  } else if (!run.active) {
    parts.push(`en ${formatDuration(summary.elapsedMs)}`);
  }
  return parts.join(' - ');
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

  const index = await getResultIndex();
  if (!alive(container)) return;
  updateExportButtons(container, index);

  if (!index?.total) {
    wrap.innerHTML = '<p class="ct-empty">Sin datos todavia.</p>';
    if (summary) summary.textContent = '';
    return;
  }

  // La vista previa sale de la PRIMERA parte y nunca de todo el resultado: leer
  // y matrizar miles de registros para mostrar 150 filas es justo lo que hacia
  // caer al panel con un rango amplio.
  const records = await readResultPart(index.parts[0]);
  if (!alive(container)) return;

  // La misma matriz que el CSV: lo que se ve es lo que se exporta.
  const allColumns = readAllColumns(container);
  const { headers, rows } = buildMatrix(records.slice(0, PREVIEW_ROWS), {
    allColumns,
    columns: index.columns,
  });
  wrap.innerHTML = `
    <table class="io-table">
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${row.map((cell) => `<td title="${escapeHtml(cell)}">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>`;
  if (summary) summary.textContent = describeResult(index, rows.length);
}

function describeResult(index, shown) {
  const files = index.parts.length;
  const parts = [`${index.total} fila(s)`];
  if (files > 1) parts.push(`en ${files} archivos de hasta ${index.partSize}`);
  if (index.total > shown) parts.push(`se muestran las primeras ${shown}`);
  return `${parts.join(' - ')}.`;
}

/** "Descargar CSV" dice cuantos archivos son, y unir solo aparece si hay varios. */
function updateExportButtons(container, index) {
  const files = index?.parts?.length || 0;
  const exportBtn = container.querySelector('#io-export');
  const joinBtn = container.querySelector('#io-export-joined');
  if (exportBtn) exportBtn.textContent = files > 1 ? `Descargar ${files} archivos` : 'Descargar CSV';
  if (joinBtn) joinBtn.classList.toggle('hidden', files < 2);
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
