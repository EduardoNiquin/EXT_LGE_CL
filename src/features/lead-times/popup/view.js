// Sub-router del feature "Lead Times". Por ahora hay una sola sección
// ("Runner"). Mantenemos la estructura tabbed por consistencia con el resto
// del popup y para sumar futuras vistas (diagnóstico, historial, etc.).

import * as runner from './sections/runner.js';

const SECTIONS = [
  { id: 'runner', label: 'Aplicar Lead Times', render: runner.render },
];

const DEFAULT_SECTION = 'runner';

export function render(container) {
  if (SECTIONS.length === 1) {
    // Una sola sección: no pintamos tabs.
    const host = document.createElement('div');
    host.id = 'lt-section';
    host.className = 'ct-section-host';
    container.innerHTML = '';
    container.appendChild(host);
    Promise.resolve(SECTIONS[0].render(host)).catch((err) => {
      host.innerHTML = `<p class="ct-empty">Error: ${String(err?.message || err)}</p>`;
    });
    return;
  }

  container.innerHTML = `
    <nav class="ct-tabs" role="tablist">
      ${SECTIONS.map((s, i) => `
        <button
          type="button"
          class="ct-tab ${s.id === DEFAULT_SECTION ? 'is-active' : ''}"
          data-section="${s.id}"
          role="tab"
          tabindex="${i === 0 ? '0' : '-1'}">${s.label}</button>
      `).join('')}
    </nav>
    <div id="lt-section" class="ct-section-host"></div>
  `;

  const host = container.querySelector('#lt-section');
  container.querySelectorAll('.ct-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.section;
      container.querySelectorAll('.ct-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderSection(host, id);
    });
  });

  renderSection(host, DEFAULT_SECTION);
}

function renderSection(host, id) {
  const section = SECTIONS.find((s) => s.id === id);
  if (!section) {
    host.innerHTML = `<p class="ct-empty">Sección "${id}" desconocida.</p>`;
    return;
  }
  host.innerHTML = '<div class="ct-state"><span class="ct-spinner"></span><p>Cargando…</p></div>';
  Promise.resolve(section.render(host)).catch((err) => {
    host.innerHTML = `<p class="ct-empty">Error: ${String(err?.message || err)}</p>`;
  });
}
