// UI de la gestion automatica (panel/popup).
//
// Muestra la cola que dejo la web del modulo (las ordenes marcadas para
// gestionar) y lanza el run. El trabajo corre en el service worker sobre una
// pestana de SellerCenter, asi que el panel se puede cerrar sin cortar nada.
//
// Requisito: el usuario YA tiene que estar logueado en SellerCenter y en
// ayudaseller. La extension no inicia sesion por nadie.

import { DEFAULT_API_BASE, WEB_URL } from '../constants.js';
import { GESTION_MESSAGES, RESULTADO } from '../gestion/constants.js';
import { clearRun, getRun, makeRun, setRun, subscribeToRun } from '../gestion/state.js';
import { getGestiones } from '../api.js';
import { getPairing } from '../state.js';
import { copyToClipboard, escapeHtml, formatTime, marcarCopiado } from '../../popup/utils.js';
import { sendMessage } from '../../../../shared/messaging/messaging.js';
import { CONTEXTOS, fijarContextoDeTraza, trazaInfo } from '../../trace.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('devoluciones-gestion');

const ui = {
  base: DEFAULT_API_BASE,
  cola: [],
  cargando: false,
  error: '',
  prueba: false,
};

let unsub = null;

export async function render(container) {
  fijarContextoDeTraza(CONTEXTOS.POPUP);

  if (unsub) { try { unsub(); } catch { /* no-op */ } unsub = null; }

  container.innerHTML = `
    <div class="lt-view devo-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Gestion automatica — Falabella</h3>
        <p class="lt-hint">
          Gestiona en SellerCenter las devoluciones que marcaste en
          <a href="#" id="devo-g-web">la web del modulo</a>. Si la orden esta en el
          modulo de devoluciones se <strong>apela</strong>; si no esta, se
          <strong>levanta un ticket</strong> en ayudaseller.
          <br><strong>Inicia sesion antes</strong> en SellerCenter y en ayudaseller:
          la extension no se loguea por ti.
        </p>

        <div id="devo-g-cola" class="devo-status"></div>

        <label class="devo-prueba">
          <input type="checkbox" id="devo-g-prueba">
          Modo prueba — rellena los formularios pero <strong>no los envia</strong>
        </label>

        <div class="lt-actions">
          <button type="button" id="devo-g-start" class="ct-btn ct-btn--primary" disabled>Gestionar</button>
          <button type="button" id="devo-g-reload" class="ct-btn ct-btn--ghost">Actualizar cola</button>
          <button type="button" id="devo-g-clear" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      <section id="devo-g-progress" class="lt-progress hidden">
        <div class="lt-progress-head">
          <strong id="devo-g-title">Gestionando…</strong>
          <span id="devo-g-counter" class="dt-progress-counter"></span>
        </div>
        <ul id="devo-g-list" class="lt-region-list"></ul>
        <div class="lt-actions">
          <button type="button" id="devo-g-stop" class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="devo-g-copy" class="ct-btn ct-btn--ghost hidden">Copiar orden y ticket</button>
        </div>
        <details class="ct-diag lt-log-details">
          <summary>Registro</summary>
          <ul id="devo-g-log" class="lt-log"></ul>
        </details>
      </section>
    </div>
  `;

  wireEvents(container);
  await cargarCola(container);

  renderProgress(container, await getRun());

  unsub = subscribeToRun((run) => {
    renderProgress(container, run);
    actualizarBoton(container);
  });
}

function wireEvents(container) {
  container.querySelector('#devo-g-web')?.addEventListener('click', (e) => {
    e.preventDefault();
    try { chrome.tabs.create({ url: WEB_URL }); } catch { window.open(WEB_URL, '_blank'); }
  });
  container.querySelector('#devo-g-reload')?.addEventListener('click', () => cargarCola(container));
  container.querySelector('#devo-g-start')?.addEventListener('click', () => onStart(container));
  container.querySelector('#devo-g-stop')?.addEventListener('click', () => onStop());
  container.querySelector('#devo-g-clear')?.addEventListener('click', () => onClear(container));
  container.querySelector('#devo-g-prueba')?.addEventListener('change', (e) => {
    ui.prueba = Boolean(e.target.checked);
  });
  container.querySelector('#devo-g-copy')?.addEventListener('click', (e) => onCopiarTodo(e.currentTarget));

  // Delegado: los botones de cada fila se repintan en cada cambio del run.
  container.querySelector('#devo-g-list')?.addEventListener('click', (e) => {
    const boton = e.target.closest('[data-copiar]');
    if (boton) onCopiarFila(boton);
  });
}

// -----------------------------------------------------------------------------
// Copiar resultados
// -----------------------------------------------------------------------------

/**
 * Una linea por orden gestionada: `orden <TAB> ticket`. El tabulador es a
 * proposito — pegado en Excel cae en dos columnas, que es donde termina esto.
 * Las ordenes que se apelaron no tienen ticket y van con la columna vacia.
 */
function lineaDeJob(job) {
  return `${job.orden}\t${job.ticket || ''}`.trimEnd();
}

/** Jobs ya resueltos, en el orden en que se gestionaron. */
function jobsResueltos(run) {
  return (run?.jobs || []).filter((j) => j.resultado);
}

async function onCopiarFila(boton) {
  const run = await getRun();
  const job = (run?.jobs || []).find((j) => String(j.id) === boton.dataset.copiar);
  if (!job) return;

  if (await copyToClipboard(lineaDeJob(job))) marcarCopiado(boton, '✓');
}

async function onCopiarTodo(boton) {
  const run = await getRun();
  const lineas = jobsResueltos(run).map(lineaDeJob);
  if (!lineas.length) return;

  if (await copyToClipboard(lineas.join('\n'))) marcarCopiado(boton);
}

// -----------------------------------------------------------------------------
// Cola pendiente
// -----------------------------------------------------------------------------

async function cargarCola(container) {
  const box = container.querySelector('#devo-g-cola');
  ui.cargando = true;
  ui.error = '';
  if (box) box.innerHTML = '<span class="ct-spinner"></span> Consultando la cola…';

  const pairing = await getPairing();
  if (!pairing?.token || !pairing?.base) {
    ui.cargando = false;
    ui.cola = [];
    ui.error = 'Sin emparejar con la web. Abre o recarga la web del modulo.';
    renderCola(container);
    return;
  }
  ui.base = pairing.base;

  const res = await getGestiones(pairing.base, pairing.token);
  ui.cargando = false;

  if (res.status === 401) {
    ui.cola = [];
    ui.error = 'Token caducado: recarga la web del modulo.';
  } else if (!res.ok) {
    ui.cola = [];
    ui.error = res.status === 0
      ? 'No hay conexion con el servidor del modulo.'
      : (res.error || 'No se pudo consultar la cola.');
  } else {
    ui.cola = Array.isArray(res.data?.gestiones) ? res.data.gestiones : [];
  }

  renderCola(container);
  actualizarBoton(container);
}

function renderCola(container) {
  const box = container.querySelector('#devo-g-cola');
  if (!box) return;

  if (ui.error) {
    box.innerHTML = `<p class="scf-error-line">${escapeHtml(ui.error)}</p>`;
    return;
  }

  if (!ui.cola.length) {
    box.innerHTML = `
      <p class="lt-hint">
        No hay devoluciones marcadas para gestionar. En la web del modulo, pulsa
        <strong>"Gestionar devolucion"</strong> en las ordenes que quieras (o marca
        "Gestionar automaticamente" al subirlas).
      </p>
    `;
    return;
  }

  const filas = ui.cola.map((o) => {
    const r = o.reembolso || {};
    const detalle = [r.producto, r.modelo, r.serie].filter(Boolean).join(' · ');
    const cc = (o.gestion?.cc || []).join(', ');
    return `
      <li class="devo-file-row">
        <span class="devo-file-name">
          orden ${escapeHtml(o.orden)}${o.numero_guia ? ` · guia ${escapeHtml(o.numero_guia)}` : ''}
          ${detalle ? `<span class="lt-hint"> — ${escapeHtml(detalle)}</span>` : ''}
          ${cc ? `<span class="lt-hint"> — CC: ${escapeHtml(cc)}</span>` : ''}
        </span>
      </li>
    `;
  }).join('');

  box.innerHTML = `
    <p class="scf-summary"><strong>${ui.cola.length}</strong> devolucion(es) por gestionar.</p>
    <ul class="devo-file-list">${filas}</ul>
  `;
}

function actualizarBoton(container) {
  const btn = container.querySelector('#devo-g-start');
  if (!btn) return;
  getRun().then((run) => {
    const activo = Boolean(run?.active);
    btn.disabled = activo || ui.cargando || ui.cola.length === 0;
    btn.textContent = ui.cola.length ? `Gestionar (${ui.cola.length})` : 'Gestionar';
  }).catch(() => { /* no-op */ });
}

// -----------------------------------------------------------------------------
// Control del run
// -----------------------------------------------------------------------------

async function onStart(container) {
  const run = await getRun();
  if (run?.active) { alert('Ya hay una gestion en curso.'); return; }
  if (!ui.cola.length) { alert('No hay devoluciones por gestionar.'); return; }

  if (!ui.prueba) {
    const ok = confirm(
      `Se gestionaran ${ui.cola.length} devolucion(es) en Falabella: se enviaran apelaciones ` +
      'y/o tickets reales. ¿Continuar?',
    );
    if (!ok) return;
  }

  try {
    const nuevo = makeRun({
      base: ui.base,
      jobs: ui.cola,
      prueba: ui.prueba,
      message: `Gestion iniciada — ${ui.cola.length} devolucion(es)${ui.prueba ? ' (modo prueba)' : ''}`,
    });
    await setRun(nuevo);
    trazaInfo('popup', 'Gestion lanzada', {
      ordenes: ui.cola.map((o) => o.orden),
      prueba: ui.prueba,
      base: ui.base,
    });
    await sendMessage({ type: GESTION_MESSAGES.START });
    log.info('gestion lanzada', { total: ui.cola.length, prueba: ui.prueba });
    renderProgress(container, nuevo);
    actualizarBoton(container);
  } catch (err) {
    alert(`No se pudo iniciar: ${toMessage(err)}`);
  }
}

async function onStop() {
  if (!confirm('¿Detener la gestion en curso?')) return;
  sendMessage({ type: GESTION_MESSAGES.CANCEL }).catch(() => { /* no-op */ });
}

async function onClear(container) {
  const run = await getRun();
  if (run?.active) {
    if (!confirm('Hay una gestion activa. ¿Detenerla y limpiar?')) return;
    sendMessage({ type: GESTION_MESSAGES.CANCEL }).catch(() => { /* no-op */ });
  }
  await clearRun();
  renderProgress(container, null);
  await cargarCola(container);
}

// -----------------------------------------------------------------------------
// Progreso
// -----------------------------------------------------------------------------

function renderProgress(container, run) {
  const wrap = container.querySelector('#devo-g-progress');
  const clearBtn = container.querySelector('#devo-g-clear');
  if (!wrap) return;

  if (!run || !Array.isArray(run.jobs) || !run.jobs.length) {
    wrap.classList.add('hidden');
    clearBtn?.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  clearBtn?.classList.toggle('hidden', Boolean(run.active));

  const hechos = run.jobs.filter((j) => j.resultado).length;
  const conError = run.jobs.filter((j) => j.resultado === RESULTADO.ERROR).length;

  const titulo = container.querySelector('#devo-g-title');
  if (run.active) titulo.textContent = run.prueba ? 'Gestionando (modo prueba)…' : 'Gestionando…';
  else if (run.finishReason === 'cancelled') titulo.textContent = 'Cancelada';
  else if (run.finishReason === 'unpaired') titulo.textContent = 'Sin emparejamiento';
  else if (run.finishReason === 'error') titulo.textContent = 'Terminada con incidencias';
  else titulo.textContent = 'Terminada';

  const contador = container.querySelector('#devo-g-counter');
  contador.innerHTML = `
    <span class="lt-stat-total">${hechos} / ${run.jobs.length}</span>
    ${conError ? `<span class="lt-stat-error">${conError} con error</span>` : ''}
  `;

  const lista = container.querySelector('#devo-g-list');
  lista.innerHTML = '';
  for (const job of run.jobs) {
    const li = document.createElement('li');
    li.className = `lt-region lt-region--${jobClase(job, run)}`;
    li.innerHTML = `
      <div class="lt-region-head">
        <span class="lt-region-name">orden ${escapeHtml(job.orden)}</span>
        <span class="lt-region-status">${escapeHtml(jobEtiqueta(job, run))}</span>
        ${job.resultado ? `<button type="button" class="lg-copy-group" data-copiar="${escapeHtml(job.id)}" title="Copiar orden y ticket">Copiar</button>` : ''}
      </div>
      ${job.mensaje ? `<div class="${job.resultado === RESULTADO.ERROR ? 'lt-err' : 'lt-warn'}">${escapeHtml(job.mensaje)}</div>` : ''}
    `;
    lista.appendChild(li);
  }

  const stopBtn = container.querySelector('#devo-g-stop');
  if (stopBtn) stopBtn.disabled = !run.active;

  const copyBtn = container.querySelector('#devo-g-copy');
  copyBtn?.classList.toggle('hidden', jobsResueltos(run).length === 0);

  const logEl = container.querySelector('#devo-g-log');
  if (logEl) {
    logEl.innerHTML = '';
    const entradas = Array.isArray(run.log) ? run.log.slice(-60).reverse() : [];
    for (const e of entradas) {
      const li = document.createElement('li');
      li.className = `lt-log-item lt-log-item--${e.level}`;
      li.innerHTML = `<span class="lt-log-time">${formatTime(e.ts)}</span><span class="lt-log-msg">${escapeHtml(e.message)}</span>`;
      logEl.appendChild(li);
    }
  }
}

function jobClase(job, run) {
  if (job.resultado === RESULTADO.ERROR) return 'error';
  if (job.resultado) return 'done';
  if (run.currentId === job.id) return 'running';
  return 'pending';
}

function jobEtiqueta(job, run) {
  if (job.resultado === RESULTADO.OK) return 'Apelada';
  if (job.resultado === RESULTADO.TICKET) return job.ticket ? `Ticket ${job.ticket}` : 'Ticket levantado';
  if (job.resultado === RESULTADO.ERROR) return 'Error';
  if (run.currentId !== job.id) return 'En cola';

  return {
    buscar: 'Buscando en el modulo…',
    apelar: 'Enviando apelacion…',
    ticket: 'Levantando ticket…',
  }[job.fase] || 'Preparando…';
}
