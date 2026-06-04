export const FEATURE_ID = 'starkoms';

// Host de la SPA Starkoms. El content script matchea <all_urls>; cada flow/detector
// confirma este host antes de actuar.
export const HOST = 'app.starkoms.com';

export const STORAGE_KEYS = {
  RUN:         `${FEATURE_ID}:run`,
  LAST_CONFIG: `${FEATURE_ID}:last-config`,
};

// Mensaje one-shot (lectura de pantalla para el popup / debug).
export const MESSAGES = {
  GET_PAGE_DATA: `${FEATURE_ID}:get-page-data`,
};

// ---------------------------------------------------------------------------
// Rutas (hash routing de la SPA). Builders + regex de detección.
// ---------------------------------------------------------------------------
export const ROUTES = {
  orders:           () => '#/ordenes',
  orderDetail:      (n)   => `#/ordenes/${n}`,
  products:         () => '#/productos',
  inventoryList:    () => '#/inventario/stock/productos',
  inventoryProduct: (sku) => `#/inventario/stock/productos/${sku}`,
  inventoryStockEdit: (sku, bodegaId) => `#/inventario/stock/productos/${sku}/${bodegaId}`,
};

// El orden importa al detectar: las más específicas primero.
export const ROUTE_RE = {
  STOCK_EDIT:        /^#\/inventario\/stock\/productos\/([^/]+)\/(\d+)\/?$/i,
  INVENTORY_PRODUCT: /^#\/inventario\/stock\/productos\/([^/]+)\/?$/i,
  INVENTORY_LIST:    /^#\/inventario\/stock\/productos\/?$/i,
  PRODUCTS:          /^#\/productos\/?$/i,
  ORDER_DETAIL:      /^#\/ordenes\/(\d+)\/?$/i,
  ORDERS_LIST:       /^#\/ordenes\/?$/i,
};

export const PAGE_TYPE = {
  ORDERS_LIST:       'orders-list',
  ORDER_DETAIL:      'order-detail',
  PRODUCTS:          'products',
  INVENTORY_LIST:    'inventory-list',
  INVENTORY_PRODUCT: 'inventory-product',
  STOCK_EDIT:        'stock-edit',
  OTHER:             'other',
};

// Estado por item de la cola (cada item = una orden On Hold Fuera de Stock).
export const STATUS = {
  PENDING:   'pending',
  RUNNING:   'running',
  OK:        'ok',
  SKIPPED:   'skipped',     // ya tenía stock / nada que hacer en un producto
  NOT_FOUND: 'not-found',   // producto no existe en Starkoms (crear a mano)
  ERROR:     'error',
};

// Sub-paso (para el detalle del progreso en vivo).
export const STEPS = {
  OPEN_ORDER:    'open-order',
  READ_PRODUCTS: 'read-products',
  CHECK_STOCK:   'check-stock',
  VERIFY_EXISTS: 'verify-exists',
  NAV_INVENTORY: 'nav-inventory',
  EDIT_STOCK:    'edit-stock',
  BACK_TO_ORDER: 'back-to-order',
  CHANGE_STATE:  'change-state',
  DONE:          'done',
};

// Textos visibles en la UI de Starkoms (matching por texto, no por id dinámico).
export const TEXTS = {
  STATUS_FILTER_LABEL: 'Filtro por estado',
  STATE_ON_HOLD:       'On Hold',
  STATE_FUERA_STOCK:   'On Hold (Fuera de Stock)',
  TARGET_STATE:        'Ingresado',
  CHANGE_STATE_BTN:    'Cambiar estado',
  SAVE:                'Guardar',
  SEARCH:              'Buscar',
  TOAST_OK:            'Ok',
  ESTADO_PEDIDO_LABEL: 'Estado del pedido',
  BODEGA_TO_LABEL:     'Bodega TO',
  CANTIDAD_LABEL:      'Cantidad',
};

export const SELECTORS = {
  // Tablas (v-data-table)
  dataTable:        '.v-data-table__wrapper table',
  dataTableHeader:  '.v-data-table-header th',
  // Botón genérico Vuetify
  vBtnContent:      '.v-btn__content',
  // Botón SKU en el detalle de orden (lanza el toast de stock)
  skuButton:        'button.v-btn.primary--text',
  // Toast / snackbar
  toast:            '.v-snack__wrapper',
  toastTable:       '.v-snack__wrapper table',
  toastAction:      '.v-snack__action button',
  // Diálogo
  dialog:           '.v-dialog.v-dialog--active',
  dialogTitle:      '.v-dialog.v-dialog--active .v-card__title',
  dialogActions:    '.v-dialog.v-dialog--active .v-card__actions',
  // v-select
  selectRoot:       '.v-select',
  selectSlot:       '.v-input__slot[role="button"]',
  menuContent:      '.v-menu__content.menuable__content__active',
  listItem:         '.v-list-item',
  listItemTitle:    '.v-list-item__title',
  // Form Actualizar Stock
  numberInput:      'input[type="number"]',
  // FAB de guardar (persistir el pedido tras cambiar estado)
  fabSave:          'button.v-btn--fab',
  fabSaveIcon:      'i.mdi-content-save',
  // Links de Acciones (ojo) del inventario
  inventoryEyeLink: 'a[href^="#/inventario/stock/productos/"]',
};

export const DEFAULTS = {
  bodega:          'Bodega LG Store OBS',
  stockValue:      999999999,
  verifyExistence: true,   // chequear #/productos antes de tocar inventario
  dryRun:          false,  // simulación: navega/lee pero no guarda
  limit:           0,      // 0 = sin límite de órdenes
};

export const LOG_CAP = 400;
