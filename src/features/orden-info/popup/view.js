// Vista del feature "Información de Orden". Sección única: buscador + detalle de
// la orden de la pestaña activa.

import * as orderInfo from './sections/order-info.js';

export function render(container) {
  const host = document.createElement('div');
  host.id = 'oi-section';
  host.className = 'ct-section-host';
  container.innerHTML = '';
  container.appendChild(host);
  Promise.resolve(orderInfo.render(host)).catch((err) => {
    host.innerHTML = `<p class="ct-empty">Error: ${String(err?.message || err)}</p>`;
  });
}
