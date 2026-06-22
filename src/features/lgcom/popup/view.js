// Router de nivel superior del feature "LG.com".
//
// Dos secciones:
//   - "Información web": captura GraphQL/REST de PDP/PLP/PBP (sections/info-web).
//   - "Revisar Destacados": revisa el recuadro de destacados de las páginas de
//     categoría (tag + stock) — sections/destacados.
//
// La sección activa se persiste en chrome.storage.local.

import { SECTIONS, STORAGE_KEYS } from '../constants.js';
import { getStorage, setStorage } from '../../../shared/storage/storage.js';
import * as infoWeb from './sections/info-web.js';
import * as destacados from './sections/destacados/index.js';

const DEFAULT_SECTION = 'info-web';

const RENDERERS = {
  'info-web':   infoWeb.render,
  'destacados': destacados.render,
};

let activeSectionId = DEFAULT_SECTION;
let hostEl = null;

export function render(container) {
  container.innerHTML = '<div class="ct-state"><span class="ct-spinner"></span><p>Cargando…</p></div>';

  loadPrefs().then(() => {
    buildShell(container);
    mountSection(activeSectionId);
  });
}

async function loadPrefs() {
  try {
    const section = await getStorage(STORAGE_KEYS.SECTION);
    if (SECTIONS.some((s) => s.id === section)) activeSectionId = section;
  } catch { /* default */ }
}

function buildShell(container) {
  container.innerHTML = `
    <nav class="ct-tabs lg-section-tabs" role="tablist">
      ${SECTIONS.map((s) => `
        <button type="button" class="ct-tab lg-section-tab ${s.id === activeSectionId ? 'is-active' : ''}"
                data-section="${s.id}" role="tab">${s.label}</button>
      `).join('')}
    </nav>
    <div id="lg-section-host" class="ct-section-host"></div>
  `;

  hostEl = container.querySelector('#lg-section-host');

  container.querySelectorAll('.lg-section-tab').forEach((btn) => {
    btn.addEventListener('click', () => selectSection(btn.dataset.section, container));
  });
}

function selectSection(sectionId, container) {
  if (!RENDERERS[sectionId]) return;
  activeSectionId = sectionId;
  setStorage(STORAGE_KEYS.SECTION, sectionId);
  container.querySelectorAll('.lg-section-tab').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.section === sectionId));
  mountSection(sectionId);
}

function mountSection(sectionId) {
  const renderer = RENDERERS[sectionId];
  if (!hostEl || !renderer) return;
  Promise.resolve(renderer(hostEl)).catch((err) => {
    hostEl.innerHTML = `<p class="ct-empty">Error: ${String(err?.message || err)}</p>`;
  });
}
