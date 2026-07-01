export const FEATURE_ID = 'pim';

// PIM (Marketing Info / Model Grid): la pantalla tiene el buscador por SKU
// (#productId + botón SEARCH) y una grilla de resultados TUI Grid con las
// pestañas STG/PROD. El content script matchea <all_urls>; la detección se hace
// por DOM (no por host), porque la URL puede variar entre entornos.
export const STORAGE_KEYS = {
  RUN:   `${FEATURE_ID}:run`,
  DRAFT: `${FEATURE_ID}:draft`,
};

// Mensaje one-shot (lectura de pantalla para el popup / debug).
export const MESSAGES = {
  GET_PAGE_DATA: `${FEATURE_ID}:get-page-data`,
};

// Estado por item de la cola (cada item = un SKU a verificar).
export const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  OK:      'ok',      // se resolvió (existe o no; ver item.found)
  ERROR:   'error',
};

// Sub-paso (para el detalle del progreso en vivo).
export const STEPS = {
  SELECT_STG:  'select-stg',
  FILL_SKU:    'fill-sku',
  SEARCH:      'search',
  READ_RESULT: 'read-result',
  DONE:        'done',
};

// Resultado de existencia (lo que se copia/descarga).
export const EXISTS = {
  YES: 'YES',
  NO:  'NO',
};

export const SELECTORS = {
  // Buscador
  searchForm:  '.search-form.search-filter',
  productId:   '#productId',
  searchBtn:   '#search_sales_model_code',
  // Pestañas STG / PROD del grid
  gridTabs:    '#ModelGridTab',
  stgTab:      '#stg-tab',
  prodTab:     '#prod-tab',
  stgPane:     '#stg',
  // Grilla de resultados (TUI Grid) — área derecha (columnas de datos)
  gridRside:   '.tui-grid-rside-area',
  gridRow:     '.tui-grid-rside-area .tui-grid-body-area .tui-grid-table-container table tbody tr',
  cellContent: '.tui-grid-cell-content',
  // Capa de estado vacío ("No data.") / "Loading"
  stateLayer:  '.tui-grid-layer-state',
  stateText:   '.tui-grid-layer-state-content',
};

// Solo verificamos existencia en Staging (STG). No se toca PROD.
export const DEFAULTS = {
  searchTimeoutMs: 15000,
};

export const LOG_CAP = 400;
