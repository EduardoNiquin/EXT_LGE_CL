// Router del feature "GATO". Una sola sub-seccion (Jugar); estructura lista
// para sumar mas (ranking, historial) si se quisiera.
//
// Side-effect import: registra los comandos de debug en window.__extLgeCl.gato.

import * as play from './sections/play.js';
import '../debug.js';

const SECTIONS = [
  { id: 'play', label: 'Jugar', render: play.render },
];

export function render(container) {
  const host = document.createElement('div');
  host.id = 'gato-section';
  host.className = 'ct-section-host';
  container.innerHTML = '';
  container.appendChild(host);
  mount(host, SECTIONS[0]);
}

function mount(host, section) {
  if (!section) return;
  host.innerHTML = '<div class="ct-state"><span class="ct-spinner"></span><p>Cargando…</p></div>';
  Promise.resolve(section.render(host)).catch((err) => {
    host.innerHTML = `<p class="ct-empty">Error: ${String(err?.message || err)}</p>`;
  });
}
