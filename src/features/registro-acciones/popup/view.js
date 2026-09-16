// Router del feature "Registro de acciones". Por ahora una sola seccion
// (el grabador); estructura lista para sumar mas (por ejemplo, sesiones viejas).

import * as grabador from './sections/grabador.js';

const SECTIONS = [
  { id: 'grabador', label: 'Grabar un flujo', render: grabador.render },
];

export function render(container) {
  const host = document.createElement('div');
  host.id = 'ra-section';
  host.className = 'ct-section-host';
  container.innerHTML = '';
  container.appendChild(host);

  Promise.resolve(SECTIONS[0].render(host)).catch((err) => {
    host.innerHTML = `<p class="ct-empty">Error: ${String(err?.message || err)}</p>`;
  });
}
