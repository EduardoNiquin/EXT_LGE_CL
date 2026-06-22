// Sub-router de "Revisar Destacados": Revisión | Configuración.
//
// La sub-tab activa se persiste en chrome.storage.local.

import { DESTACADOS_TABS, STORAGE_KEYS } from '../../../constants.js';
import { getStorage, setStorage } from '../../../../../shared/storage/storage.js';
import * as review from './review.js';
import * as config from './config.js';

const DEFAULT_TAB = 'review';

const RENDERERS = {
  review: review.render,
  config: config.render,
};

let activeTabId = DEFAULT_TAB;
let hostEl = null;

export function render(container) {
  container.innerHTML = '<div class="ct-state"><span class="ct-spinner"></span><p>Cargando…</p></div>';

  loadPrefs().then(() => {
    buildShell(container);
    mountTab(activeTabId);
  });
}

async function loadPrefs() {
  try {
    const tab = await getStorage(STORAGE_KEYS.DESTACADOS_TAB);
    if (DESTACADOS_TABS.some((t) => t.id === tab)) activeTabId = tab;
  } catch { /* default */ }
}

function buildShell(container) {
  container.innerHTML = `
    <nav class="ct-tabs lg-dest-tabs" role="tablist">
      ${DESTACADOS_TABS.map((t) => `
        <button type="button" class="ct-tab lg-dest-tab ${t.id === activeTabId ? 'is-active' : ''}"
                data-tab="${t.id}" role="tab">${t.label}</button>
      `).join('')}
    </nav>
    <div id="lg-dest-host" class="ct-section-host"></div>
  `;

  hostEl = container.querySelector('#lg-dest-host');

  container.querySelectorAll('.lg-dest-tab').forEach((btn) => {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab, container));
  });
}

function selectTab(tabId, container) {
  if (!RENDERERS[tabId]) return;
  activeTabId = tabId;
  setStorage(STORAGE_KEYS.DESTACADOS_TAB, tabId);
  container.querySelectorAll('.lg-dest-tab').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.tab === tabId));
  mountTab(tabId);
}

function mountTab(tabId) {
  const renderer = RENDERERS[tabId];
  if (!hostEl || !renderer) return;
  Promise.resolve(renderer(hostEl)).catch((err) => {
    hostEl.innerHTML = `<p class="ct-empty">Error: ${String(err?.message || err)}</p>`;
  });
}
