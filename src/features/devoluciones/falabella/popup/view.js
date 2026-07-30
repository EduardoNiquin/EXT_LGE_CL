// Vista de la plataforma Falabella dentro del apartado Devoluciones.
// Dos sub-secciones: el puente de carga/guardado (panel.js, el historico) y la
// gestion automatica (gestion.js: la extension gestiona la devolucion sola en
// SellerCenter y reporta OK o numero de ticket).

import * as panel from './panel.js';
import * as gestion from './gestion.js';

const SECTIONS = [
  { id: 'cargar', label: 'Cargar y guardar', render: panel.render },
  { id: 'gestion', label: 'Gestion automatica', render: gestion.render },
];

const DEFAULT_SECTION = 'cargar';

export function render(container) {
  container.innerHTML = `
    <nav class="ct-tabs devo-subtabs" role="tablist">
      ${SECTIONS.map((s, i) => `
        <button type="button" class="ct-tab ${s.id === DEFAULT_SECTION ? 'is-active' : ''}"
          data-section="${s.id}" role="tab" tabindex="${i === 0 ? '0' : '-1'}">${s.label}</button>
      `).join('')}
    </nav>
    <div id="devo-falabella-section" class="ct-section-host"></div>
  `;

  const host = container.querySelector('#devo-falabella-section');
  container.querySelectorAll('.devo-subtabs .ct-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.devo-subtabs .ct-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderSection(host, btn.dataset.section);
    });
  });

  renderSection(host, DEFAULT_SECTION);
}

function renderSection(host, id) {
  const section = SECTIONS.find((s) => s.id === id);
  if (!section) {
    host.innerHTML = `<p class="ct-empty">Seccion "${id}" desconocida.</p>`;
    return;
  }
  host.innerHTML = '<div class="ct-state"><span class="ct-spinner"></span><p>Cargando…</p></div>';
  Promise.resolve(section.render(host)).catch((err) => {
    host.innerHTML = `<p class="ct-empty">Error: ${String(err?.message || err)}</p>`;
  });
}
