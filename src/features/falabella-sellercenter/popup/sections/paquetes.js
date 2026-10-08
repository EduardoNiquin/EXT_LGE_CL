// UI de "Identificar paquetes en ordenes".
//
// El usuario elige un rango de dias y arranca; el analisis corre en el SERVICE
// WORKER (sobrevive a cerrar el panel). Se muestra el avance en % y ordenes
// leidas con un tiempo restante aproximado, y al final la lista de ordenes con
// problema como texto (para copiar) y como Excel/CSV.

import { utils, write } from 'xlsx';
import { API, FINISH_REASON, MESSAGES, PHASE, PHASE_LABEL } from '../../constants.js';
import {
  clearResult,
  clearRun,
  getDraft,
  getResult,
  getRun,
  setDraft,
  subscribeToRun,
  updateRun,
} from '../../state.js';
import { buildCsv, buildTexto, exportFilename, filas, HEADERS } from '../../paquetes/export.js';
import { sendMessage } from '../../../../shared/messaging/messaging.js';
import { escapeHtml, formatTime } from '../../../../shared/ui/format.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('falabella-sellercenter');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoy = () => ymd(new Date());
const haceDias = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

let unsubscribe = null;
let reloj = null;
let resultadoMostrado = null; // startedAt del run cuyo resultado ya esta pintado

export async function render(container, { irA } = {}) {
  const [draft, cred] = await Promise.all([
    getDraft(),
    sendMessage({ type: MESSAGES.ESTADO_CREDENCIALES }).catch(() => null),
  ]);
  const desde = draft?.desde || haceDias(7);
  const hasta = draft?.hasta || hoy();
  const minimo = haceDias(API.DIAS_HISTORIA);
  resultadoMostrado = null;

  container.innerHTML = `
    <div class="lt-view epr-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Identificar paquetes en ordenes</h3>
        <p class="lt-hint">
          Busca ordenes donde la persona compro <strong>2 o mas productos</strong> y Falabella los dejo
          en <strong>un solo paquete</strong> (mismo PackageId y misma guia), cuando cada producto deberia
          ir en su propio envio. Consulta la API de SellerCenter; corre en segundo plano.
        </p>
        ${cred?.fuente ? '' : `
          <div class="oi-alert oi-alert--warning fsc-sin-cred">
            Faltan las credenciales de la API.
            <button type="button" id="fsc-ir-cred" class="ct-btn ct-btn--ghost">Cargar credenciales</button>
          </div>`}
        <div class="epr-dates">
          <label class="epr-field">
            <span class="epr-label">Desde</span>
            <input type="date" id="fsc-desde" class="dt-input" value="${escapeHtml(desde)}" min="${minimo}" max="${hoy()}">
          </label>
          <label class="epr-field">
            <span class="epr-label">Hasta</span>
            <input type="date" id="fsc-hasta" class="dt-input" value="${escapeHtml(hasta)}" min="${minimo}" max="${hoy()}">
          </label>
        </div>
        <p class="lt-hint epr-date-note">Fecha de creacion de la orden (hora de Chile, ambos dias incluidos). La API solo guarda unos ${API.DIAS_HISTORIA} dias hacia atras.</p>
        <div class="lt-actions">
          <button type="button" id="fsc-start" class="ct-btn ct-btn--primary">Analizar</button>
          <button type="button" id="fsc-cancel" class="ct-btn ct-btn--ghost" disabled>Cancelar</button>
          <button type="button" id="fsc-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      <section id="fsc-progress" class="lt-progress hidden">
        <div class="lt-progress-head">
          <strong id="fsc-title">Analizando…</strong>
          <span id="fsc-pct" class="dt-progress-counter"></span>
        </div>
        <div id="fsc-bar" class="lt-progress-bar"><span></span></div>
        <p id="fsc-detail" class="lt-hint fsc-detail"></p>
        <div id="fsc-result" class="epr-result hidden"></div>
        <details class="ct-diag lt-log-details">
          <summary>Registro</summary>
          <ul id="fsc-log" class="lt-log"></ul>
        </details>
      </section>
    </div>`;

  const $ = (sel) => container.querySelector(sel);
  $('#fsc-ir-cred')?.addEventListener('click', () => irA?.('credenciales'));

  const onDate = () => setDraft({ desde: $('#fsc-desde').value, hasta: $('#fsc-hasta').value }).catch(() => {});
  $('#fsc-desde').addEventListener('change', onDate);
  $('#fsc-hasta').addEventListener('change', onDate);
  $('#fsc-start').addEventListener('click', () => onStart(container));
  $('#fsc-cancel').addEventListener('click', onCancel);
  $('#fsc-clear').addEventListener('click', async () => {
    await clearRun();
    await clearResult();
    renderRun(container, null);
  });

  renderRun(container, await getRun());
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeToRun((run) => renderRun(container, run));

  // El tiempo restante se recalcula cada segundo aunque no llegue progreso.
  clearInterval(reloj);
  reloj = setInterval(async () => {
    if (!container.isConnected) { clearInterval(reloj); unsubscribe?.(); unsubscribe = null; return; }
    const run = await getRun();
    if (run?.active) renderAvance(container, run);
  }, 1000);
}

async function onStart(container) {
  const desde = container.querySelector('#fsc-desde').value;
  const hasta = container.querySelector('#fsc-hasta').value;
  if (!desde || !hasta) { alert('Selecciona Desde y Hasta.'); return; }
  if (desde > hasta) { alert('"Desde" no puede ser posterior a "Hasta".'); return; }
  try {
    const res = await sendMessage({ type: MESSAGES.PAQUETES_START, payload: { desde, hasta } });
    if (!res?.ok) { alert(res?.reason || 'No se pudo iniciar el analisis.'); return; }
    log.info('analisis de paquetes iniciado', { desde, hasta });
  } catch (err) {
    alert(`No se pudo iniciar: ${toMessage(err)}`);
  }
}

async function onCancel() {
  try { await sendMessage({ type: MESSAGES.PAQUETES_CANCEL }); } catch { /* sigue */ }
  // Respaldo por si el SW ya no estuviera corriendo.
  await updateRun((run) => (run?.active
    ? { ...run, active: false, finishedAt: Date.now(), finishReason: FINISH_REASON.CANCELLED }
    : run)).catch(() => {});
}

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

function renderRun(container, run) {
  const $ = (sel) => container.querySelector(sel);
  const progress = $('#fsc-progress');
  if (!progress) return;
  const active = Boolean(run?.active);

  container.querySelectorAll('.lt-form-card input').forEach((el) => { el.disabled = active; });
  $('#fsc-start').disabled = active;
  $('#fsc-cancel').disabled = !active;
  $('#fsc-clear').classList.toggle('hidden', !run || active);

  if (!run) { progress.classList.add('hidden'); resultadoMostrado = null; return; }
  progress.classList.remove('hidden');

  const title = $('#fsc-title');
  if (active) title.innerHTML = '<span class="ct-spinner ct-spinner--inline"></span> Analizando…';
  else if (run.finishReason === FINISH_REASON.CANCELLED) title.textContent = 'Cancelado';
  else if (run.finishReason === FINISH_REASON.ERROR) title.textContent = 'Finalizado con error';
  else title.textContent = 'Listo';

  renderAvance(container, run);
  renderLog(container, run.log);
  renderResultado(container, run).catch((err) => log.warn('render resultado', { error: toMessage(err) }));
}

/** % de avance: cada pagina de GetOrders y cada lote de items es una unidad. */
export function calcularAvance(run, ahora = Date.now()) {
  const p = run?.progress || {};
  const lotes = run?.phase === PHASE.ORDERS ? Math.max(1, p.lotesTotal || 0) : (p.lotesTotal || 0);
  const total = (p.paginasTotal || 0) + lotes;
  const hechas = (p.paginasHechas || 0) + (p.lotesHechos || 0);
  const pct = total ? Math.min(100, Math.round((hechas / total) * 100)) : 0;
  const transcurrido = ahora - (run?.startedAt || ahora);
  const restanteMs = hechas >= 2 && hechas < total ? (transcurrido / hechas) * (total - hechas) : null;
  return { pct, transcurrido, restanteMs };
}

function duracion(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${pad(s % 60)} s`;
}

function renderAvance(container, run) {
  const p = run.progress || {};
  const done = run.finishReason === FINISH_REASON.DONE;
  const { pct, transcurrido, restanteMs } = calcularAvance(run);
  const pctShown = done ? 100 : pct;
  const bar = container.querySelector('#fsc-bar span');
  if (bar) bar.style.width = `${pctShown}%`;
  container.querySelector('#fsc-pct').textContent = run.active || done ? `${pctShown}%` : '';

  const partes = [];
  if (p.ordenesApi) partes.push(`Ordenes leidas: <strong>${Math.min(p.ordenesLeidas || 0, p.ordenesApi)}</strong> de ${p.ordenesApi}`);
  if (run.phase === PHASE.ITEMS || (done && p.lotesTotal)) partes.push(`lotes de productos: ${p.lotesHechos || 0}/${p.lotesTotal || 0}`);
  if (run.active) {
    partes.push(`${PHASE_LABEL[run.phase] || ''}`);
    partes.push(restanteMs != null ? `quedan ~${duracion(restanteMs)}` : 'calculando tiempo…');
  } else if (run.finishedAt) {
    partes.push(`duro ${duracion(run.finishedAt - run.startedAt)}`);
  } else {
    partes.push(`${duracion(transcurrido)}`);
  }
  container.querySelector('#fsc-detail').innerHTML = partes.join(' · ');
}

async function renderResultado(container, run) {
  const box = container.querySelector('#fsc-result');
  if (run.active) { box.classList.add('hidden'); box.innerHTML = ''; resultadoMostrado = null; return; }
  if (run.finishReason === FINISH_REASON.ERROR) {
    box.classList.remove('hidden');
    box.innerHTML = `<p class="oi-alert oi-alert--error">${escapeHtml(run.errorReason || 'Error desconocido.')}</p>`;
    return;
  }
  if (run.finishReason !== FINISH_REASON.DONE) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  if (resultadoMostrado === run.startedAt) return; // evita repintar (y perder la seleccion del texto)
  resultadoMostrado = run.startedAt;

  const result = await getResult();
  const hallazgos = result?.hallazgos || [];
  const s = run.stats || {};
  box.classList.remove('hidden');

  const resumen = `
    <ul class="epr-stat-grid">
      <li><span>Ordenes creadas en el rango</span><strong>${s.enRango ?? 0}</strong></li>
      <li><span>Con 2 o mas productos</span><strong>${s.multiProducto ?? 0}</strong></li>
      <li><span>Revisadas</span><strong>${s.analizadas ?? 0}</strong></li>
      <li class="epr-stat-final"><span>Productos juntos en un paquete</span><strong>${hallazgos.length}</strong></li>
    </ul>`;

  if (!hallazgos.length) {
    box.innerHTML = `${resumen}<p class="oi-alert oi-alert--success">Todas las ordenes con 2 o mas productos tienen un paquete por producto.</p>`;
    return;
  }

  const texto = buildTexto(hallazgos, result);
  box.innerHTML = `
    ${resumen}
    <p class="oi-alert oi-alert--warning">${hallazgos.length} orden(es) a corregir: tienen productos que comparten paquete.</p>
    <div class="lt-actions">
      <button type="button" id="fsc-copy" class="ct-btn ct-btn--primary">Copiar texto</button>
      <button type="button" id="fsc-xlsx" class="ct-btn ct-btn--ghost">Excel</button>
      <button type="button" id="fsc-csv" class="ct-btn ct-btn--ghost">CSV</button>
    </div>
    <textarea id="fsc-text" class="dt-input fsc-text" readonly rows="8">${escapeHtml(texto)}</textarea>
    <ul class="fsc-list">
      ${hallazgos.map((h) => `
        <li class="fsc-item">
          <div class="fsc-item-head">
            <strong>${escapeHtml(h.orderNumber)}</strong>
            <span class="fsc-badge">${h.productos} productos · ${h.paquetes} paquete(s)</span>
          </div>
          <div class="fsc-item-sub">${escapeHtml(h.createdAt.slice(0, 16))} · ${escapeHtml(h.estados.join(', '))}</div>
          <div class="fsc-item-sub">${escapeHtml(h.skus)} · ${escapeHtml(h.packageIds.join(', '))}</div>
        </li>`).join('')}
    </ul>`;

  const copy = box.querySelector('#fsc-copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(texto);
      copy.textContent = 'Copiado';
    } catch {
      box.querySelector('#fsc-text').select();
      document.execCommand('copy');
      copy.textContent = 'Copiado';
    }
    setTimeout(() => { copy.textContent = 'Copiar texto'; }, 1500);
  });
  box.querySelector('#fsc-csv').addEventListener('click', () => {
    descargar(new Blob([buildCsv(hallazgos)], { type: 'text/csv;charset=utf-8' }), exportFilename(result.desde, result.hasta, 'csv'));
  });
  box.querySelector('#fsc-xlsx').addEventListener('click', () => exportXlsx(hallazgos, result));
}

function exportXlsx(hallazgos, result) {
  const rows = filas(hallazgos);
  const sheet = utils.aoa_to_sheet([HEADERS, ...rows]);
  sheet['!cols'] = [12, 19, 16, 16, 9, 9, 9, 34, 50, 18, 20, 19, 12].map((wch) => ({ wch }));
  sheet['!autofilter'] = { ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: HEADERS.length - 1 } }) };
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, 'Paquetes');
  const bytes = write(book, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  descargar(blob, exportFilename(result.desde, result.hasta, 'xlsx'));
}

function descargar(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderLog(container, entries) {
  const el = container.querySelector('#fsc-log');
  if (!el) return;
  const lista = Array.isArray(entries) ? entries.slice(-50).reverse() : [];
  el.innerHTML = lista.map((e) => `
    <li class="lt-log-item lt-log-item--${escapeHtml(e.level)}">
      <span class="lt-log-time">${formatTime(e.ts)}</span>
      <span class="lt-log-msg">${escapeHtml(e.message)}</span>
    </li>`).join('');
}
