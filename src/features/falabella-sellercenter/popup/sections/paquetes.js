// UI de "Identificar paquetes en ordenes".
//
// El usuario elige un rango de dias y los estados de orden, y arranca; el
// analisis corre en el SERVICE WORKER (sobrevive a cerrar el panel). Se muestra
// el avance en % y ordenes leidas con un tiempo restante aproximado, y al final
// el total de ordenes con problema y su monto, una tarjeta desplegable por orden
// (productos, precios, envio, estados) y las salidas: texto, Excel y CSV.

import { utils, write } from 'xlsx';
import { API, ESTADOS, etiquetaEstado, FINISH_REASON, MESSAGES, PHASE, PHASE_LABEL } from '../../constants.js';
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
import {
  buildCsv,
  buildTexto,
  exportFilename,
  filaTotalOrdenes,
  filasOrdenes,
  filasProductos,
  HEADERS_ORDENES,
  HEADERS_PRODUCTOS,
} from '../../paquetes/export.js';
import { totales } from '../../paquetes/analisis.js';
import { sendMessage } from '../../../../shared/messaging/messaging.js';
import { escapeHtml, formatClp, formatTime } from '../../../../shared/ui/format.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('falabella-sellercenter');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoy = () => ymd(new Date());
const haceDias = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const clp = (n) => `$${formatClp(n || 0)}`;
const TODOS = ESTADOS.map((e) => e.id);

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
  const estados = Array.isArray(draft?.estados) && draft.estados.length ? draft.estados : TODOS;
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

        <div class="fsc-estados">
          <div class="fsc-estados-head">
            <span class="epr-label">Estado de la orden</span>
            <button type="button" id="fsc-estados-todos" class="fsc-link">Todos</button>
          </div>
          <div class="fsc-chips" role="group" aria-label="Estado de la orden">
            ${ESTADOS.map((e) => `
              <label class="fsc-chip">
                <input type="checkbox" value="${e.id}" ${estados.includes(e.id) ? 'checked' : ''}>
                <span>${escapeHtml(e.label)}</span>
              </label>`).join('')}
          </div>
        </div>

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

  const guardar = () => setDraft({
    desde: $('#fsc-desde').value,
    hasta: $('#fsc-hasta').value,
    estados: estadosElegidos(container),
  }).catch(() => {});
  $('#fsc-desde').addEventListener('change', guardar);
  $('#fsc-hasta').addEventListener('change', guardar);
  container.querySelectorAll('.fsc-chip input').forEach((el) => el.addEventListener('change', guardar));
  $('#fsc-estados-todos').addEventListener('click', () => {
    const chips = [...container.querySelectorAll('.fsc-chip input')];
    const marcar = chips.some((el) => !el.checked);
    chips.forEach((el) => { el.checked = marcar; });
    guardar();
  });

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

const estadosElegidos = (container) =>
  [...container.querySelectorAll('.fsc-chip input:checked')].map((el) => el.value);

async function onStart(container) {
  const desde = container.querySelector('#fsc-desde').value;
  const hasta = container.querySelector('#fsc-hasta').value;
  const estados = estadosElegidos(container);
  if (!desde || !hasta) { alert('Selecciona Desde y Hasta.'); return; }
  if (desde > hasta) { alert('"Desde" no puede ser posterior a "Hasta".'); return; }
  if (!estados.length) { alert('Elige al menos un estado.'); return; }
  try {
    const res = await sendMessage({ type: MESSAGES.PAQUETES_START, payload: { desde, hasta, estados } });
    if (!res?.ok) { alert(res?.reason || 'No se pudo iniciar el analisis.'); return; }
    log.info('analisis de paquetes iniciado', { desde, hasta, estados });
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
  $('#fsc-estados-todos').disabled = active;
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

const chipEstado = (id) => `<span class="fsc-estado fsc-estado--${escapeHtml(id)}">${escapeHtml(etiquetaEstado(id))}</span>`;

async function renderResultado(container, run) {
  const box = container.querySelector('#fsc-result');
  if (run.active) { box.classList.add('hidden'); box.innerHTML = ''; resultadoMostrado = null; return; }
  if (run.finishReason === FINISH_REASON.ERROR) {
    box.classList.remove('hidden');
    box.innerHTML = `<p class="oi-alert oi-alert--error">${escapeHtml(run.errorReason || 'Error desconocido.')}</p>`;
    return;
  }
  if (run.finishReason !== FINISH_REASON.DONE) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  if (resultadoMostrado === run.startedAt) return; // evita repintar (cierra los desplegables y pierde la seleccion)
  resultadoMostrado = run.startedAt;

  const result = await getResult();
  const hallazgos = result?.hallazgos || [];
  const s = run.stats || {};
  const t = totales(hallazgos);
  box.classList.remove('hidden');

  const filtro = result?.estados?.length
    ? `<p class="lt-hint">Estados: ${result.estados.map(chipEstado).join(' ')}</p>`
    : '';
  const resumen = `
    ${filtro}
    <ul class="epr-stat-grid">
      <li><span>Ordenes creadas en el rango</span><strong>${formatClp(s.enRango ?? 0)}</strong></li>
      <li><span>Con 2 o mas productos</span><strong>${s.multiProducto ?? 0}</strong></li>
      <li><span>Revisadas</span><strong>${s.analizadas ?? 0}</strong></li>
    </ul>`;

  if (!hallazgos.length) {
    box.innerHTML = `${resumen}<p class="oi-alert oi-alert--success">Todas las ordenes con 2 o mas productos tienen un paquete por producto.</p>`;
    return;
  }

  const texto = buildTexto(hallazgos, result);
  box.innerHTML = `
    ${resumen}
    <div class="fsc-totales">
      <div class="fsc-total"><span>Ordenes con problema</span><strong>${t.ordenes}</strong></div>
      <div class="fsc-total"><span>Monto total</span><strong>${clp(t.monto)}</strong></div>
    </div>
    <div class="lt-actions">
      <button type="button" id="fsc-copy" class="ct-btn ct-btn--primary">Copiar texto</button>
      <button type="button" id="fsc-xlsx" class="ct-btn ct-btn--ghost">Excel</button>
      <button type="button" id="fsc-csv" class="ct-btn ct-btn--ghost">CSV</button>
    </div>
    <div class="fsc-list-head">
      <span class="epr-label">Ordenes (${t.ordenes})</span>
      <button type="button" id="fsc-expand" class="fsc-link">Abrir todas</button>
    </div>
    <div class="fsc-list">${hallazgos.map(tarjetaOrden).join('')}</div>
    <details class="ct-diag">
      <summary>Texto para copiar</summary>
      <textarea id="fsc-text" class="dt-input fsc-text" readonly rows="8">${escapeHtml(texto)}</textarea>
    </details>`;

  const copy = box.querySelector('#fsc-copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const area = box.querySelector('#fsc-text');
      area.closest('details').open = true;
      area.select();
      document.execCommand('copy');
    }
    copy.textContent = 'Copiado';
    setTimeout(() => { copy.textContent = 'Copiar texto'; }, 1500);
  });
  const expand = box.querySelector('#fsc-expand');
  expand.addEventListener('click', () => {
    const cards = [...box.querySelectorAll('.fsc-orden')];
    const abrir = cards.some((d) => !d.open);
    cards.forEach((d) => { d.open = abrir; });
    expand.textContent = abrir ? 'Cerrar todas' : 'Abrir todas';
  });
  box.querySelector('#fsc-csv').addEventListener('click', () => {
    descargar(new Blob([buildCsv(hallazgos)], { type: 'text/csv;charset=utf-8' }), exportFilename(result.desde, result.hasta, 'csv'));
  });
  box.querySelector('#fsc-xlsx').addEventListener('click', () => exportXlsx(hallazgos, result));
}

function tarjetaOrden(h) {
  const m = h.montos || {};
  const filas = (h.items || []).map((it) => `
    <tr class="${it.compartido ? 'is-compartido' : ''} ${it.activo ? '' : 'is-inactivo'}">
      <td>
        <div class="fsc-sku">${escapeHtml(it.sku)}</div>
        <div class="fsc-nombre">${escapeHtml(it.nombre)}</div>
        <div class="fsc-pkg">${escapeHtml(it.paquete || 'sin paquete')}${it.compartido ? ' · <strong>compartido</strong>' : ''}</div>
      </td>
      <td class="fsc-num">
        ${clp(it.precio)}
        ${it.precioLista > it.precio ? `<div class="fsc-tachado">${clp(it.precioLista)}</div>` : ''}
      </td>
      <td>${chipEstado(it.estado)}</td>
    </tr>`).join('');

  return `
    <details class="fsc-orden">
      <summary>
        <span class="fsc-orden-num">${escapeHtml(h.orderNumber)}</span>
        <span class="fsc-orden-total">${clp(m.total)}</span>
        <span class="fsc-orden-meta">
          ${escapeHtml(h.createdAt.slice(0, 16))} · ${h.productos} productos en ${h.paquetes} paquete${h.paquetes === 1 ? '' : 's'}
        </span>
        <span class="fsc-orden-estados">${h.estados.map(chipEstado).join(' ')}</span>
      </summary>
      <div class="fsc-orden-body">
        <table class="fsc-items">
          <thead><tr><th>Producto</th><th class="fsc-num">Precio</th><th>Estado</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
        <dl class="fsc-montos">
          <dt>Productos</dt><dd>${clp(m.productos)}</dd>
          ${m.descuento ? `<dt>Descuento (incluido)</dt><dd>-${clp(m.descuento)}</dd>` : ''}
          <dt>Envio</dt><dd>${m.envio ? clp(m.envio) : 'Sin costo'}</dd>
          <dt class="fsc-montos-total">Total orden</dt><dd class="fsc-montos-total">${clp(m.total)}</dd>
        </dl>
        ${h.guias.length ? `<p class="fsc-guia">Guia compartida: ${escapeHtml(h.guias.join(', '))}</p>` : ''}
        ${h.promesa ? `<p class="fsc-guia">Promesa de despacho: ${escapeHtml(h.promesa.slice(0, 16))}</p>` : ''}
      </div>
    </details>`;
}

function exportXlsx(hallazgos, result) {
  const book = utils.book_new();

  const ordenes = filasOrdenes(hallazgos);
  const hojaOrdenes = utils.aoa_to_sheet([HEADERS_ORDENES, ...ordenes, filaTotalOrdenes(hallazgos)]);
  hojaOrdenes['!cols'] = [12, 19, 18, 9, 9, 9, 34, 18, 20, 14, 10, 11, 14, 19, 12].map((wch) => ({ wch }));
  hojaOrdenes['!autofilter'] = { ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: ordenes.length, c: HEADERS_ORDENES.length - 1 } }) };
  formatoMoneda(hojaOrdenes, ordenes.length + 1, [9, 10, 11, 12]);
  utils.book_append_sheet(book, hojaOrdenes, 'Ordenes');

  const productos = filasProductos(hallazgos);
  const hojaProductos = utils.aoa_to_sheet([HEADERS_PRODUCTOS, ...productos]);
  hojaProductos['!cols'] = [12, 19, 18, 7, 30, 46, 18, 12, 12, 18, 10, 20, 14, 10, 14].map((wch) => ({ wch }));
  hojaProductos['!autofilter'] = { ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: productos.length, c: HEADERS_PRODUCTOS.length - 1 } }) };
  formatoMoneda(hojaProductos, productos.length, [7, 8, 12, 13, 14]);
  utils.book_append_sheet(book, hojaProductos, 'Productos');

  const bytes = write(book, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  descargar(blob, exportFilename(result.desde, result.hasta, 'xlsx'));
}

/** Formato $ con separador de miles en las columnas de montos (filas 1..n). */
function formatoMoneda(sheet, n, cols) {
  for (let r = 1; r <= n; r++) {
    for (const c of cols) {
      const cell = sheet[utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === 'number') cell.z = '"$"#,##0';
    }
  }
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
