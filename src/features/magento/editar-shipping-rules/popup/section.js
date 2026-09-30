// Vista del modulo "Editar Shipping Rules".
//
// Tres pasos en una sola pantalla: (1) leer las rules de la pestana de Magento,
// (2) filtrarlas y marcar cuales, (3) Activar o Desactivar con una confirmacion
// que muestra exactamente que va a pasar. Mientras corre se ve rule por rule el
// antes y el despues; al terminar se exporta a Excel/CSV y queda en el
// historial, desde donde cada corrida se puede revertir.

import { utils, write } from 'xlsx';
import { toMessage } from '../../../../shared/errors/index.js';
import { getActiveTab } from '../../../../shared/messaging/messaging.js';
import { logPanelHtml, renderLogPanel } from '../../../../shared/ui/log-panel.js';
import { logger } from '../../../../shared/utils/logger.js';
import { downloadBlob, downloadText, escapeHtml } from '../../popup/utils.js';
import { activeLabel, filterRules, missingIds, parseTerms, uniqueCarriers } from '../catalog.js';
import {
  ACTION,
  ACTION_LABEL,
  FINISH_REASON,
  ITEM_STATUS,
  ITEM_STATUS_LABEL,
  MESSAGES,
  RUN_PHASE,
} from '../constants.js';
import { actionText, buildChangesCsv, CHANGE_HEADERS, changeRows, exportFilename } from '../export.js';
import {
  clearRun,
  getCatalog,
  getHistory,
  getRun,
  makeRun,
  pushHistory,
  setCatalog,
  setRun,
  subscribeToRun,
  updateRun,
} from '../state.js';

const log = logger('magento/popup');

// Estado de la vista (no se persiste: los filtros y la seleccion son de la
// sesion del popup; lo importante —catalogo, corrida, historial— si).
const view = {
  catalog: null,
  selected: new Set(),
  filters: { text: '', status: 'all', carrier: '' },
  pending: null, // accion esperando confirmacion
};
let unsubscribeRun = null;

export async function render(container) {
  if (unsubscribeRun) unsubscribeRun();
  view.catalog = await getCatalog();
  view.pending = null;

  container.innerHTML = `
    <div class="lt-view esr-view">
      <section id="esr-progress" class="lt-progress esr-progress hidden">
        <div class="lt-progress-head">
          <strong id="esr-progress-title">Preparando...</strong>
          <span id="esr-progress-counter" class="dt-progress-counter"></span>
        </div>
        <div class="lt-progress-bar"><span id="esr-progress-bar"></span></div>
        <p id="esr-progress-detail" class="lt-hint"></p>
        <ul id="esr-run-list" class="esr-run-list"></ul>
        <div class="lt-actions esr-run-actions">
          <button type="button" id="esr-stop" class="ct-btn ct-btn--ghost hidden">Detener</button>
          <button type="button" id="esr-xlsx" class="ct-btn ct-btn--primary hidden">Exportar Excel</button>
          <button type="button" id="esr-csv" class="ct-btn ct-btn--ghost hidden">CSV</button>
          <button type="button" id="esr-revert" class="ct-btn ct-btn--ghost hidden">Revertir</button>
          <button type="button" id="esr-new" class="ct-btn ct-btn--ghost hidden">Nueva edicion</button>
        </div>
        ${logPanelHtml({ title: 'Registro', id: 'esr-log' })}
      </section>

      <section class="lt-form-card" id="esr-pick">
        <h3 class="lt-section-title">Editar Shipping Rules</h3>
        <p class="lt-hint">Activa o desactiva Global Shipping Rules en lote. Se guarda el estado que tenia cada una y el que queda, para exportarlo o revertirlo.</p>

        <div class="esr-step">
          <span class="esr-step-num">1</span>
          <div class="esr-step-body">
            <div class="esr-catalog-row">
              <span id="esr-catalog-info" class="lt-hint">Abre Magento en esta pestana y lee sus rules.</span>
              <button type="button" id="esr-load" class="ct-btn ct-btn--ghost esr-small">Leer rules</button>
            </div>
            <p id="esr-load-error" class="lt-err hidden"></p>
          </div>
        </div>

        <div id="esr-select-block" class="esr-step hidden">
          <span class="esr-step-num">2</span>
          <div class="esr-step-body">
            <label class="dt-field">
              <span class="dt-label">Buscar</span>
              <textarea id="esr-text" class="dt-input esr-search" rows="2"
                placeholder="Nombre, codigo, carrier o ID. Varios: separalos por coma o por linea (ej. Rule 66, 1424)"></textarea>
            </label>
            <div class="esr-filters">
              <div class="ct-tabs esr-status" role="tablist">
                <button type="button" class="ct-tab" data-status="all">Todas</button>
                <button type="button" class="ct-tab" data-status="active">Activas</button>
                <button type="button" class="ct-tab" data-status="inactive">Inactivas</button>
              </div>
              <select id="esr-carrier" class="dt-input esr-carrier" title="Carrier"></select>
            </div>
            <p id="esr-missing" class="lt-err hidden"></p>
            <div class="esr-list-head">
              <span id="esr-count" class="lt-hint"></span>
              <span class="esr-list-actions">
                <button type="button" id="esr-select-all" class="esr-link">Marcar visibles</button>
                <button type="button" id="esr-select-none" class="esr-link">Quitar todas</button>
              </span>
            </div>
            <ul id="esr-list" class="esr-list"></ul>
          </div>
        </div>

        <div id="esr-action-block" class="esr-step hidden">
          <span class="esr-step-num">3</span>
          <div class="esr-step-body">
            <div class="lt-actions esr-actions">
              <button type="button" id="esr-activate" class="ct-btn esr-btn-on" disabled>Activar</button>
              <button type="button" id="esr-deactivate" class="ct-btn esr-btn-off" disabled>Desactivar</button>
            </div>
            <div id="esr-confirm" class="esr-confirm hidden"></div>
          </div>
        </div>
      </section>


      <details id="esr-history" class="ct-diag esr-history">
        <summary>Historial de cambios</summary>
        <div id="esr-history-body"></div>
      </details>
    </div>`;

  wire(container);
  renderCatalog(container);
  const run = await getRun();
  renderRun(container, run);
  await renderHistory(container);

  unsubscribeRun = subscribeToRun((next) => {
    // El popup no llama a un unmount: si se volvio al menu, este contenedor ya
    // no esta en el documento y seguir pintando revienta.
    if (!container.isConnected) {
      unsubscribeRun?.();
      unsubscribeRun = null;
      return;
    }
    renderRun(container, next);
    if (next && !next.active) {
      getCatalog().then((catalog) => {
        view.catalog = catalog;
        renderCatalog(container);
      });
      renderHistory(container);
    }
  });
}

// -----------------------------------------------------------------------------
// Eventos
// -----------------------------------------------------------------------------

function wire(container) {
  const $ = (selector) => container.querySelector(selector);
  $('#esr-load').addEventListener('click', () => onLoad(container));

  $('#esr-text').value = view.filters.text;
  $('#esr-text').addEventListener('input', (event) => {
    view.filters.text = event.target.value;
    renderSelection(container);
  });
  container.querySelectorAll('[data-status]').forEach((button) => {
    button.addEventListener('click', () => {
      view.filters.status = button.dataset.status;
      renderSelection(container);
    });
  });
  $('#esr-carrier').addEventListener('change', (event) => {
    view.filters.carrier = event.target.value;
    renderSelection(container);
  });

  $('#esr-select-all').addEventListener('click', () => {
    visibleRules().forEach((rule) => view.selected.add(rule.id));
    renderSelection(container);
  });
  $('#esr-select-none').addEventListener('click', () => {
    view.selected.clear();
    renderSelection(container);
  });
  $('#esr-list').addEventListener('change', (event) => {
    const box = event.target.closest('input[data-id]');
    if (!box) return;
    if (box.checked) view.selected.add(box.dataset.id);
    else view.selected.delete(box.dataset.id);
    renderSelection(container, { keepList: true });
  });

  $('#esr-activate').addEventListener('click', () => askConfirm(container, ACTION.ACTIVATE));
  $('#esr-deactivate').addEventListener('click', () => askConfirm(container, ACTION.DEACTIVATE));
  $('#esr-confirm').addEventListener('click', (event) => {
    const button = event.target.closest('[data-confirm]');
    if (!button) return;
    if (button.dataset.confirm === 'yes') onStart(container, view.pending);
    view.pending = null;
    renderConfirm(container);
  });

  $('#esr-stop').addEventListener('click', onStop);
  $('#esr-xlsx').addEventListener('click', async () => exportXlsx(await getRun()));
  $('#esr-csv').addEventListener('click', async () => exportCsv(await getRun()));
  $('#esr-revert').addEventListener('click', async () => onRevert(container, await getRun()));
  $('#esr-new').addEventListener('click', () => onNew(container));

  $('#esr-history-body').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-history]');
    if (!button) return;
    const history = await getHistory();
    if (button.dataset.history === 'all-xlsx') {
      exportXlsx(history, 'magento-shipping-rules-historial.xlsx');
      return;
    }
    const entry = history.find((item) => item.id === button.dataset.id);
    if (!entry) return;
    if (button.dataset.history === 'xlsx') exportXlsx(entry);
    if (button.dataset.history === 'csv') exportCsv(entry);
    if (button.dataset.history === 'revert') onRevert(container, entry);
  });
}

/** Pestana activa, solo si parece el admin de Magento. */
async function adminTab() {
  const tab = await getActiveTab();
  if (!/\/obsadm\b|\/admin\//i.test(tab?.url || '')) {
    throw new Error('La pestana activa no es el admin de Magento. Abre Magento, inicia sesion y vuelve a intentar.');
  }
  return tab;
}

/** Mensaje al top frame de la pestana (es el unico que contesta). */
async function ask(tab, message) {
  try {
    return await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  } catch (err) {
    log.warn('la pestana no contesto', err);
    throw new Error('La pestana de Magento no responde. Recargala (F5) y vuelve a intentar.', { cause: err });
  }
}

async function onLoad(container) {
  const button = container.querySelector('#esr-load');
  const error = container.querySelector('#esr-load-error');
  button.disabled = true;
  button.textContent = 'Leyendo...';
  error.classList.add('hidden');
  try {
    const tab = await adminTab();
    const answer = await ask(tab, { type: MESSAGES.LOAD_CATALOG });
    if (!answer?.ok) throw new Error(answer?.reason || 'No se pudieron leer las rules.');
    view.catalog = {
      loadedAt: Date.now(),
      rules: answer.rules,
      totalRecords: answer.totalRecords,
      adminBase: answer.adminBase,
      listingUrl: answer.listingUrl,
    };
    await setCatalog(view.catalog);
    // Lo marcado que ya no existe no puede quedar seleccionado.
    const ids = new Set(answer.rules.map((rule) => rule.id));
    [...view.selected].forEach((id) => { if (!ids.has(id)) view.selected.delete(id); });
  } catch (err) {
    error.textContent = toMessage(err);
    error.classList.remove('hidden');
  } finally {
    button.disabled = false;
    renderCatalog(container);
  }
}

function askConfirm(container, action) {
  const rules = selectedRules();
  if (!rules.length) return;
  view.pending = action;
  renderConfirm(container);
}

async function onStart(container, action) {
  const rules = selectedRules();
  if (!rules.length || !action) return;
  const previous = await getRun();
  if (previous?.active) return;

  await startRun(container, makeRun({ action, rules, listingUrl: view.catalog?.listingUrl || '' }));
}

async function startRun(container, run) {
  let tab;
  try {
    tab = await adminTab();
  } catch (err) {
    showStartError(container, toMessage(err));
    return;
  }
  run.log = [{ ts: Date.now(), level: 'info', message: `${actionText(run)}: ${run.items.length} rule(s)` }];
  await setRun(run);
  try {
    const answer = await ask(tab, { type: MESSAGES.CLAIM, runId: run.id });
    if (!answer?.ok) throw new Error('La pestana no pudo tomar la corrida.');
    view.selected.clear();
  } catch (err) {
    await updateRun((current) => ({
      ...current,
      active: false,
      finishedAt: Date.now(),
      finishReason: FINISH_REASON.ERROR,
      error: toMessage(err),
    }));
  }
}

function showStartError(container, message) {
  const error = container.querySelector('#esr-load-error');
  error.textContent = message;
  error.classList.remove('hidden');
}

async function onStop() {
  if (!confirm('Detener la corrida? La rule que se este guardando en este momento puede quedar guardada.')) return;
  const run = await updateRun((current) => {
    if (!current?.active) return current;
    const items = current.items.map((item) => {
      if (item.status === ITEM_STATUS.APPLYING) return { ...item, status: ITEM_STATUS.PENDING };
      // Se pulso Save y no se alcanzo a ver la respuesta: puede haber quedado.
      if (item.status === ITEM_STATUS.SAVING) {
        return { ...item, status: ITEM_STATUS.OK, note: 'Detenida mientras se guardaba: confirmar en Magento', verified: null };
      }
      return item;
    });
    return {
      ...current,
      items,
      active: false,
      phase: RUN_PHASE.DONE,
      finishedAt: Date.now(),
      finishReason: FINISH_REASON.CANCELLED,
    };
  });
  if (run?.items?.some((item) => item.status !== ITEM_STATUS.PENDING)) await pushHistory(run);
}

async function onNew(container) {
  const run = await getRun();
  if (run?.active) return;
  await clearRun();
  renderRun(container, null);
}

/**
 * Revertir = devolver a su estado anterior SOLO las rules que la corrida cambio
 * de verdad (las "sin cambio" y las fallidas no se tocan).
 */
async function onRevert(container, source) {
  const changed = (source?.items || []).filter((item) =>
    item.status === ITEM_STATUS.OK && typeof item.before === 'boolean' && item.before !== item.target);
  if (!changed.length) {
    alert('Esa corrida no cambio ninguna rule: no hay nada que revertir.');
    return;
  }
  const current = await getRun();
  if (current?.active) {
    alert('Hay una corrida en curso. Espera a que termine o detenla.');
    return;
  }
  const detail = changed.slice(0, 8).map((item) =>
    `#${item.id} ${item.nameBe || item.nameFe}: ${activeLabel(item.target)} -> ${activeLabel(item.before)}`).join('\n');
  const more = changed.length > 8 ? `\n... y ${changed.length - 8} mas` : '';
  if (!confirm(`Se devolveran ${changed.length} rule(s) a su estado anterior:\n\n${detail}${more}\n\nContinuar?`)) return;

  const rules = changed.map((item) => ({ ...item, isActive: item.after, target: item.before }));
  await startRun(container, makeRun({
    action: 'revert',
    rules,
    listingUrl: view.catalog?.listingUrl || '',
    revertOf: source.id,
  }));
}

// -----------------------------------------------------------------------------
// Exportar
// -----------------------------------------------------------------------------

function exportCsv(source) {
  if (!source?.items?.length) return;
  downloadText(buildChangesCsv(source), exportFilename(source, 'csv'));
}

function exportXlsx(source, filename) {
  const runs = Array.isArray(source) ? source : [source];
  const rows = runs.flatMap((run) => changeRows(run));
  if (!rows.length) return;
  const sheet = utils.aoa_to_sheet([CHANGE_HEADERS, ...rows]);
  sheet['!cols'] = [20, 16, 12, 8, 26, 34, 28, 14, 14, 12, 12, 44, 40].map((wch) => ({ wch }));
  sheet['!autofilter'] = { ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: CHANGE_HEADERS.length - 1 } }) };
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, 'Cambios');
  const bytes = write(book, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, filename || exportFilename(runs[0], 'xlsx'));
}

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

function visibleRules() {
  return filterRules(view.catalog?.rules || [], view.filters);
}

function selectedRules() {
  return (view.catalog?.rules || []).filter((rule) => view.selected.has(rule.id));
}

function renderCatalog(container) {
  const info = container.querySelector('#esr-catalog-info');
  const load = container.querySelector('#esr-load');
  const rules = view.catalog?.rules || [];
  if (!rules.length) {
    info.textContent = 'Abre Magento en esta pestana y lee sus rules.';
    load.textContent = 'Leer rules';
  } else {
    const active = rules.filter((rule) => rule.isActive).length;
    info.innerHTML = `<strong>${rules.length}</strong> rules (${active} activas, ${rules.length - active} inactivas) · leidas ${escapeHtml(sinceText(view.catalog.loadedAt))}`;
    load.textContent = 'Actualizar';
  }

  const carrier = container.querySelector('#esr-carrier');
  const carriers = uniqueCarriers(rules);
  if (view.filters.carrier && !carriers.includes(view.filters.carrier)) view.filters.carrier = '';
  carrier.innerHTML = `<option value="">Todos los carriers</option>${carriers.map((name) =>
    `<option value="${escapeHtml(name)}"${name === view.filters.carrier ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}`;

  renderSelection(container);
}

function renderSelection(container, { keepList = false } = {}) {
  const rules = view.catalog?.rules || [];
  const hasRules = rules.length > 0;
  container.querySelector('#esr-select-block').classList.toggle('hidden', !hasRules);
  container.querySelector('#esr-action-block').classList.toggle('hidden', !hasRules);
  if (!hasRules) return;

  container.querySelectorAll('[data-status]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.status === view.filters.status);
  });

  const visible = visibleRules();
  const missing = missingIds(rules, view.filters.text);
  const missingEl = container.querySelector('#esr-missing');
  missingEl.textContent = missing.length ? `No existe ninguna rule con ID ${missing.join(', ')}` : '';
  missingEl.classList.toggle('hidden', !missing.length);

  container.querySelector('#esr-count').innerHTML = `${visible.length} coinciden · <strong>${view.selected.size}</strong> marcada(s)`;

  if (!keepList) {
    const list = container.querySelector('#esr-list');
    list.innerHTML = visible.length
      ? visible.map((rule) => `
        <li class="esr-rule${view.selected.has(rule.id) ? ' is-selected' : ''}">
          <label>
            <input type="checkbox" data-id="${escapeHtml(rule.id)}"${view.selected.has(rule.id) ? ' checked' : ''}>
            <span class="esr-rule-main">
              <span class="esr-rule-name"><span class="esr-rule-id">#${escapeHtml(rule.id)}</span> ${escapeHtml(rule.nameBe || rule.nameFe)}</span>
              <span class="esr-rule-sub">${escapeHtml(rule.nameFe)} · ${escapeHtml(rule.carrier || 'sin carrier')}</span>
            </span>
            <span class="ct-pill ${rule.isActive ? 'ct-pill--active' : 'ct-pill--inactive'}">${activeLabel(rule.isActive)}</span>
          </label>
        </li>`).join('')
      : `<li class="esr-empty">Ninguna rule coincide${parseTerms(view.filters.text).length ? ' con la busqueda' : ''}.</li>`;
  } else {
    container.querySelectorAll('#esr-list input[data-id]').forEach((box) => {
      box.closest('.esr-rule')?.classList.toggle('is-selected', box.checked);
    });
  }

  const selected = selectedRules();
  const toOn = selected.filter((rule) => !rule.isActive).length;
  const toOff = selected.filter((rule) => rule.isActive).length;
  const on = container.querySelector('#esr-activate');
  const off = container.querySelector('#esr-deactivate');
  // Sin ninguna rule que cambiar el boton no hace nada util: se apaga.
  on.disabled = !toOn;
  off.disabled = !toOff;
  on.textContent = selected.length ? `Activar (${toOn})` : 'Activar';
  off.textContent = selected.length ? `Desactivar (${toOff})` : 'Desactivar';
  on.title = `${toOn} de las marcadas estan inactivas y se activarian`;
  off.title = `${toOff} de las marcadas estan activas y se desactivarian`;

  if (view.pending) renderConfirm(container);
}

function renderConfirm(container) {
  const box = container.querySelector('#esr-confirm');
  if (!view.pending) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const target = view.pending === ACTION.ACTIVATE;
  const selected = selectedRules();
  const change = selected.filter((rule) => rule.isActive !== target);
  const same = selected.length - change.length;
  const verb = ACTION_LABEL[view.pending].toLowerCase();
  box.className = `esr-confirm ${target ? 'esr-confirm--on' : 'esr-confirm--off'}`;
  box.innerHTML = `
    <strong>Vas a ${escapeHtml(verb)} ${selected.length} rule(s)</strong>
    <ul class="esr-confirm-list">
      ${change.slice(0, 6).map((rule) => `<li>#${escapeHtml(rule.id)} ${escapeHtml(rule.nameBe || rule.nameFe)}: ${activeLabel(rule.isActive)} → ${activeLabel(target)}</li>`).join('')}
      ${change.length > 6 ? `<li>... y ${change.length - 6} mas</li>` : ''}
    </ul>
    ${same ? `<p class="lt-hint">${same} ya ${same === 1 ? 'esta' : 'estan'} ${target ? 'activa(s)' : 'inactiva(s)'}: se revisan pero no se guardan.</p>` : ''}
    <p class="lt-hint">La pestana de Magento abrira cada rule, cambiara solo "Active this shipping rule" y pulsara Save. Puedes cerrar este panel.</p>
    <div class="lt-actions">
      <button type="button" class="ct-btn ct-btn--primary" data-confirm="yes">Si, ${escapeHtml(verb)}</button>
      <button type="button" class="ct-btn ct-btn--ghost" data-confirm="no">Cancelar</button>
    </div>`;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function renderRun(container, run) {
  const progress = container.querySelector('#esr-progress');
  const pick = container.querySelector('#esr-pick');
  if (!progress) return;
  if (!run) {
    progress.classList.add('hidden');
    pick.classList.remove('hidden');
    return;
  }
  progress.classList.remove('hidden');
  // Mientras corre no se puede armar otra: la seleccion se esconde.
  pick.classList.toggle('hidden', Boolean(run.active));

  const items = run.items || [];
  const done = items.filter((item) => ![ITEM_STATUS.PENDING, ITEM_STATUS.APPLYING, ITEM_STATUS.SAVING].includes(item.status)).length;
  const count = (status) => items.filter((item) => item.status === status).length;

  container.querySelector('#esr-progress-title').textContent = runTitle(run);
  container.querySelector('#esr-progress-counter').textContent = `${done} / ${items.length}`;
  container.querySelector('#esr-progress-bar').style.width = `${items.length ? Math.round((done / items.length) * 100) : 0}%`;
  const detail = [
    `${count(ITEM_STATUS.OK)} cambiada(s)`,
    `${count(ITEM_STATUS.UNCHANGED)} sin cambio`,
    `${count(ITEM_STATUS.ERROR)} con error`,
  ].join(' · ');
  container.querySelector('#esr-progress-detail').textContent = run.error ? `${detail} — ${run.error}` : detail;

  container.querySelector('#esr-run-list').innerHTML = items.map((item) => `
    <li class="esr-run-item esr-run-item--${item.status}">
      <div class="esr-run-head">
        <span class="esr-rule-name"><span class="esr-rule-id">#${escapeHtml(item.id)}</span> ${escapeHtml(item.nameBe || item.nameFe)}</span>
        <span class="esr-run-status">${escapeHtml(ITEM_STATUS_LABEL[item.status] || item.status)}</span>
      </div>
      <div class="esr-run-change">${changeText(item)}</div>
      ${item.error ? `<div class="lt-err">${escapeHtml(item.error)}</div>` : ''}
    </li>`).join('');

  renderLogPanel(container.querySelector('#esr-progress'), run.log || [], { max: 80 });

  const finished = !run.active;
  const changed = items.some((item) => item.status === ITEM_STATUS.OK && item.before !== item.target);
  container.querySelector('#esr-stop').classList.toggle('hidden', finished);
  container.querySelector('#esr-xlsx').classList.toggle('hidden', !finished);
  container.querySelector('#esr-csv').classList.toggle('hidden', !finished);
  container.querySelector('#esr-revert').classList.toggle('hidden', !finished || !changed);
  container.querySelector('#esr-new').classList.toggle('hidden', !finished);
}

function changeText(item) {
  const target = activeLabel(item.target);
  const before = typeof item.before === 'boolean' ? activeLabel(item.before) : '¿?';
  if (item.status === ITEM_STATUS.PENDING || item.status === ITEM_STATUS.APPLYING) {
    return `<span class="esr-muted">→ ${target}</span>`;
  }
  if (item.status === ITEM_STATUS.UNCHANGED) return `<span class="esr-muted">Ya estaba ${before.toLowerCase()}</span>`;
  const after = typeof item.after === 'boolean' ? activeLabel(item.after) : target;
  const check = item.verified === true ? ' <span class="esr-verified" title="Confirmado en el listado">✓ verificada</span>' : '';
  return `${before} → <strong>${after}</strong>${check}${item.note && item.status === ITEM_STATUS.OK && item.verified !== true ? ` <span class="esr-muted">(${escapeHtml(item.note)})</span>` : ''}`;
}

function runTitle(run) {
  const what = actionText(run);
  if (run.active && run.phase === RUN_PHASE.VERIFYING) return `${what}: verificando en el listado...`;
  if (run.active) return `${what}: en curso...`;
  if (run.finishReason === FINISH_REASON.CANCELLED) return `${what}: detenida`;
  if (run.finishReason === FINISH_REASON.ERROR) return `${what}: se detuvo por un error`;
  return `${what}: terminada`;
}

async function renderHistory(container) {
  const body = container.querySelector('#esr-history-body');
  if (!body) return;
  const history = await getHistory();
  container.querySelector('#esr-history summary').textContent = `Historial de cambios (${history.length})`;
  if (!history.length) {
    body.innerHTML = '<p class="lt-hint esr-history-empty">Todavia no hay corridas terminadas.</p>';
    return;
  }
  body.innerHTML = `
    <ul class="esr-history-list">
      ${history.map((entry) => {
        const items = entry.items || [];
        const ok = items.filter((item) => item.status === ITEM_STATUS.OK).length;
        const errors = items.filter((item) => item.status === ITEM_STATUS.ERROR).length;
        const names = items.slice(0, 2).map((item) => `#${item.id}`).join(', ') + (items.length > 2 ? ` +${items.length - 2}` : '');
        return `
          <li class="esr-history-item">
            <div>
              <strong>${escapeHtml(actionText(entry))}</strong> · ${escapeHtml(dateText(entry.startedAt))}
              <div class="lt-hint">${ok} cambiada(s)${errors ? `, ${errors} con error` : ''} · ${escapeHtml(names)}</div>
            </div>
            <span class="esr-history-actions">
              <button type="button" class="esr-link" data-history="xlsx" data-id="${escapeHtml(entry.id)}">Excel</button>
              <button type="button" class="esr-link" data-history="csv" data-id="${escapeHtml(entry.id)}">CSV</button>
              ${ok ? `<button type="button" class="esr-link" data-history="revert" data-id="${escapeHtml(entry.id)}">Revertir</button>` : ''}
            </span>
          </li>`;
      }).join('')}
    </ul>
    <button type="button" class="ct-btn ct-btn--ghost esr-small" data-history="all-xlsx">Exportar todo el historial (Excel)</button>`;
}

function dateText(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sinceText(ts) {
  if (!ts) return '';
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return 'recien';
  if (minutes < 60) return `hace ${minutes} min`;
  return dateText(ts);
}

export const __test = { changeText, runTitle };
