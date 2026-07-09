export const FEATURE_ID = 'seller-center-falabella';

// La página de Soporte Seller es un sitio Salesforce (LWC, synthetic shadow DOM:
// los nodos viven en el light DOM, así que querySelector global funciona). El
// content script matchea <all_urls>; la detección se hace por DOM (no por host),
// porque la URL del sitio puede variar entre orgs/entornos.
export const STORAGE_KEYS = {
  RUN:   `${FEATURE_ID}:run`,
  DRAFT: `${FEATURE_ID}:draft`,
  // Flujo "Buscar número de órden en caso" (independiente de "Detalle Orden").
  SEARCH_RUN:   `${FEATURE_ID}:case-search:run`,
  SEARCH_DRAFT: `${FEATURE_ID}:case-search:draft`,
};

// Mensaje one-shot (lectura de pantalla para el popup / debug).
export const MESSAGES = {
  GET_PAGE_DATA: `${FEATURE_ID}:get-page-data`,
};

// Estado por item de la cola (cada item = un "Detalle Orden" a crear).
export const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  OK:      'ok',
  ERROR:   'error',
  SKIPPED: 'skipped',
};

// Sub-paso (para el detalle del progreso en vivo).
export const STEPS = {
  ENSURE_SECTION: 'ensure-section',
  EXPAND:         'expand',
  FILL:           'fill',
  DONE:           'done',
};

// Textos visibles en la UI de Salesforce (matching por texto, no por id dinámico
// — los ids `lgt-accordion-section-NNN` y los atributos `lwc-*` cambian por build).
export const TEXTS = {
  SECTION_TITLE: 'Detalle Orden',
  ADD_BUTTON:    '+',
  REMOVE_BUTTON: '-',
};

export const SELECTORS = {
  // Componente LWC que contiene el acordeón de "Detalle Orden".
  supportComponent: 'c-fc_lwc097_-support-center_-order-information',
  accordion:        '.seller-accordion',
  section:          'lightning-accordion-section',
  summaryContent:   '.slds-accordion__summary-content',
  summaryButton:    'button.slds-accordion__summary-action',
  content:          '.slds-accordion__content',
  // Inputs del formulario (los `name` son estables aunque los ids no).
  inputOrderNumber: 'input[name="ordernumber"]',
  inputGuia:        'input[name="nGuia"]',
  inputCantidad:    'input[name="cantP"]',
  // Botones "+" (agregar) y "-" (eliminar) renderizados por <lightning-button>.
  neutralButton:    'button.slds-button_neutral',
};

// Columnas del CSV, EN ORDEN. La primera fila del CSV son los encabezados.
export const COLUMNS = ['Número de orden', 'Nro Guia', 'Cantidad de Paquetes'];

export const LOG_CAP = 400;

// ---------------------------------------------------------------------------
// "Buscar número de órden en caso"
// ---------------------------------------------------------------------------
//
// El listado de casos es un acordeón paginado (5 casos por página). Cada caso
// tiene un botón "Detalles del caso" que abre un modal; ahí, en la tabla
// "Órdenes", está el número de orden asociado. El flujo entra a cada caso, lee
// la(s) orden(es), cierra el modal y — si aún faltan órdenes por encontrar —
// avanza de página, hasta hallar todas las órdenes buscadas o agotar las páginas.
//
// Los atributos `lwc-*` cambian por build, así que NO se usan como selectores.
export const SEARCH_SELECTORS = {
  accordionContainer: '.accordion-container',
  accordionCard:      '.accordion-card',
  accordionHeader:    '.accordion-header',
  caseNumberText:     '.case-number',
  detailsLink:        'button.details-link',

  modal:       'section.modal',
  modalTitle:  '.modal-title',
  modalClose:  '.close-button button, button[title="Cerrar"]',
  sectionTitle: '.section-title',
  boxContent:   '.boxes-content',
  orderCell:    '[data-cell-value]',
  formattedText: 'lightning-base-formatted-text',

  paginationControls: '.pagination-controls',
  pageNumber: '.page-number',
  pageActive: '.page-number.active',
  pageButton: 'button.btn-page',
};

// Título (texto visible) de la caja que contiene la tabla de órdenes en el modal.
export const ORDERS_SECTION_TITLE = 'Órdenes';

// Estado de cada orden buscada (para la UI del popup).
export const SEARCH_STATUS = {
  PENDING: 'pending',
  FOUND:   'found',
  MISSING: 'missing',
};

// Motivos de finalización del run de búsqueda.
export const SEARCH_FINISH = {
  ALL_FOUND:    'all-found',
  EXHAUSTED:    'exhausted',
  CANCELLED:    'cancelled',
  ERROR:        'error',
  NOT_DETECTED: 'not-detected',
};
