// Router del apartado "Devoluciones": una pestana por plataforma.
//
// Las plataformas no implementadas aparecen deshabilitadas ("proximamente"):
// el flujo cambia segun la plataforma elegida, pero por ahora solo existe
// Falabella. Al sumar Walmart/Paris: crear src/features/devoluciones/<id>/ con
// su view.js y agregar la entrada en PLATFORMS (constants.js).

import { PLATFORMS } from '../constants.js';
import { render as renderFalabella } from '../falabella/popup/view.js';

const RENDERERS = {
  falabella: renderFalabella,
};

const DEFAULT_PLATFORM = 'falabella';

export function render(container) {
  container.innerHTML = `
    <nav class="ct-tabs" role="tablist">
      ${PLATFORMS.map((p, i) => `
        <button type="button"
          class="ct-tab ${p.id === DEFAULT_PLATFORM ? 'is-active' : ''}"
          data-platform="${p.id}"
          role="tab"
          tabindex="${i === 0 ? '0' : '-1'}"
          ${p.enabled ? '' : 'disabled title="Proximamente"'}>${p.label}${p.enabled ? '' : ' (proximamente)'}</button>
      `).join('')}
    </nav>
    <div id="devoluciones-platform" class="ct-section-host"></div>
  `;

  const host = container.querySelector('#devoluciones-platform');
  container.querySelectorAll('.ct-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      container.querySelectorAll('.ct-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderPlatform(host, btn.dataset.platform);
    });
  });

  renderPlatform(host, DEFAULT_PLATFORM);
}

function renderPlatform(host, id) {
  const renderer = RENDERERS[id];
  if (!renderer) {
    host.innerHTML = `<p class="ct-empty">La plataforma "${id}" aun no esta implementada.</p>`;
    return;
  }
  host.innerHTML = '<div class="ct-state"><span class="ct-spinner"></span><p>Cargando…</p></div>';
  Promise.resolve(renderer(host)).catch((err) => {
    host.innerHTML = `<p class="ct-empty">Error: ${String(err?.message || err)}</p>`;
  });
}
