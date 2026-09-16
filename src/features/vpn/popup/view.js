// Router del feature "VPN". Una sola sub-seccion por ahora; la estructura queda
// lista por si mas adelante se suma algo (p. ej. los forwards del DW).

import * as conexion from './sections/conexion.js';
import '../debug.js';

const SECTIONS = [
  { id: 'conexion', label: 'Conexion', render: conexion.render },
];

export function render(container) {
  const host = document.createElement('div');
  host.id = 'vpn-section';
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
