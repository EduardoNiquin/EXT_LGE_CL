// Router del feature "Colocar TAGs". Cada sub-sección se renderiza por
// separado en src/features/colocar-tags/popup/sections/.
// Para sumar una sección nueva: crear su archivo en sections/, agregarla
// al array SECTIONS, listo.
import * as reader         from './sections/reader.js';
import * as deliveryTag    from './sections/delivery-tag.js';
import * as removeDelivery from './sections/remove-delivery-tag.js';
import * as productTag     from './sections/product-tag.js';
import * as offerTag       from './sections/offer-tag.js';

// Orden por frecuencia de uso: primero los flujos de aplicación de tags
// (Delivery → Quitar Delivery → Producto → Oferta) y al final la "Lectura"
// (herramienta de diagnóstico de la pantalla, de uso esporádico).
const SECTIONS = [
  { id: 'delivery-tag',    label: 'Tag de Delivery', render: deliveryTag.render },
  { id: 'delivery-remove', label: 'Quitar Delivery', render: removeDelivery.render },
  { id: 'product-tag',     label: 'Tag de Producto', render: productTag.render },
  { id: 'offer-tag',       label: 'Tag de Oferta',   render: offerTag.render },
  { id: 'reader',          label: 'Lectura',         render: reader.render },
];

const DEFAULT_SECTION = 'delivery-tag';

export function render(container) {
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
    <div id="ct-section" class="ct-section-host"></div>
  `;

  const host = container.querySelector('#ct-section');
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
  // section.render puede ser async (delivery-tag carga storage). No await acá:
  // el render escribe sobre host cuando esté listo.
  host.innerHTML = '<div class="ct-state"><span class="ct-spinner"></span><p>Cargando…</p></div>';
  Promise.resolve(section.render(host)).catch((err) => {
    host.innerHTML = `<p class="ct-empty">Error: ${String(err?.message || err)}</p>`;
  });
}
