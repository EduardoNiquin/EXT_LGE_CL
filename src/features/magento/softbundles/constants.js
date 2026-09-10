// Modulo "Crear Softbundles" del apartado Magento.
//
// Crea package rules (soft bundles) en lote. Por cada linea de la entrada:
// listado -> Add New Package -> formulario del padre -> Save and Continue ->
// pantalla de edicion -> un "Add New Offer" por producto hijo -> Save.
//
// El unico boton destructivo de estas pantallas es "Delete" (y "Delete" de cada
// oferta): NO se toca nunca. Los unicos clics de guardado son "Save and
// Continue Edit", el "Save" del modal de oferta y el "Save" de la pagina.

export const MODULE_ID = 'softbundles';

export const STORAGE_KEYS = {
  RUN:   `magento:${MODULE_ID}:run`,
  DRAFT: `magento:${MODULE_ID}:draft`,
};

export const PAGE_TYPE = {
  LISTING: 'listing',
  NEW:     'new',
  EDIT:    'edit',
  OTHER:   'other',
};

/** Estado de un bundle (una linea de la entrada). */
export const BUNDLE_STATUS = {
  PENDING:  'pending',   // en la cola
  CREATING: 'creating',  // formulario del padre / pantalla de edicion
  SAVING:   'saving',    // se pulso el Save final, se espera la vuelta al listado
  OK:       'ok',
  PARTIAL:  'partial',   // el padre quedo creado pero algun hijo fallo
  SKIPPED:  'skipped',   // ya existia un package rule para ese SKU
  SIMULATED: 'simulated', // modo simulacion: se lleno el formulario sin guardar
  ERROR:    'error',
};

export const BUNDLE_STATUS_LABEL = {
  pending:   'En cola',
  creating:  'Creando...',
  saving:    'Guardando...',
  ok:        'Creado',
  partial:   'Creado con errores',
  skipped:   'Omitido (ya existia)',
  simulated: 'Simulado (no se guardo)',
  error:     'Error',
};

/** Estado de un producto hijo dentro de un bundle. */
export const CHILD_STATUS = {
  PENDING: 'pending',
  OK:      'ok',
  ERROR:   'error',
};

export const RUN_PHASE = {
  STARTING: 'starting',
  CHECKING: 'checking',  // revisando cuales SKU padre ya tienen package rule
  CREATING: 'creating',
  DONE:     'done',
};

export const FINISH_REASON = {
  DONE:      'done',
  CANCELLED: 'cancelled',
  ERROR:     'error',
};

export const SKIP_REASON = {
  ALREADY_EXISTS: 'already-exists',
};

export const DEFAULT_ADMIN_BASE = 'https://shop.lg.com/obsadm';
export const ADMIN_BASE_RE = /^(https?:\/\/[^/]+\/[^/]*obsadm)\//i;

export const LISTING_PATH = '/packagerule/package/index/';
export const LISTING_URL_RE = /\/packagerule\/package\/index(?:[/?#]|$)/i;
export const NEW_URL_RE = /\/packagerule\/package\/new(?:[/?#]|$)/i;
export const EDIT_URL_RE = /\/packagerule\/package\/edit\/package_id\/(\d+)/i;

// Website y store view con los que se trabaja. El listado obliga a elegir un
// website antes de poder crear (el boton "Add New Package" arma la URL con el
// id del website), y el formulario pide el store view en "Apply To".
export const WEBSITE_LABEL = 'Chile Website';
export const STORE_VIEW_LABEL = 'Chile Default Store View';

// Tope de rebotes entre pantallas sin poder casar el bundle que se estaba
// creando. Sin el, un desajuste deja al proceso navegando en circulo.
export const MAX_REDIRECTS = 5;

export const LOG_CAP = 400;

// Prefijo que Magento antepone a los SKU del catalogo chileno. El usuario pega
// el SKU tal como lo tiene en la planilla ("86MRGB95BSA.AWH") y la opcion del
// buscador viene como "CL.86MRGB95BSA.AWH": la comparacion ignora el prefijo.
export const SKU_PREFIX = 'CL.';

export const TIMEOUTS = {
  PAGE:          25000,  // montaje de una pantalla del admin
  SKU_SEARCH:    15000,  // busqueda AJAX del multiselect de productos
  SKU_SETTLE:     1200,  // margen para decidir que el buscador no trajo nada
  MODAL:         20000,  // apertura / cierre del modal de oferta
  PRICE_TABLE:   20000,  // tabla de precios por grupo tras elegir el SKU hijo
  SAVE:          25000,  // guardado AJAX de una oferta
  GRID:          20000,
};

export const SELECTORS = {
  // --- comun ---
  pageTitle:      'h1.page-title',
  messagesArea:   '#messages, .messages',
  messageSuccess: '.message-success, [data-ui-id*="message-success"]',
  messageError:   '.message-error, [data-ui-id*="message-error"]',
  messageText:    '[data-ui-id$="message-text"], .message-text',
  loadingMask:    '.admin__data-grid-loading-mask, #loading-mask, .loading-mask, .admin__form-loading-mask',

  // --- listado ---
  websiteButton:    '#store-change-button',
  websiteLink:      'ul[data-role="stores-list"] a[data-role="website-id"]',
  addButton:        '#add, [data-ui-id="add-button"]',
  gridWrap:         '.admin__data-grid-wrap, .admin__data-grid-outer-wrap',
  gridTable:        'table.data-grid[data-role="grid"]',
  gridRow:          'tbody tr.data-row',
  gridCell:         '.data-grid-cell-content',
  filtersToggle:    'button[data-action="grid-filter-expand"]',
  filtersWrapOpen:  '.admin__data-grid-filters-wrap._show',
  filterApply:      'button[data-action="grid-filter-apply"]',
  filtersCurrent:   '.admin__data-grid-filters-current._show',
  filterClearAll:   '.admin__current-filters-actions-wrap button.action-clear',
  filterProductSku: '.admin__data-grid-filters input[name="product_sku"]',

  // --- modal de confirmacion (cambio de website) ---
  confirmModal:  'aside.modal-popup.confirm._show, aside[data-role="modal"].confirm._show',
  confirmAccept: 'footer.modal-footer button.action-primary, footer.modal-footer button[data-role="action"]',

  // --- formulario del padre (pantallas new / edit) ---
  formArea:       '[data-index="general"], .admin__fieldset',
  fieldByIndex:   (index) => `[data-index="${index}"]`,
  storeSelect:    'select[name="store_id"]',
  saveAndContinue: '#save_and_continue',
  save:           '#save',
  datepickerPanel: '#ui-datepicker-div',

  // --- multiselect avanzado de productos (Main Product / Related Product SKU) ---
  advancedWrap:     '.admin__action-multiselect-wrap',
  advancedToggle:   '[data-role="advanced-select"]',
  advancedSelected: '[data-role="selected-option"]',
  advancedSearch:   '[data-role="advanced-select-text"]',
  advancedOption:   '.admin__action-multiselect-label',
  advancedOptionText: '.admin__action-multiselect-label span',
  advancedCount:    '.admin__action-multiselect-search-count',

  // --- ofertas (productos hijos) ---
  addOfferButton: '[data-index="general_item"] button[data-index="modal_button"], button[data-index="modal_button"]',
  offerModal:     'aside[data-role="modal"]._show',
  offerFieldset:  '[data-index="packageruleitem"]',
  offerSave:      '.page-actions-buttons button[data-role="action"]',
  priceRows:      'tbody[data-role="options-container"] tr',
  discountRate:   'input[name*="discount-rate"]',
  childGrid:      '[data-index="general_item"] table.data-grid, table.data-grid',
  childRow:       'tbody tr.data-row',
  childSkuCell:   'td.related_product_sku .data-grid-cell-content',
};

/** Campos del formulario del padre, por `data-index`. */
export const PARENT_FIELDS = {
  STORE:          'store_id',
  PRODUCT_SKU:    'product_sku',
  DESCRIPTIONS:   'descriptions',
  ACTIVE:         'is_active',
  COMBINABLE:     'combinable_coupon',
  FROM_DATE:      'from_date',
  FROM_TIME:      'from_time',
  TO_DATE:        'to_date',
  TO_TIME:        'to_time',
  MAX_RELATED:    'maximum_related_add_to_cart',
  OUT_OF_STOCK:   'is_show_out_of_stock',
};

/** Campos del modal de oferta, por `data-index`. */
export const OFFER_FIELDS = {
  ACTIVE:        'is_active',
  PRODUCT_SKU:   'product_sku',
  LIMITED_QTY:   'limited_qty',
  SHOW_TEXT:     'is_display_promotion_text',
  TEXT:          'promotion_text',
  SHOW_DESC:     'is_display_promotion_desc',
  DESC:          'promotion_desc',
  PRIORITY:      'priority',
  ZERO_PERCENT:  'is_display_discount_rate_zero_percent',
  SPLIT:         'is_split',
  MAIN_DISCOUNT: 'main_discount_rate',
};

export const TEXTS = {
  RULE_SAVED:  'The rule has been saved',
  OFFER_SAVED: 'The related product has been saved',
  ADD_PACKAGE: 'Add New Package',
  ADD_OFFER:   'Add New Offer',
  SAVE:        'Save',
};

/** Columna del listado que trae el SKU del producto principal. */
export const LISTING_MAIN_PRODUCT_COLUMN = 'Main Product';
export const LISTING_ID_COLUMN = 'ID';

/**
 * Configuracion por defecto del formulario del popup. Los valores replican lo
 * que se hace a mano hoy: bundle activo, sin mostrar productos sin stock, 5% de
 * descuento al hijo y 50% del descuento repartido al producto principal.
 */
export const DEFAULT_CONFIG = {
  // padre
  storeView:      STORE_VIEW_LABEL,
  descriptions:   '',
  active:         true,
  combinable:     false,
  fromDate:       '',   // el popup la completa con hoy
  fromTime:       '00:00',
  toDate:         '',
  toTime:         '23:59',
  maxRelated:     '',
  showOutOfStock: false,
  // hijo
  childActive:      true,
  discountRate:     '5',
  limitedQty:       '',
  priority:         '',
  showZeroPercent:  false,
  split:            true,
  mainDiscountRate: '50',
  promotionText:    '',
  promotionDesc:    '',
  // run
  skipExisting: true,
  dryRun:       true,
};
