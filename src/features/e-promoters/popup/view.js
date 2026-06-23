// Router del feature "E-promoters". Por ahora una sola sub-seccion ("Informe
// ordenes"); estructura tabbed lista para sumar mas.

import * as informeOrdenes from './sections/informe-ordenes.js';

const SECTIONS = [
  { id: 'informe-ordenes', label: 'Informe ordenes', render: informeOrdenes.render },
];

const DEFAULT_SECTION = 'informe-ordenes';

export function render(container) {
  if (SECTIONS.length === 1) {
    const host = document.createElement('div');
    host.id = 'epr-section';
    host.className = 'ct-section-host';
    container.innerHTML = '';
    container.appendChild(host);
    mount(host, SECTIONS[0]);
    return;
  }

  container.innerHTML = `
    <nav class="ct-tabs" role="tablist">
      ${SECTIONS.map((s, i) => `
        <button type="button" class="ct-tab ${s.id === DEFAULT_SECTION ? 'is-active' : ''}"
          data-section="${s.id}" role="tab" tabindex="${i === 0 ? '0' : '-1'}">${s.label}</button>
      `).join('')}
    </nav>
    <div id="epr-section" class="ct-section-host"></div>
  `;

  const host = container.querySelector('#epr-section');
  container.querySelectorAll('.ct-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.section;
      container.querySelectorAll('.ct-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
      const section = SECTIONS.find((s) => s.id === id);
      if (section) mount(host, section);
    });
  });

  mount(host, SECTIONS.find((s) => s.id === DEFAULT_SECTION));
}

function mount(host, section) {
  if (!section) return;
  host.innerHTML = '<div class="ct-state"><span class="ct-spinner"></span><p>Cargando…</p></div>';
  Promise.resolve(section.render(host)).catch((err) => {
    host.innerHTML = `<p class="ct-empty">Error: ${String(err?.message || err)}</p>`;
  });
}
