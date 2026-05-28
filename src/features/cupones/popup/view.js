// Sub-router del feature "Cupones". Por ahora una sola sección — pero
// dejamos la estructura tabbed lista para sumar futuras sub-features
// (p. ej. "Activar/Desactivar cupón", "Duplicar cupón", etc.).

import * as removeRule from './sections/remove-rule.js';

const SECTIONS = [
  { id: 'remove-rule', label: 'Quitar Regla de Cupón', render: removeRule.render },
];

const DEFAULT_SECTION = 'remove-rule';

export function render(container) {
  if (SECTIONS.length === 1) {
    const host = document.createElement('div');
    host.id = 'cu-section';
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
    <div id="cu-section" class="ct-section-host"></div>
  `;

  const host = container.querySelector('#cu-section');
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
