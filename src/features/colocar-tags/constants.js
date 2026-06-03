export const FEATURE_ID = 'colocar-tags';

export const MESSAGES = {
  GET_PAGE_DATA: 'colocar-tags:get-page-data',
};

// Tipos de run (kind). El popup escribe un run con uno de estos kinds en
// chrome.storage.local; el content script lo recoge y ejecuta el flujo
// correspondiente. Reemplaza a los antiguos PORTS (la comunicación ahora es
// storage-driven para que el proceso NO se detenga al cerrar el popup).
export const RUN_KIND = {
  DELIVERY:        'delivery',
  DELIVERY_REMOVE: 'delivery-remove',
  PRODUCT:         'product',
  OFFER:           'offer',
};

// Claves de chrome.storage.local.
export const STORAGE_KEYS = {
  RUN:         `${FEATURE_ID}:run`,            // estado de ejecución (cross-context)
  // Borradores de formulario por sección (autosave as-you-type).
  DRAFT: {
    [RUN_KIND.DELIVERY]:        `${FEATURE_ID}:delivery:last-config`,
    [RUN_KIND.DELIVERY_REMOVE]: `${FEATURE_ID}:delivery-remove:last-config`,
    [RUN_KIND.PRODUCT]:         `${FEATURE_ID}:product:last-config`,
    [RUN_KIND.OFFER]:           `${FEATURE_ID}:offer:last-config`,
  },
};

// Tope de líneas de log retenidas en el run (igual que lead-times/cupones).
export const LOG_CAP = 400;

// Compat: puertos long-lived (ya no se usan para los flujos, conservados por
// si algún consumidor externo los referencia). La comunicación de flujos es
// storage-driven (ver RUN_KIND / STORAGE_KEYS).
export const PORTS = {
  DELIVERY_RUN:        'colocar-tags:delivery-run',
  DELIVERY_REMOVE_RUN: 'colocar-tags:delivery-remove-run',
  PRODUCT_RUN:         'colocar-tags:product-run',
  OFFER_RUN:           'colocar-tags:offer-run',
};

// Tipos de mensaje que viajan por el puerto DELIVERY_RUN.
export const PORT_MSG = {
  START:     'start',
  PROGRESS:  'progress',
  DONE:      'done',
  CANCEL:    'cancel',
  CANCELLED: 'cancelled',
  ERROR:     'error',
};

// Etiquetas de pasos para reportar progreso al popup. El popup las pinta tal cual.
export const STEPS = {
  SEARCH_TYPE:        'type-sku',
  SEARCH_CLICK:       'click-search',
  SEARCH_WAIT_ROW:    'wait-row',
  SEARCH_CLICK_EDIT:  'click-edit',
  MODAL_WAIT_OPEN:    'wait-modal',
  DELIV_CHECK_ROW:    'check-delivery-row',
  DELIV_SELECT_TAG:   'select-tag',
  DELIV_CHECK_USE:    'check-use',
  DELIV_USER_TYPE:    'set-user-type',
  DELIV_DATES:        'set-dates',
  DELIV_SAVE_STG:     'save-stg',
  DELIV_CONFIRM_STG:  'confirm-stg',
  DELIV_ACK_STG:      'ack-stg',
  DELIV_SAVE_PROD:    'save-prod',
  DELIV_CONFIRM_PROD: 'confirm-prod',
  DELIV_ACK_PROD:     'ack-prod',

  // Quitar Tag de Delivery — desmarca Use + marca row chk + save.
  DELREM_CHECK_ROW:    'delrem-check-row',
  DELREM_UNCHECK_USE:  'delrem-uncheck-use',
  DELREM_SAVE_STG:     'delrem-save-stg',
  DELREM_CONFIRM_STG:  'delrem-confirm-stg',
  DELREM_ACK_STG:      'delrem-ack-stg',
  DELREM_SAVE_PROD:    'delrem-save-prod',
  DELREM_CONFIRM_PROD: 'delrem-confirm-prod',
  DELREM_ACK_PROD:     'delrem-ack-prod',

  // Product Tag — pasos por cada uno de los hasta 2 tags por SKU. `detail.tagIndex`
  // (1 o 2) acompaña a cada uno de los progress, para que el popup pueda mostrar
  // en qué row está trabajando.
  PROD_CHECK_ROW:     'pt-check-row',
  PROD_CATEGORY:      'pt-category',
  PROD_GROUP:         'pt-group',
  PROD_TAG_VALUE:     'pt-tag-value',
  PROD_TYPE:          'pt-type',
  PROD_USE:           'pt-use',
  PROD_USER_TYPE:     'pt-user-type',
  PROD_DATES:         'pt-dates',
  PROD_TAG_DONE:      'pt-tag-done',
  PROD_SAVE_STG:      'pt-save-stg',
  PROD_CONFIRM_STG:   'pt-confirm-stg',
  PROD_ACK_STG:       'pt-ack-stg',
  PROD_SAVE_PROD:     'pt-save-prod',
  PROD_CONFIRM_PROD:  'pt-confirm-prod',
  PROD_ACK_PROD:      'pt-ack-prod',

  // Offer Tag — pasos por cada una de las hasta 4 ofertas por SKU.
  // `detail.offerIndex` (1..4) y `detail.offerLabel` acompañan a cada progress
  // para que el popup pueda mostrar en qué oferta está trabajando.
  OFF_CHECK_ROW:      'off-check-row',
  OFF_USE:            'off-use',
  OFF_DESC:           'off-desc',
  OFF_DATES:          'off-dates',
  OFF_ROW_DONE:       'off-row-done',
  OFF_SAVE_STG:       'off-save-stg',
  OFF_CONFIRM_STG:    'off-confirm-stg',
  OFF_ACK_STG:        'off-ack-stg',
  OFF_SAVE_PROD:      'off-save-prod',
  OFF_CONFIRM_PROD:   'off-confirm-prod',
  OFF_ACK_PROD:       'off-ack-prod',

  DONE:               'done',
};

// Estado por SKU que el popup recibe en cada progress.
export const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  OK:      'ok',
  ERROR:   'error',
  SKIPPED: 'skipped',
};

export const SELECTORS = {
  // Pantalla MIM
  searchForm:  '#aform',
  searchPanel: '#LblockSearch',
  tabView:     '#tabView',
  gridStg:     '#divGrid_stg',
  gridProd:    '#divGrid_prod',
  siteRadios:  '#typeCode input[type="radio"]',
  tabNav:      '#tabView ul.L-nav',
  countSelect: '#mSelectCount',
  countStg:    '#mStgListCount',
  countProd:   '#mProdListCount',

  // Búsqueda
  // Atención: `#productId` es el WRAPPER L-textbox; el input real es input[name="productId"].
  productIdInput:  'input[name="productId"]',
  searchButton:    '#btnSearch-button',

  // Grid (las clases que pinta L-grid son nombres "internos" del data-model:
  // salesModel -> salesModelName, productId -> sku, etc.)
  gridRow:         'tbody tr.L-grid-row',
  gridCellSalesModel: '.L-grid-col-salesModelName',
  gridCellEdit:    'button.L-grid-button',

  // Modal de Marketing Info
  modal:           '#dialog2',

  // Fila "Delivery" dentro del modal
  deliveryRowChk:    '#deliveryTagChk',
  deliveryTagInput:  '#deliveryTag',
  deliveryComboBtn:  '#cb2-button',
  deliveryListbox:   '#cb2-listbox',
  deliveryUseFlag:   '#deliveryTagUseFlag',
  // El <select> visible (NO el hidden con mismo id; el visible va segundo en el DOM).
  deliveryUserType:  'select#deliveryTagUserType',
  deliveryBeginDay:  '#deliveryTagBeginDay',
  deliveryBeginTime: '#deliveryTagBeginTime',
  deliveryEndDay:    '#deliveryTagEndDay',
  deliveryEndTime:   '#deliveryTagEndTime',

  // Save buttons (en el footer del modal)
  saveStg:           'button[onclick="formSubmit()"]',
  saveProd:          'button[onclick="formSubmitProd()"]',

  // Messagebox L-* (puede haber varios apilados, tomamos el de mayor z-index)
  messagebox:        '.L-overlay.messagebox',
  messageboxButton:  '.ft .L-button button',
  messageboxBody:    '.bd',
};

/**
 * Selectores parametrizados por número de fila de Product Tag (1 o 2). Los
 * tenemos aparte de `SELECTORS` porque son funciones, y eso rompe utilidades
 * que asumen strings (ej. `debug.check()`). Los listboxes de los combos
 * comparten IDs entre filas (`cb1-listbox`/`cb2-listbox`) por lo que el driver
 * los resuelve por estructura DOM (`input.closest('.combobox')`); los inputs
 * sí son únicos por id, igual que el resto.
 *
 * Los tags y groups disponibles vienen del backend de GP1 y son **dinámicos**:
 * no se pueden hardcodear ni validar contra una lista cerrada. El driver
 * intenta match exacto + case-insensitive y lanza error con muestra si la
 * opción no existe en el listbox.
 */
export const PRODUCT_TAG_SELECTORS = {
  chk:          (i) => `#productTag${i}Chk`,
  categorySel:  (i) => `#productTagCategory${i}`,
  groupInput:   (i) => `#productTagGroup${i}`,
  valueInput:   (i) => `#productTag${i}`,
  typeSel:      (i) => `#productTag${i}Type`,
  useFlag:      (i) => `#productTag${i}UseFlag`,
  // El id `#productTag<N>UserType` está duplicado en un hidden + el select
  // visible que sí queremos. El visible es `select#useType<N>`.
  userType:     (i) => `select#useType${i}`,
  beginDay:     (i) => `#productTag${i}BeginDay`,
  beginTime:    (i) => `#productTag${i}BeginTime`,
  endDay:       (i) => `#productTag${i}EndDay`,
  endTime:      (i) => `#productTag${i}EndTime`,
};

/** Opciones canónicas del select Type. Las del front pueden cambiar; reportamos error si no matchean. */
export const PRODUCT_TAG_TYPES = ['gradient', 'solid', 'line'];
export const PRODUCT_TAG_CATEGORIES = ['Product', 'Promotion'];

/** Máximo de tags por SKU según el sistema GP1. */
export const PRODUCT_TAG_MAX = 2;

export const MODEL_STATUS = {
  ACTIVE:       'ACTIVE',
  INACTIVE:     'INACTIVE',
  DISCONTINUED: 'DISCONTINUED',
};

// Texto esperado en messageboxes — se usa para distinguir confirm vs success.
export const MSGBOX_TEXTS = {
  CONFIRM_SAVE:  'all selected rows of information',
  SUCCESS_STG:   'successfully saved to STG',
  SUCCESS_PROD:  'successfully saved to PROD',
};

export const DELIVERY_DEFAULTS = {
  tagLabel: 'Despacho Gratis RM',
  userType: 'ALL',
  skipProd: true,
};

/**
 * Tabla "Additional Disclaimer Text" (Tag de Oferta) dentro del modal MIM.
 * Son 4 filas fijas, una por tipo de oferta, en orden por índice (1..4):
 *   1 = Gift, 2 = Discount, 3 = Coupon, 4 = Truck.
 * La columna "Icon" sólo muestra el ícono + nombre (read-only) — el índice
 * determina el tipo, no hay que parsear el texto.
 *
 * Cada fila N tiene:
 *   - `${prefix}${N}Chk`        checkbox de selección de fila (el "row chk").
 *                               Marcarlo es lo que GP1 usa para detectar que
 *                               la fila cambió e incluirla en el save.
 *   - `${prefix}${N}Flag`       checkbox "Use" (activa/desactiva la oferta).
 *   - `${prefix}${N}Msg`        input de texto "Description".
 *   - `${prefix}${N}StartDate`  input fecha (YYYY-MM-DD, SIN hora).
 *   - `${prefix}${N}EndDate`    input fecha (YYYY-MM-DD, SIN hora).
 */
const OFFER_PREFIX = 'obsAdditionalDisclaimerText';

export const OFFER_SELECTORS = {
  rowChk:    (i) => `#${OFFER_PREFIX}${i}Chk`,
  useFlag:   (i) => `#${OFFER_PREFIX}${i}Flag`,
  msg:       (i) => `#${OFFER_PREFIX}${i}Msg`,
  startDate: (i) => `#${OFFER_PREFIX}${i}StartDate`,
  endDate:   (i) => `#${OFFER_PREFIX}${i}EndDate`,
};

/** Los 4 tipos de oferta, fijos por índice de fila. */
export const OFFER_TYPES = [
  { index: 1, key: 'gift',     label: 'Gift',     icon: '🎁' },
  { index: 2, key: 'discount', label: 'Discount', icon: '％' },
  { index: 3, key: 'coupon',   label: 'Coupon',   icon: '🎟️' },
  { index: 4, key: 'truck',    label: 'Truck',    icon: '🚚' },
];

/** Máximo de ofertas por SKU (la tabla tiene 4 filas fijas). */
export const OFFER_MAX = 4;

export const OFFER_DEFAULTS = {
  skipProd: true,
};
