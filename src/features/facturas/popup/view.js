// Router de "Facturas": Datos (el Excel y la factura) -> Adjuntos -> Plan (que
// se va a escribir) -> Ejecutar (la corrida en GEVS).

import * as datos from './sections/datos.js';
import * as adjuntos from './sections/adjuntos.js';
import * as plan from './sections/plan.js';
import * as ejecutar from './sections/ejecutar.js';
import { toMessage } from '../../../shared/errors/index.js';
import { escapeHtml } from '../../../shared/ui/format.js';

const SECTIONS = [
  { id: 'datos', label: 'Datos', render: datos.render },
  { id: 'adjuntos', label: 'Adjuntos', render: adjuntos.render },
  { id: 'plan', label: 'Plan', render: plan.render },
  { id: 'ejecutar', label: 'Ejecutar', render: ejecutar.render },
];

export function render(container) {
  container.innerHTML = `
    <nav class="ct-tabs" role="tablist">
      ${SECTIONS.map((s) => `<button type="button" class="ct-tab" data-section="${s.id}" role="tab">${escapeHtml(s.label)}</button>`).join('')}
    </nav>
    <div id="fa-section" class="ct-section-host"></div>`;

  const host = container.querySelector('#fa-section');
  const tabs = Array.from(container.querySelectorAll('.ct-tab'));
  const abrir = (id) => {
    tabs.forEach((b) => b.classList.toggle('is-active', b.dataset.section === id));
    const section = SECTIONS.find((s) => s.id === id);
    host.innerHTML = '<div class="ct-state"><span class="ct-spinner"></span><p>Cargando...</p></div>';
    Promise.resolve(section.render(host, abrir)).catch((err) => {
      host.innerHTML = `<p class="ct-empty">Error: ${escapeHtml(toMessage(err))}</p>`;
    });
  };
  tabs.forEach((b) => b.addEventListener('click', () => abrir(b.dataset.section)));
  abrir(SECTIONS[0].id);
}
