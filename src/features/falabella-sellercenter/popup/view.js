// Menu del apartado "Falabella SellerCenter" (mismo patron que Magento: lista de
// modulos → modulo con boton para volver).

import { toMessage } from '../../../shared/errors/index.js';
import { escapeHtml } from '../../../shared/ui/format.js';
import * as paquetes from './sections/paquetes.js';
import * as credenciales from './sections/credenciales.js';

const MODULES = [
  {
    id: 'paquetes',
    name: 'Identificar paquetes en ordenes',
    description: 'Ordenes con 2+ productos que Falabella junto en un solo paquete',
    abbr: 'PKG',
    render: paquetes.render,
  },
  {
    id: 'credenciales',
    name: 'Credenciales de la API',
    description: 'UserID y API Key del usuario integrador de SellerCenter',
    abbr: 'KEY',
    render: credenciales.render,
  },
];

export function render(container) {
  renderMenu(container);
}

function renderMenu(container) {
  container.innerHTML = `
    <div class="mg-view">
      <p class="features-label">Herramientas Falabella SellerCenter</p>
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
      <button type="button" id="fsc-module-back" class="ct-btn ct-btn--ghost">Volver a Falabella SellerCenter</button>
    </div>
    <div id="fsc-module-host" class="ct-section-host"></div>`;
  container.querySelector('#fsc-module-back').addEventListener('click', () => renderMenu(container));
  const host = container.querySelector('#fsc-module-host');
  const irA = (otro) => renderModule(container, otro);
  Promise.resolve(module.render(host, { irA })).catch((err) => {
    host.innerHTML = `<div class="ct-state ct-state--error"><p>${escapeHtml(toMessage(err))}</p></div>`;
  });
}
