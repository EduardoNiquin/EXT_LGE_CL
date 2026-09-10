import { toMessage } from '../../../shared/errors/index.js';
import * as buscarOrden from '../buscar-orden/popup/section.js';
import * as globalShippingRules from './sections/global-shipping-rules.js';
import * as softbundles from '../softbundles/popup/section.js';
import { escapeHtml } from './utils.js';

const MODULES = [
  {
    id: 'buscar-orden',
    name: 'Buscar orden',
    description: 'Encontrar la orden a partir de los datos del pago',
    abbr: 'BO',
    render: buscarOrden.render,
  },
  {
    id: 'softbundles',
    name: 'Crear Softbundles',
    description: 'Crear package rules en lote desde una lista de SKU',
    abbr: 'SB',
    render: softbundles.render,
  },
  {
    id: 'global-shipping-rules',
    name: 'Global Shipping Rules',
    description: 'Capturar rules y tarifas regionales en un CSV',
    abbr: 'GSR',
    render: globalShippingRules.render,
  },
];

export function render(container) {
  renderMenu(container);
}

function renderMenu(container) {
  container.innerHTML = `
    <div class="mg-view">
      <p class="features-label">Herramientas Magento</p>
      <div class="mg-module-list">
        ${MODULES.map((module) => `
          <button type="button" class="mg-module-item" data-module="${module.id}">
            <span class="feature-badge">${module.abbr}</span>
            <span class="feature-info">
              <span class="feature-name">${module.name}</span>
              <span class="feature-desc">${module.description}</span>
            </span>
            <svg class="feature-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>`).join('')}
      </div>
    </div>`;

  container.querySelectorAll('[data-module]').forEach((button) => {
    button.addEventListener('click', () => renderModule(container, button.dataset.module));
  });
}

function renderModule(container, id) {
  const module = MODULES.find((candidate) => candidate.id === id);
  if (!module) return;
  container.innerHTML = `
    <div class="mg-module-header">
      <button type="button" id="mg-module-back" class="ct-btn ct-btn--ghost">Volver a Magento</button>
    </div>
    <div id="mg-module-host" class="ct-section-host"></div>`;
  container.querySelector('#mg-module-back').addEventListener('click', () => renderMenu(container));
  const host = container.querySelector('#mg-module-host');
  Promise.resolve(module.render(host)).catch((err) => {
    host.innerHTML = `<div class="ct-state ct-state--error"><p>${escapeHtml(toMessage(err))}</p></div>`;
  });
}
