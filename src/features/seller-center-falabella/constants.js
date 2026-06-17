export const FEATURE_ID = 'seller-center-falabella';

// La página de Soporte Seller es un sitio Salesforce (LWC, synthetic shadow DOM:
// los nodos viven en el light DOM, así que querySelector global funciona). El
// content script matchea <all_urls>; la detección se hace por DOM (no por host),
// porque la URL del sitio puede variar entre orgs/entornos.
export const STORAGE_KEYS = {
  RUN:   `${FEATURE_ID}:run`,
  DRAFT: `${FEATURE_ID}:draft`,
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
