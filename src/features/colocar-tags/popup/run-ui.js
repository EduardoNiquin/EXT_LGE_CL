// Controlador de UI compartido para las secciones de "Colocar TAGs".
//
// Las 4 secciones (delivery, quitar-delivery, producto, oferta) comparten el
// mismo ciclo: arrancar un run (storage-driven), mostrar progreso por SKU en
// vivo, un panel de logs del proceso, y botones Aplicar/Cancelar. Antes cada
// sección duplicaba ~120 líneas de port-handling + render. Ahora todo eso vive
// acá y cada sección sólo aporta su formulario + cómo recolectar la config.
//
// Como las secciones son tabbed (sólo una montada a la vez), mantenemos una
// única subscripción/watchdog a nivel módulo y la reemplazamos en cada mount.

import { STATUS } from '../constants.js';
import {
  clearRun,
  getRun,
  makeRun,
  setRun,
  subscribeToRun,
  updateRun,
} from '../state.js';
import { logPanelHtml, renderLogPanel } from '../../../shared/ui/log-panel.js';
import { createDraftStore } from '../../../shared/ui/persist.js';
import { escapeHtml } from './utils.js';
import { logger } from '../../../shared/utils/logger.js';

const log = logger('colocar-tags/run-ui');

const ICONS = {
  [STATUS.OK]: '✓',
  [STATUS.ERROR]: '✗',
  [STATUS.RUNNING]: '◐',
  [STATUS.SKIPPED]: '⊝',
};
function iconFor(status) { return ICONS[status] || '·'; }

let currentUnsub = null;
let watchdogTimer = null;

/** Markup del bloque de progreso + panel de logs (pegar tras el form). */
export function progressMarkup(prefix) {
  return `
    <div id="${prefix}-progress" class="dt-progress hidden">
      <div class="dt-progress-head">
        <strong id="${prefix}-progress-title">Procesando…</strong>
        <span id="${prefix}-progress-counter" class="dt-progress-counter"></span>
      </div>
      <ul id="${prefix}-progress-list" class="dt-progress-list"></ul>
      ${logPanelHtml({ title: 'Registro del proceso' })}
    </div>
  `;
}

/**
 * Monta el ciclo completo de una sección.
 *
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {string} opts.prefix         prefijo de ids del DOM (dt, dr, pt, of)
 * @param {string} opts.kind           RUN_KIND de esta sección
 * @param {object} opts.stepLabels     mapa step→etiqueta legible
 * @param {string[]} opts.formSelectors selectores a deshabilitar mientras corre
 * @param {() => ({config:object, skus:string[], message?:string}|null)} opts.collect
 *        recolecta y valida el form; devuelve null (tras avisar) si es inválido
 * @param {object} [opts.draft]        { key, collect, restore } para autosave
 */
export function mountRunSection(container, opts) {
  const { prefix, kind, stepLabels, formSelectors = [], collect, draft } = opts;

  const runBtn    = container.querySelector(`#${prefix}-run`);
  const cancelBtn = container.querySelector(`#${prefix}-cancel`);

  // Autosave del borrador (as-you-type) para no perder lo cargado.
  let draftStore = null;
  if (draft?.key && typeof draft.collect === 'function') {
    draftStore = createDraftStore(draft.key);
    const onInput = () => draftStore.save(draft.collect());
    container.addEventListener('input', onInput);
    container.addEventListener('change', onInput);
  }

  function setFormDisabled(disabled) {
    for (const sel of formSelectors) {
      container.querySelectorAll(sel).forEach((el) => { el.disabled = disabled; });
    }
  }

  function syncUI(run) {
    const activeAny  = Boolean(run?.active);
    const mineActive = activeAny && run.kind === kind;

    if (runBtn)    runBtn.disabled    = activeAny;
    if (cancelBtn) cancelBtn.disabled = !mineActive;
    setFormDisabled(activeAny);

    renderRun(container, run, { prefix, kind, stepLabels });

    if (mineActive && !run.claimed) scheduleWatchdog(run);
    else clearWatchdog();
  }

  // Subscripción única (reemplaza la de la sección anterior).
  if (currentUnsub) currentUnsub();
  clearWatchdog();
  currentUnsub = subscribeToRun(syncUI);

  if (runBtn) {
    runBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const data = collect();
      if (!data) return;
      if (draftStore && draft?.collect) draftStore.saveNow(draft.collect());
      const ok = await startRun({ kind, ...data });
      if (!ok) return;
    });
  }
  if (cancelBtn) cancelBtn.addEventListener('click', cancelRun);

  // Estado inicial (puede haber un run en curso de una apertura previa).
  getRun().then((run) => {
    // Reconciliar run viejo sin reclamar (p.ej. la pestaña no era GP1).
    if (run?.active && !run.claimed && Date.now() - (run.startedAt || 0) > 12000) {
      finalizeNotDetected();
      return;
    }
    syncUI(run);
  });
}

export function renderRun(container, run, { prefix, kind, stepLabels }) {
  const wrap = container.querySelector(`#${prefix}-progress`);
  if (!wrap) return;
  if (!run || run.kind !== kind) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  const titleEl = container.querySelector(`#${prefix}-progress-title`);
  if (titleEl) titleEl.textContent = titleFor(run);

  const list = container.querySelector(`#${prefix}-progress-list`);
  if (list) {
    list.innerHTML = (run.items || [])
      .map((it) => `<li class="dt-progress-item dt-progress-item--${it.status}">${renderItemBody(it, stepLabels)}</li>`)
      .join('');
  }

  const total = run.total || (run.items?.length ?? 0);
  let done = 0;
  for (const it of run.items || []) {
    if ([STATUS.OK, STATUS.ERROR, STATUS.SKIPPED].includes(it.status)) done++;
  }
  const counter = container.querySelector(`#${prefix}-progress-counter`);
  if (counter) counter.textContent = `${done} / ${total}`;

  renderLogPanel(wrap, run.log);
}

function renderItemBody(it, stepLabels) {
  let stepLabel = stepLabels[it.step] || it.step || '';
  if (it.detail?.tagIndex) stepLabel = `Tag ${it.detail.tagIndex} — ${stepLabel}`;
  else if (it.detail?.offerLabel) stepLabel = `${it.detail.offerLabel} — ${stepLabel}`;
  const reason = it.reason ? `<span class="dt-item-reason">${escapeHtml(it.reason)}</span>` : '';
  return `
    <span class="dt-item-icon">${iconFor(it.status)}</span>
    <span class="dt-item-sku">${escapeHtml(it.sku)}</span>
    <span class="dt-item-step">${escapeHtml(stepLabel)}</span>
    ${reason}
  `;
}

function titleFor(run) {
  if (run.active) return 'Procesando…';
  switch (run.finishReason) {
    case 'cancelled':    return 'Cancelado';
    case 'error':        return run.errorReason ? `Error: ${run.errorReason}` : 'Error';
    case 'not-detected': return run.errorReason || 'Pantalla MIM no detectada';
    default:             return 'Finalizado';
  }
}

// -----------------------------------------------------------------------------
// start / cancel
// -----------------------------------------------------------------------------

async function startRun({ kind, config, skus, message }) {
  const current = await getRun();
  if (current?.active) {
    alert('Ya hay un proceso en curso. Espere a que termine o cancélelo.');
    return false;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { alert('No hay pestaña activa.'); return false; }

  await clearRun();
  const run = makeRun({ kind, config, skus, message });
  await setRun(run);
  log.info('run lanzado', { kind, total: run.total });
  return true;
}

async function cancelRun() {
  log.info('cancel solicitado desde popup');
  await updateRun((r) => (r ? {
    ...r,
    active: false,
    finishedAt: Date.now(),
    finishReason: r.finishReason || 'cancelled',
  } : r));
}

// -----------------------------------------------------------------------------
// watchdog (lado popup): cubre el caso en que la pestaña activa no tiene el
// content script (no es GP1) y por ende nadie reclama el run.
// -----------------------------------------------------------------------------

function scheduleWatchdog(run) {
  clearWatchdog();
  const elapsed = Date.now() - (run.startedAt || Date.now());
  const remaining = Math.max(1500, 12000 - elapsed);
  watchdogTimer = setTimeout(finalizeNotDetected, remaining);
}

function clearWatchdog() {
  if (watchdogTimer != null) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

async function finalizeNotDetected() {
  clearWatchdog();
  const r = await getRun();
  if (!r || !r.active || r.claimed) return;
  await updateRun((x) => ({
    ...x,
    active: false,
    finishedAt: Date.now(),
    finishReason: 'not-detected',
    errorReason: 'Ninguna pestaña respondió. Abra GP1 (Marketing Info Mapping) en la pestaña activa y reintente.',
  }));
  alert(
    'No se detectó la pantalla "Marketing Info Mapping" en la pestaña activa.\n\n' +
    'Posibles causas:\n' +
    '• La pestaña activa no es la de GP1/MIM.\n' +
    '• El content script no cargó (recargue la pestaña de GP1).',
  );
}

export { clearRun };
