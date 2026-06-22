// Feature Ajustes — pantalla de configuración global de la extensión.
// Por ahora muestra solo el sub-panel de control de logs por scope, pero
// está armada como router de secciones por si más adelante hay más.

import {
  getAllKnownScopes,
  isScopeEnabled,
  setScopeEnabled,
  subscribe,
} from '../../../shared/log-config/index.js';
import { escapeHtml } from '../../colocar-tags/popup/utils.js';
import { getThemePref, setThemePref } from '../../../shared/theme/index.js';
import { isDevMode, setDevMode, subscribeDevMode } from '../../../shared/dev-mode/index.js';
import { getErrors, clearErrors, subscribeErrors } from '../../../shared/diagnostics/index.js';

const THEME_OPTIONS = [
  { value: 'light',  label: 'Claro' },
  { value: 'dark',   label: 'Oscuro' },
  { value: 'system', label: 'Sistema' },
];

const KNOWN_SCOPES_FALLBACK = [
  'colocar-tags',
  'colocar-tags:product',
  'colocar-tags:combobox',
  'colocar-tags:messagebox',
  'lead-times',
  'content',
  'debug',
  'popup',
];

export function render(container) {
  container.innerHTML = `
    <div class="aj-root">
      <section class="aj-card">
        <header class="aj-card-head">
          <h3 class="aj-card-title">Apariencia</h3>
          <p class="aj-card-desc">Elija el tema de la interfaz. "Sistema" sigue la preferencia del sistema operativo.</p>
        </header>
        <div class="aj-theme-seg" id="aj-theme-seg" role="radiogroup" aria-label="Tema">
          ${THEME_OPTIONS.map((o) => `
            <button type="button" class="aj-theme-opt" data-theme-value="${o.value}" role="radio" aria-checked="false">
              ${o.label}
            </button>
          `).join('')}
        </div>
      </section>

      <section class="aj-card">
        <header class="aj-card-head">
          <h3 class="aj-card-title">Modo desarrollador</h3>
          <p class="aj-card-desc">Fuerza el nivel de logs a <code>debug</code> en todos los contextos y resalta la captura de errores. Útil al probar automatizaciones. Cross-context y persistente.</p>
        </header>
        <label class="aj-scope-row" for="aj-devmode" style="cursor:pointer;">
          <span class="aj-scope-name" style="font-family:inherit;font-size:13px;">Activar modo desarrollador</span>
          <span class="aj-toggle">
            <input type="checkbox" id="aj-devmode" />
            <span class="aj-toggle-slot"><span class="aj-toggle-knob"></span></span>
          </span>
        </label>
      </section>

      <section class="aj-card">
        <header class="aj-card-head aj-card-head-row">
          <div>
            <h3 class="aj-card-title">Errores recientes</h3>
            <p class="aj-card-desc">Últimos errores capturados en cualquier contexto (content, popup, service worker). Se actualiza en vivo.</p>
          </div>
          <button type="button" class="aj-btn aj-btn-sm" id="aj-clear-errors">Limpiar</button>
        </header>
        <ul class="aj-err-list" id="aj-err-list" role="list"></ul>
      </section>

      <section class="aj-card">
        <header class="aj-card-head">
          <h3 class="aj-card-title">Logs por módulo</h3>
          <p class="aj-card-desc">Habilite o deshabilite el output de consola por scope. Los cambios se aplican al instante y persisten entre sesiones.</p>
        </header>

        <div class="aj-toolbar">
          <button type="button" class="aj-btn aj-btn-sm" id="aj-enable-all">Habilitar todos</button>
          <button type="button" class="aj-btn aj-btn-sm" id="aj-disable-all">Deshabilitar todos</button>
        </div>

        <ul class="aj-scope-list" id="aj-scope-list" role="list"></ul>

        <p class="aj-card-foot">Tip: ejecute <code>__extLgeCl.log.setLevel('debug')</code> en consola para ver más detalle dentro de cada scope.</p>
      </section>
    </div>
  `;

  injectStyles();

  setupThemeSegment(container);
  const cleanups = [];
  cleanups.push(setupDevMode(container));
  cleanups.push(setupErrorList(container));

  const listEl = container.querySelector('#aj-scope-list');
  const btnEnableAll  = container.querySelector('#aj-enable-all');
  const btnDisableAll = container.querySelector('#aj-disable-all');

  function getScopesToShow() {
    const known = new Set(getAllKnownScopes());
    for (const s of KNOWN_SCOPES_FALLBACK) known.add(s);
    return Array.from(known).sort();
  }

  function renderList() {
    const scopes = getScopesToShow();
    listEl.innerHTML = scopes.map((scope) => {
      const enabled = isScopeEnabled(scope);
      const id = `aj-toggle-${scope.replace(/[^a-z0-9_-]/gi, '_')}`;
      return `
        <li class="aj-scope-item ${enabled ? 'is-on' : 'is-off'}">
          <label class="aj-scope-row" for="${id}">
            <span class="aj-scope-name">${escapeHtml(scope)}</span>
            <span class="aj-toggle">
              <input type="checkbox" id="${id}" data-scope="${escapeHtml(scope)}" ${enabled ? 'checked' : ''} />
              <span class="aj-toggle-slot"><span class="aj-toggle-knob"></span></span>
            </span>
          </label>
        </li>
      `;
    }).join('');
  }

  function onListChange(e) {
    const cb = e.target.closest('input[type="checkbox"][data-scope]');
    if (!cb) return;
    const scope = cb.dataset.scope;
    setScopeEnabled(scope, cb.checked);
    // El re-render es disparado por el subscribe (storage.onChanged), pero
    // forzamos uno acá para latencia 0 — el subscribe puede tardar un tick.
    renderList();
  }

  function bulkSet(value) {
    for (const scope of getScopesToShow()) setScopeEnabled(scope, value);
    renderList();
  }

  listEl.addEventListener('change', onListChange);
  btnEnableAll.addEventListener('click', () => bulkSet(true));
  btnDisableAll.addEventListener('click', () => bulkSet(false));

  const unsubscribe = subscribe(() => {
    // El popup puede haberse cerrado entre ticks: si listEl ya no está
    // en el DOM, no re-renderizamos.
    if (listEl.isConnected) renderList();
  });

  // Cleanup cuando el container se desmonta — el popup llama a render() de
  // otra feature, lo cual reemplaza el HTML. Usamos MutationObserver para
  // detectarlo. Es defensivo: si no se detecta, el subscribe se queda
  // colgado hasta que el popup se cierre, lo cual es OK.
  const mo = new MutationObserver(() => {
    if (!listEl.isConnected) {
      unsubscribe();
      for (const c of cleanups) { try { c?.(); } catch { /* noop */ } }
      mo.disconnect();
    }
  });
  mo.observe(container, { childList: true, subtree: false });

  renderList();
}

function setupDevMode(container) {
  const cb = container.querySelector('#aj-devmode');
  if (!cb) return null;
  const sync = () => { cb.checked = isDevMode(); };
  cb.addEventListener('change', () => setDevMode(cb.checked));
  const unsub = subscribeDevMode(sync);
  sync();
  return unsub;
}

function setupErrorList(container) {
  const listEl = container.querySelector('#aj-err-list');
  const clearBtn = container.querySelector('#aj-clear-errors');
  if (!listEl) return null;

  const fmtTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const render = (errors) => {
    const list = (errors || getErrors()).slice().reverse();
    if (!list.length) {
      listEl.innerHTML = '<li class="aj-err-empty">Sin errores capturados.</li>';
      return;
    }
    listEl.innerHTML = list.map((e) => `
      <li class="aj-err-item">
        <div class="aj-err-head">
          <span class="aj-err-time">${fmtTime(e.ts)}</span>
          <span class="aj-err-ctx">${escapeHtml(e.context || '?')}${e.scope ? ` · ${escapeHtml(e.scope)}` : ''}</span>
        </div>
        <div class="aj-err-msg">${escapeHtml(e.name && e.name !== 'Error' ? `${e.name}: ` : '')}${escapeHtml(e.message || '')}</div>
        ${e.stack ? `<details class="aj-err-stack"><summary>stack</summary><pre>${escapeHtml(e.stack)}</pre></details>` : ''}
      </li>
    `).join('');
  };

  clearBtn?.addEventListener('click', () => clearErrors());
  const unsub = subscribeErrors(render);
  render();
  return unsub;
}

function setupThemeSegment(container) {
  const seg = container.querySelector('#aj-theme-seg');
  if (!seg) return;
  const sync = () => {
    const pref = getThemePref();
    seg.querySelectorAll('.aj-theme-opt').forEach((btn) => {
      const on = btn.dataset.themeValue === pref;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  };
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('.aj-theme-opt');
    if (!btn) return;
    setThemePref(btn.dataset.themeValue);
    sync();
  });
  sync();
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .aj-root { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    .aj-card {
      background: var(--card-bg, #fff);
      border: 1px solid var(--border, #e5e7eb);
      border-radius: 10px;
      padding: 14px;
    }
    .aj-card-head { margin-bottom: 10px; }
    .aj-card-head-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .aj-card-head-row > div { flex: 1; }
    .aj-card-title { margin: 0 0 4px 0; font-size: 14px; font-weight: 600; }
    .aj-card-desc  { margin: 0; font-size: 12px; color: var(--muted, #6b7280); line-height: 1.4; }
    .aj-card-foot  { margin: 10px 0 0 0; font-size: 11px; color: var(--muted, #6b7280); }
    .aj-card-foot code {
      background: var(--code-bg, #f3f4f6);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 10.5px;
    }
    .aj-theme-seg {
      display: flex;
      gap: 4px;
      padding: 4px;
      background: var(--surface-3, #f3f4f6);
      border-radius: 8px;
    }
    .aj-theme-opt {
      flex: 1;
      border: none;
      background: transparent;
      padding: 6px 8px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted, #555);
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      transition: background 120ms, color 120ms;
    }
    .aj-theme-opt:hover { color: var(--text, #111); }
    .aj-theme-opt.is-active {
      background: var(--surface, #fff);
      color: var(--accent, #ea1917);
      box-shadow: 0 1px 2px rgba(0,0,0,.12);
    }
    .aj-toolbar { display: flex; gap: 6px; margin-bottom: 10px; }
    .aj-btn {
      border: 1px solid var(--border, #e5e7eb);
      background: var(--card-bg, #fff);
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 11.5px;
      cursor: pointer;
    }
    .aj-btn:hover { background: var(--card-hover-bg, #f9fafb); }
    .aj-btn-sm { padding: 3px 8px; }
    .aj-scope-list {
      list-style: none;
      margin: 0;
      padding: 0;
      border-top: 1px solid var(--border-soft, #f3f4f6);
    }
    .aj-scope-item {
      border-bottom: 1px solid var(--border-soft, #f3f4f6);
    }
    .aj-scope-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 2px;
      cursor: pointer;
    }
    .aj-scope-name {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: var(--text, #111827);
    }
    .aj-scope-item.is-off .aj-scope-name { color: var(--muted, #9ca3af); }
    .aj-toggle {
      position: relative;
      display: inline-block;
      width: 32px;
      height: 18px;
      flex-shrink: 0;
    }
    .aj-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
    .aj-toggle-slot {
      position: absolute;
      inset: 0;
      background: #d1d5db;
      border-radius: 999px;
      transition: background 120ms;
    }
    .aj-toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      background: white;
      border-radius: 50%;
      box-shadow: 0 1px 2px rgba(0,0,0,.2);
      transition: left 120ms;
    }
    .aj-toggle input:checked + .aj-toggle-slot {
      background: #10b981;
    }
    .aj-toggle input:checked + .aj-toggle-slot .aj-toggle-knob {
      left: 16px;
    }
    .aj-err-list { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; }
    .aj-err-item {
      border-left: 2px solid var(--danger, #ef4444);
      background: var(--surface-3, #f9fafb);
      border-radius: 0 6px 6px 0;
      padding: 6px 8px;
      margin-bottom: 6px;
    }
    .aj-err-head { display: flex; gap: 8px; align-items: center; margin-bottom: 2px; }
    .aj-err-time { font-size: 10.5px; color: var(--muted, #9ca3af); font-variant-numeric: tabular-nums; }
    .aj-err-ctx {
      font-size: 10px; color: var(--muted, #6b7280);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .aj-err-msg { font-size: 12px; color: var(--text, #111827); word-break: break-word; }
    .aj-err-stack summary { font-size: 10.5px; color: var(--muted, #6b7280); cursor: pointer; margin-top: 3px; }
    .aj-err-stack pre {
      font-size: 10px; white-space: pre-wrap; word-break: break-word;
      background: var(--code-bg, #f3f4f6); padding: 6px; border-radius: 4px; margin: 4px 0 0 0;
      max-height: 140px; overflow: auto;
    }
    .aj-err-empty { font-size: 12px; color: var(--muted, #9ca3af); padding: 4px 2px; }
  `;
  document.head.appendChild(style);
}
