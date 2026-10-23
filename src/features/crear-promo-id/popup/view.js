// Popup de "Crear Promo-Id": datos de la promo + lista de SKUs -> crear.
// La corrida busca los SKUs en GP1, arma la promo con los que existen y reporta
// los que no. Se guarda en STG; el SAVE TO PROD queda para la persona.

import { read, utils } from 'xlsx';
import {
  CATEGORY_MODE, FINISH_REASON, GP1_ORIGIN, LIMITS, MESSAGES, PAGE_URL,
  RUN_PHASE, RUN_PHASE_LABEL, SKU_STATUS, SKU_STATUS_LABEL, STALE_MS,
} from '../constants.js';
import { csvToMatrix, parseSkuMatrix, parseSkuText } from '../parse-input.js';
import { validateConfig } from '../resolve.js';
import {
  clearRun, getDraft, getRun, makeRun, setDraft, setRun, subscribeToRun, updateRun,
} from '../state.js';
import {
  clearTrace, createTrace, formatTraceTime, readTrace, subscribeTrace, traceToText,
} from '../trace.js';
import { getActiveTab } from '../../../shared/messaging/messaging.js';
import { escapeHtml, formatTime } from '../../../shared/ui/format.js';
import { debounce } from '../../../shared/ui/persist.js';
import { fileIntakeHtml, wireFileIntake } from '../../../shared/ui/file-intake.js';
import { toMessage } from '../../../shared/errors/index.js';

const trace = createTrace('popup');

const PHASES = [
  RUN_PHASE.RESOLVING, RUN_PHASE.OPENING, RUN_PHASE.FILLING, RUN_PHASE.MODELS,
  RUN_PHASE.MAIN, RUN_PHASE.SAVING, RUN_PHASE.FINDING,
];
const PROBLEM = new Set([SKU_STATUS.NOT_FOUND, SKU_STATUS.AMBIGUOUS, SKU_STATUS.REPEATED]);

let cleanups = [];
// Estado en memoria de la vista (se espeja en el borrador).
let view = null;

function pad(n) {
  return String(n).padStart(2, '0');
}

function isoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return isoDate(new Date(y, m - 1 + months, d));
}

function defaultDraft() {
  const today = isoDate(new Date());
  return {
    config: {
      title: '', tag: '', bodyCopy: '',
      startDate: today, endDate: addMonths(today, 1),
      displayDate: true, reviewUse: true, hiddenUse: false,
      dryRun: false,
    },
    source: 'text',
    text: '',
    fileName: '',
    fileSkus: [],
    mainText: '',
    categoryMode: CATEGORY_MODE.ALL,
  };
}

const saveDraft = debounce(() => { if (view) setDraft(view.draft).catch(() => {}); }, 300);

function currentSkus() {
  const d = view.draft;
  return d.source === 'file' ? d.fileSkus : parseSkuText(d.text).skus;
}

function mainSkus() {
  return parseSkuText(view.draft.mainText).skus;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export async function render(container) {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  const [draft, run] = await Promise.all([getDraft(), getRun()]);
  const base = defaultDraft();
  view = { draft: { ...base, ...(draft || {}), config: { ...base.config, ...(draft?.config || {}) } } };
  const c = view.draft.config;
  trace.debug('popup abierto', { run: run ? { id: run.id, active: run.active, phase: run.phase, finishReason: run.finishReason } : null });

  container.innerHTML = `
    <div class="lt-view cp-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Crear Promo-Id</h3>
        <p class="lt-hint">GP1 &gt; PROMOTION &gt; Promotion Management. Busca cada SKU en GP1, arma la promo con los que existen y la guarda en <strong>STG</strong> (los que no existen se informan). El <strong>SAVE TO PROD</strong> lo haces tu.</p>
        <div id="cp-page" class="cp-page"></div>
      </section>

      <section class="lt-form-card" id="cp-form">
        <h3 class="lt-section-title">Datos de la promo</h3>
        <div class="dt-field">
          <label class="dt-label" for="cp-title">Title* <span class="cp-count" data-count-for="cp-title"></span></label>
          <input type="text" id="cp-title" class="dt-input" maxlength="${LIMITS.TITLE}" value="${escapeHtml(c.title)}" placeholder="Ej: Despacho gratis TV RM">
        </div>
        <div class="dt-row">
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="cp-start">Desde*</label>
            <input type="date" id="cp-start" class="dt-input" value="${escapeHtml(c.startDate)}">
          </div>
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="cp-end">Hasta*</label>
            <input type="date" id="cp-end" class="dt-input" value="${escapeHtml(c.endDate)}">
          </div>
        </div>
        <div class="cp-quick">
          <span class="lt-hint">Duracion:</span>
          <button type="button" class="ct-btn ct-btn--ghost cp-mini" data-months="1">1M</button>
          <button type="button" class="ct-btn ct-btn--ghost cp-mini" data-months="3">3M</button>
          <button type="button" class="ct-btn ct-btn--ghost cp-mini" data-months="6">6M</button>
        </div>
        <div class="dt-field">
          <label class="dt-label" for="cp-tag">Tag <span class="cp-count" data-count-for="cp-tag"></span></label>
          <input type="text" id="cp-tag" class="dt-input" maxlength="${LIMITS.TAG}" value="${escapeHtml(c.tag)}" placeholder="Ej: Despacho gratis RM y V region">
        </div>
        <details class="ct-diag">
          <summary>Mas opciones</summary>
          <div class="sb-config-body">
            <div class="dt-field">
              <label class="dt-label" for="cp-body">Body Copy <span class="cp-count" data-count-for="cp-body"></span></label>
              <input type="text" id="cp-body" class="dt-input" maxlength="${LIMITS.BODY_COPY}" value="${escapeHtml(c.bodyCopy)}">
            </div>
            <div class="dt-field">
              <label class="dt-label" for="cp-main">Main Model (1 o 3 SKUs, opcional)</label>
              <input type="text" id="cp-main" class="dt-input" value="${escapeHtml(view.draft.mainText)}" placeholder="vacio = los 3 primeros de la lista">
            </div>
            <div class="dt-field">
              <label class="dt-label" for="cp-catmode">Categorias de cada modelo</label>
              <select id="cp-catmode" class="dt-input">
                <option value="${CATEGORY_MODE.ALL}">Todas sus categorias (como se hace a mano)</option>
                <option value="${CATEGORY_MODE.FIRST}">Solo la primera</option>
              </select>
            </div>
            <label class="dt-check"><input type="checkbox" id="cp-display" ${c.displayDate ? 'checked' : ''}><span>Display Date (mostrar fechas)</span></label>
            <label class="dt-check"><input type="checkbox" id="cp-review" ${c.reviewUse ? 'checked' : ''}><span>Review Use</span></label>
            <label class="dt-check"><input type="checkbox" id="cp-hidden" ${c.hiddenUse ? 'checked' : ''}><span>Hidden Use (promo oculta)</span></label>
            <p class="lt-hint">Site B2C, Member Type ALL y el resto quedan como los deja GP1.</p>
          </div>
        </details>
      </section>

      <section class="lt-form-card">
        <h3 class="lt-section-title">SKUs</h3>
        <div class="ct-tabs sb-source">
          <button type="button" class="ct-tab" data-source="text">Pegar lista</button>
          <button type="button" class="ct-tab" data-source="file">CSV / Excel</button>
        </div>
        <div class="dt-field" data-panel="text">
          <textarea id="cp-text" class="dt-textarea" rows="7" spellcheck="false" placeholder="Pega aqui la columna de Excel o un SKU por linea, ej:&#10;55QNED80BSG.AWH&#10;65LX7BPSA.AWHQ">${escapeHtml(view.draft.text)}</textarea>
          <p class="lt-hint">Sirve el Sales Model, el Product ID o el Model Name.</p>
        </div>
        <div class="dt-field hidden" data-panel="file">
          ${fileIntakeHtml({ id: 'cp-file', titulo: 'Pega aqui el CSV o Excel', nota: 'Copia el archivo en el Explorador y pegalo (Ctrl+V), arrastralo o eligelo. Se usa la columna SKU / Sales Model, o la primera.', accept: '.csv,.txt,.xlsx,.xls' })}
          <p class="lt-hint" id="cp-file-name"></p>
        </div>
        <p class="lt-hint" id="cp-sku-count"></p>
      </section>

      <section class="lt-form-card">
        <label class="dt-check"><input type="checkbox" id="cp-dry" ${c.dryRun ? 'checked' : ''}><span>Simulacion: llenar todo en GP1 sin guardar (para revisar)</span></label>
        <ul id="cp-errors" class="cp-errors"></ul>
        <div class="lt-actions">
          <button type="button" id="cp-start" class="ct-btn ct-btn--primary">Crear Promo-Id</button>
          <button type="button" id="cp-stop" class="ct-btn ct-btn--ghost hidden">Detener</button>
          <button type="button" id="cp-clear" class="ct-btn ct-btn--ghost hidden">Nueva promo</button>
        </div>
      </section>

      <section id="cp-progress" class="lt-form-card hidden"></section>

      <details class="ct-diag cp-trace" id="cp-trace">
        <summary>Registro tecnico <span id="cp-trace-count"></span></summary>
        <p class="lt-hint">Todo lo que hacen el popup y la pestana. Si algo falla, copialo y pasalo tal cual.</p>
        <div class="lt-actions">
          <button type="button" id="cp-trace-copy" class="ct-btn ct-btn--ghost cp-mini">Copiar</button>
          <button type="button" id="cp-trace-download" class="ct-btn ct-btn--ghost cp-mini">Descargar .txt</button>
          <button type="button" id="cp-trace-clear" class="ct-btn ct-btn--ghost cp-mini">Limpiar</button>
          <label class="dt-check cp-trace-debug"><input type="checkbox" id="cp-trace-all"><span>Ver detalle</span></label>
        </div>
        <ul id="cp-trace-list" class="lt-log cp-trace-list"></ul>
      </details>
    </div>`;

  wireForm(container);
  wireTrace(container);
  container.querySelector('#cp-catmode').value = view.draft.categoryMode;
  setSource(container, view.draft.source);
  updateCounts(container);
  renderErrors(container, []);
  checkPage(container);

  renderRun(container, run);
  cleanups.push(subscribeToRun((next) => renderRun(container, next)));
  // Re-pinta cada tanto: tiempo transcurrido y corridas sin latido (pestana cerrada).
  const timer = setInterval(async () => {
    if (!container.isConnected) { clearInterval(timer); return; }
    const r = await getRun();
    if (r?.active) renderRun(container, r);
  }, 3000);
  cleanups.push(() => clearInterval(timer));
}

// ---------------------------------------------------------------------------
// Pantalla en la pestana activa
// ---------------------------------------------------------------------------

async function send(tabId, type, payload) {
  const t0 = Date.now();
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type, payload });
    trace.debug(`${type} -> ${res ? (res.ok ? 'ok' : `no: ${res.reason}`) : 'sin respuesta'} (${Date.now() - t0} ms)`);
    return res ?? null;
  } catch (err) {
    // "Receiving end does not exist" / "message port closed": ningun frame de
    // la pestana tiene la pantalla (o el content es viejo y hay que recargar).
    trace.warn(`${type} sin respuesta de la pestana: ${toMessage(err)}`);
    return null;
  }
}

/** @returns {Promise<{ ok: boolean, tab?: chrome.tabs.Tab, reason?: string, reload?: boolean }>} */
async function detectPage() {
  let tab;
  try { tab = await getActiveTab(); } catch (err) {
    trace.warn(`no hay pestana activa: ${toMessage(err)}`);
    return { ok: false, reason: 'No hay una pestana activa.' };
  }
  const res = await send(tab.id, MESSAGES.PING);
  const url = tab.url || '';
  if (res?.ok) {
    trace.info('pantalla detectada', { tab: tab.id, url, frame: res.url, state: res.state });
    return { ok: true, tab };
  }
  const onGp1 = url.startsWith(GP1_ORIGIN);
  const onLogin = onGp1 && /login|emailAuth/i.test(url);
  let reason;
  let reload = false;
  if (res?.reason) { reason = res.reason; reload = true; }
  else if (onLogin) reason = 'Inicia sesion en GP1 (usuario, clave y el codigo que llega por correo) y vuelve a intentar.';
  else if (onGp1 && tab.status === 'complete') {
    reason = 'Estas en GP1 pero la pestana no responde. Si es Promotion Management, recargala (F5): pasa siempre despues de instalar o actualizar la extension.';
    reload = true;
  } else if (onGp1) reason = 'GP1 todavia esta cargando: espera un momento y reintenta.';
  else reason = 'Abre GP1 > PROMOTION > Promotion Management en esta pestana.';
  trace.warn('pantalla no detectada', { tab: tab.id, url, status: tab.status, reason });
  return { ok: false, tab, reason, reload, onGp1, onLogin };
}

/**
 * @param {{ waitMs?: number }} [opts] tras recargar/abrir la pestana, seguir
 *   probando hasta que GP1 termine de cargar (por la VPN tarda varios segundos).
 */
async function checkPage(container, { waitMs = 0, force = false } = {}) {
  const box = container.querySelector('#cp-page');
  if (!box) return null;
  box.innerHTML = `<p class="lt-hint"><span class="ct-spinner ct-spinner--inline"></span> ${force ? 'Esperando a que cargue GP1...' : 'Buscando la pantalla en la pestana activa...'}</p>`;
  const until = Date.now() + waitMs;
  let page = await detectPage();
  // Solo vale la pena esperar si la pestana esta en GP1 (y no en el login), y
  // sin `force` solo mientras siga cargando: una pestana ya cargada que no
  // responde no se arregla esperando (hay que recargarla).
  const keepWaiting = (p) => !p.ok && p.onGp1 && !p.onLogin && (force || p.tab?.status !== 'complete');
  while (keepWaiting(page) && Date.now() < until && box.isConnected) {
    await new Promise((r) => setTimeout(r, 1500));
    page = await detectPage();
  }
  if (!box.isConnected) return page;
  if (page.ok) {
    box.innerHTML = '<p class="cp-ok">Promotion Management lista en esta pestana.</p>';
    return page;
  }
  box.innerHTML = `
    <div class="mg-notice">
      <p>${escapeHtml(page.reason)}</p>
      <p class="lt-hint">GP1 solo abre dentro de la red de LG. Si estas afuera, conecta antes la <strong>VPN</strong> (desde esta misma extension); si GP1 responde "403 Forbidden", es eso.</p>
      <div class="lt-actions">
        ${page.reload ? '<button type="button" id="cp-reload" class="ct-btn ct-btn--primary">Recargar pestana</button>' : ''}
        <button type="button" id="cp-open" class="ct-btn ${page.reload ? 'ct-btn--ghost' : 'ct-btn--primary'}">Abrir Promotion Management</button>
        <button type="button" id="cp-recheck" class="ct-btn ct-btn--ghost">Reintentar</button>
      </div>
    </div>`;
  box.querySelector('#cp-reload')?.addEventListener('click', async () => {
    trace.info('recargando la pestana', { tab: page.tab?.id });
    await chrome.tabs.reload(page.tab.id);
    await new Promise((r) => setTimeout(r, 1000));
    checkPage(container, { waitMs: 45000, force: true });
  });
  box.querySelector('#cp-open').addEventListener('click', async () => {
    trace.info('abriendo Promotion Management', { from: page.tab?.url });
    if (page.tab?.id && !page.onLogin) await chrome.tabs.update(page.tab.id, { url: PAGE_URL });
    else await chrome.tabs.create({ url: PAGE_URL });
    await new Promise((r) => setTimeout(r, 1000));
    checkPage(container, { waitMs: 45000, force: true });
  });
  box.querySelector('#cp-recheck').addEventListener('click', () => checkPage(container));
  return page;
}

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

function wireForm(container) {
  const c = view.draft.config;
  const bind = (id, key, prop = 'value') => {
    const el = container.querySelector(`#${id}`);
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      c[key] = el[prop];
      updateCounts(container);
      saveDraft();
    });
  };
  bind('cp-title', 'title');
  bind('cp-tag', 'tag');
  bind('cp-body', 'bodyCopy');
  bind('cp-start', 'startDate');
  bind('cp-end', 'endDate');
  bind('cp-display', 'displayDate', 'checked');
  bind('cp-review', 'reviewUse', 'checked');
  bind('cp-hidden', 'hiddenUse', 'checked');
  bind('cp-dry', 'dryRun', 'checked');
  container.querySelector('#cp-dry').addEventListener('change', async () => renderRun(container, await getRun()));
  container.querySelector('#cp-main').addEventListener('input', (e) => { view.draft.mainText = e.target.value; saveDraft(); });
  container.querySelector('#cp-catmode').addEventListener('change', (e) => { view.draft.categoryMode = e.target.value; saveDraft(); });

  container.querySelectorAll('[data-months]').forEach((btn) => btn.addEventListener('click', () => {
    if (!c.startDate) c.startDate = isoDate(new Date());
    c.endDate = addMonths(c.startDate, Number(btn.dataset.months));
    container.querySelector('#cp-start').value = c.startDate;
    container.querySelector('#cp-end').value = c.endDate;
    saveDraft();
  }));

  container.querySelectorAll('[data-source]').forEach((btn) => btn.addEventListener('click', () => {
    setSource(container, btn.dataset.source);
    updateCounts(container);
    saveDraft();
  }));
  container.querySelector('#cp-text').addEventListener('input', (e) => {
    view.draft.text = e.target.value;
    updateCounts(container);
    saveDraft();
  });
  wireFileIntake(container, { id: 'cp-file', onArchivos: (files) => onFile(container, files[0]) });

  container.querySelector('#cp-start').addEventListener('click', () => onStart(container));
  container.querySelector('#cp-stop').addEventListener('click', onStop);
  container.querySelector('#cp-clear').addEventListener('click', () => onClear(container));
}

function setSource(container, source) {
  view.draft.source = source;
  container.querySelectorAll('[data-source]').forEach((b) => b.classList.toggle('is-active', b.dataset.source === source));
  container.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== source));
  const name = container.querySelector('#cp-file-name');
  name.textContent = view.draft.fileName ? `Cargado: ${view.draft.fileName} (${view.draft.fileSkus.length} SKUs)` : '';
}

async function onFile(container, file) {
  if (!file) return;
  const name = container.querySelector('#cp-file-name');
  try {
    let matrix;
    if (/\.xlsx?$/i.test(file.name)) {
      const book = read(await file.arrayBuffer(), { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      matrix = utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    } else {
      matrix = csvToMatrix(await file.text());
    }
    const { skus, column } = parseSkuMatrix(matrix);
    view.draft.fileName = file.name;
    view.draft.fileSkus = skus;
    name.textContent = `Cargado: ${file.name} — ${skus.length} SKUs${column ? ` (columna "${column}")` : ' (primera columna)'}`;
    trace.info('archivo leido', { name: file.name, size: file.size, rows: matrix.length, skus: skus.length, column });
    updateCounts(container);
    saveDraft();
  } catch (err) {
    trace.error(`no se pudo leer ${file.name}: ${toMessage(err)}`, err);
    name.textContent = `No se pudo leer ${file.name}: ${toMessage(err)}`;
  }
}

function updateCounts(container) {
  const c = view.draft.config;
  const counts = { 'cp-title': [c.title, LIMITS.TITLE], 'cp-tag': [c.tag, LIMITS.TAG], 'cp-body': [c.bodyCopy, LIMITS.BODY_COPY] };
  Object.entries(counts).forEach(([id, [value, max]]) => {
    const el = container.querySelector(`[data-count-for="${id}"]`);
    if (el) el.textContent = `${(value || '').length}/${max}`;
  });
  const parsed = view.draft.source === 'file'
    ? { skus: view.draft.fileSkus, duplicates: [] }
    : parseSkuText(view.draft.text);
  const dup = parsed.duplicates.length ? ` (${parsed.duplicates.length} repetido(s) se ignoran)` : '';
  container.querySelector('#cp-sku-count').textContent = parsed.skus.length ? `${parsed.skus.length} SKU(s) en la lista${dup}.` : '';
}

function renderErrors(container, errors) {
  const list = container.querySelector('#cp-errors');
  if (list) list.innerHTML = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('');
}

// ---------------------------------------------------------------------------
// Corrida
// ---------------------------------------------------------------------------

async function onStart(container) {
  const btn = container.querySelector('#cp-start');
  const skus = currentSkus();
  const mains = mainSkus();
  const c = view.draft.config;
  trace.info('click en crear', { skus: skus.length, mains, dryRun: c.dryRun, title: c.title, startDate: c.startDate, endDate: c.endDate });

  const errors = validateConfig(c, { skus, mainSkus: mains });
  if (errors.length) {
    trace.warn('datos incompletos', errors);
    renderErrors(container, errors);
    return;
  }
  renderErrors(container, []);
  btn.disabled = true;
  btn.textContent = 'Buscando la pantalla...';
  try {
    // Si GP1 todavia esta cargando, se le da un rato antes de rendirse.
    const page = await checkPage(container, { waitMs: 15000 });
    if (!page?.ok) {
      renderErrors(container, [page?.reason || 'No se encontro Promotion Management en la pestana activa.']);
      return;
    }
    const run = makeRun({ config: { ...c, title: c.title.trim() }, skus, mainSkus: mains, categoryMode: view.draft.categoryMode });
    await setRun(run);
    trace.info('corrida guardada, enviando START', { id: run.id, tab: page.tab.id });
    const reply = await send(page.tab.id, MESSAGES.START, { id: run.id });
    if (!reply?.ok) {
      const reason = reply?.reason || 'La pestana no respondio al iniciar: recargala (F5) y reintenta.';
      trace.error(`START fallo: ${reason}`);
      await updateRun((r) => ({ ...r, active: false, finishedAt: Date.now(), finishReason: FINISH_REASON.ERROR, error: reason }));
    }
  } catch (err) {
    trace.error(`no se pudo iniciar: ${toMessage(err)}`, err);
    renderErrors(container, [`No se pudo iniciar: ${toMessage(err)}`]);
  } finally {
    btn.disabled = false;
    renderRun(container, await getRun());
  }
}

async function onStop() {
  trace.info('click en detener');
  await updateRun((r) => (r?.active ? { ...r, cancelRequested: true } : r));
}

async function onClear(container) {
  trace.info('nueva promo: se limpia la corrida');
  await clearRun();
  render(container);
}

function isStale(run) {
  return run?.active && Date.now() - (run.heartbeatAt || run.startedAt) > STALE_MS;
}

function itemsSummary(items) {
  const count = (s) => items.filter((it) => it.status === s).length;
  return {
    added: count(SKU_STATUS.ADDED),
    found: count(SKU_STATUS.FOUND) + count(SKU_STATUS.ADDED),
    problems: items.filter((it) => PROBLEM.has(it.status)),
  };
}

function renderRun(container, run) {
  const box = container.querySelector('#cp-progress');
  const start = container.querySelector('#cp-start');
  const stop = container.querySelector('#cp-stop');
  const clear = container.querySelector('#cp-clear');
  if (!box || !start) return;

  const stale = isStale(run);
  const active = Boolean(run?.active) && !stale;
  const done = Boolean(run) && !run.active && run.finishReason === FINISH_REASON.DONE;
  start.classList.toggle('hidden', active || (done && !run.simulated));
  if (!start.disabled) start.textContent = view.draft.config.dryRun ? 'Simular en GP1' : 'Crear Promo-Id';
  stop.classList.toggle('hidden', !active);
  stop.disabled = Boolean(run?.cancelRequested) || Boolean(run?.saving);
  clear.classList.toggle('hidden', !run || active);
  container.querySelectorAll('#cp-form input, #cp-form select, #cp-text, #cp-dry').forEach((el) => { el.disabled = active; });

  if (!run) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');

  const items = run.items || [];
  const sum = itemsSummary(items);
  const phaseIdx = PHASES.indexOf(run.phase);
  const pct = run.totalRows ? Math.round((run.addedRows / run.totalRows) * 100) : 0;
  const elapsed = Math.round(((run.finishedAt || Date.now()) - run.startedAt) / 1000);
  const resolved = run.phase !== RUN_PHASE.RESOLVING || !run.active;

  let headline;
  if (done && run.simulated) headline = 'Simulacion lista (no se guardo)';
  else if (done && run.promotionId) headline = 'Promo creada en STG';
  else if (done) headline = 'Guardada en STG';
  else if (stale) headline = 'Sin noticias de la pestana';
  else if (run.active) headline = run.cancelRequested ? 'Cancelando...' : RUN_PHASE_LABEL[run.phase];
  else if (run.finishReason === FINISH_REASON.CANCELLED) headline = 'Cancelada';
  else headline = 'No se pudo crear';

  const steps = PHASES.map((p, i) => {
    let cls = 'pending';
    if (done || i < phaseIdx) cls = 'done';
    else if (i === phaseIdx) cls = run.active && !stale ? 'running' : 'error';
    let extra = '';
    if (p === RUN_PHASE.RESOLVING && resolved && items.length) extra = `${sum.found}/${items.length} encontrados`;
    if (p === RUN_PHASE.MODELS && run.totalRows) extra = `${sum.added}/${sum.found} SKUs · ${run.addedRows}/${run.totalRows} filas`;
    return `<li class="cp-step cp-step--${cls}">${escapeHtml(RUN_PHASE_LABEL[p])}${extra ? ` <span class="cp-step-extra">${escapeHtml(extra)}</span>` : ''}</li>`;
  }).join('');

  box.innerHTML = `
    <div class="lt-progress-head">
      <strong>${escapeHtml(headline)}</strong>
      <span class="dt-progress-counter">${elapsed} s</span>
    </div>
    ${done && run.promotionId ? `
      <div class="cp-result">
        <div class="cp-result-id">${escapeHtml(run.promotionId)}</div>
        <button type="button" id="cp-copy-id" class="ct-btn ct-btn--ghost cp-mini">Copiar</button>
      </div>
      <p class="lt-hint">${sum.added} de ${items.length} SKU(s) en la promo. ${run.marked ? 'Quedo marcada en el listado STG de la pestana: revisala y aprieta <strong>SAVE TO PROD</strong>.' : 'Buscala en el listado STG por su Promo-Id y aprieta <strong>SAVE TO PROD</strong>.'}</p>` : ''}
    ${done && run.simulated ? `<p class="lt-hint">GP1 acepto los datos y ${sum.added} de ${items.length} SKU(s). El formulario quedo abierto en la pestana para revisarlo; para crearla de verdad desmarca "Simulacion" y vuelve a crear.</p>` : ''}
    ${run.error ? `<p class="lt-err">${escapeHtml(run.error)}</p>` : ''}
    ${stale ? '<p class="lt-err">La pestana dejo de reportar (se cerro o se recargo). Revisa el listado STG antes de reintentar.</p>' : ''}
    ${sum.problems.length && resolved ? `
      <div class="cp-problems-box">
        <strong>${sum.problems.length} SKU(s) no se agregaron</strong>
        <ul class="cp-problems">${sum.problems.map((it) => `<li><code>${escapeHtml(it.sku)}</code> — ${escapeHtml(SKU_STATUS_LABEL[it.status])}${it.note ? ` (${escapeHtml(it.note)})` : ''}</li>`).join('')}</ul>
        <button type="button" id="cp-copy-problems" class="ct-btn ct-btn--ghost cp-mini">Copiar lista</button>
      </div>` : ''}
    <ol class="cp-steps">${steps}</ol>
    <div class="lt-progress-bar"><span style="width:${done ? 100 : pct}%"></span></div>
    ${items.length && resolved ? `
      <details class="ct-diag">
        <summary>SKUs (${items.length})</summary>
        <ul class="cp-models">
          ${items.map((it) => `
            <li class="cp-model">
              <span class="cp-chip cp-chip--${escapeHtml(it.status)}">${escapeHtml(SKU_STATUS_LABEL[it.status])}</span>
              <div class="cp-model-body">
                <div class="cp-model-sku">${escapeHtml(it.sku)}${run.mainModelIds?.includes(it.modelId) ? ' <span title="Main Model">★</span>' : ''}</div>
                ${it.rows ? `<div class="cp-model-meta">${it.salesModel !== it.sku ? `${escapeHtml(it.salesModel)} · ` : ''}${it.rows} categoria(s)${it.note ? ` · ${escapeHtml(it.note)}` : ''}</div>` : ''}
              </div>
            </li>`).join('')}
        </ul>
      </details>` : ''}
    <details class="ct-diag lt-log-details">
      <summary>Pasos (${(run.log || []).length})</summary>
      <ul class="lt-log">
        ${(run.log || []).slice(-60).reverse().map((e) => `<li class="lt-log-item lt-log-item--${e.level}"><span class="lt-log-time">${formatTime(e.ts)}</span><span class="lt-log-msg">${escapeHtml(e.message)}</span></li>`).join('')}
      </ul>
    </details>`;

  box.querySelector('#cp-copy-id')?.addEventListener('click', (e) => copy(run.promotionId, e.target));
  box.querySelector('#cp-copy-problems')?.addEventListener('click', (e) => copy(sum.problems.map((it) => it.sku).join('\n'), e.target));
}

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) button.textContent = 'Copiado';
  } catch (err) {
    trace.warn(`no se pudo copiar: ${toMessage(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Registro tecnico
// ---------------------------------------------------------------------------

function wireTrace(container) {
  const paint = debounce(() => renderTrace(container), 150);
  cleanups.push(subscribeTrace(paint));
  container.querySelector('#cp-trace-all').addEventListener('change', paint);
  container.querySelector('#cp-trace-copy').addEventListener('click', async (e) => copy(await traceText(), e.target));
  container.querySelector('#cp-trace-download').addEventListener('click', async () => {
    const blob = new Blob([await traceText()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `crear-promo-id_registro_${isoDate(new Date())}_${Date.now().toString(36)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  container.querySelector('#cp-trace-clear').addEventListener('click', async () => { await clearTrace(); renderTrace(container); });
  renderTrace(container);
}

async function traceText() {
  await trace.flush();
  const [entries, run] = await Promise.all([readTrace(), getRun()]);
  let tab = null;
  try { tab = await getActiveTab(); } catch { /* sin pestana */ }
  return traceToText(entries, {
    feature: 'Crear Promo-Id',
    version: chrome.runtime.getManifest().version,
    navegador: navigator.userAgent,
    fecha: new Date().toString(),
    pestana: tab?.url || '(ninguna)',
    corrida: run ? {
      id: run.id, active: run.active, phase: run.phase, finishReason: run.finishReason, error: run.error,
      skus: run.skus?.length, items: run.items?.map((it) => `${it.sku}:${it.status}`), promotionId: run.promotionId,
    } : null,
  });
}

async function renderTrace(container) {
  const list = container.querySelector('#cp-trace-list');
  if (!list) return;
  const all = container.querySelector('#cp-trace-all')?.checked;
  const entries = await readTrace();
  const shown = (all ? entries : entries.filter((e) => e.level !== 'debug')).slice(-150).reverse();
  const errors = entries.filter((e) => e.level === 'error').length;
  container.querySelector('#cp-trace-count').textContent = `(${entries.length}${errors ? `, ${errors} error(es)` : ''})`;
  list.innerHTML = shown.map((e) => `
    <li class="lt-log-item lt-log-item--${e.level === 'debug' ? 'info' : e.level}">
      <span class="lt-log-time">${formatTraceTime(e.ts)}</span>
      <span class="lt-log-msg"><span class="cp-trace-ctx">${escapeHtml(e.ctx)}</span> ${escapeHtml(e.msg)}${e.data !== undefined ? `<code class="cp-trace-data">${escapeHtml(typeof e.data === 'string' ? e.data : JSON.stringify(e.data))}</code>` : ''}</span>
    </li>`).join('') || '<li class="lt-hint">Sin entradas.</li>';
}
