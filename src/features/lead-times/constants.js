export const FEATURE_ID = 'lead-times';

export const STORAGE_KEYS = {
  RUN:         `${FEATURE_ID}:run`,
  LAST_CONFIG: `${FEATURE_ID}:last-config`,
};

// Estado por comuna individual.
export const COMUNA_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  OK:      'ok',
  ERROR:   'error',
  SKIPPED: 'skipped',
};

// Estado por región (etapa dentro de la queue global).
export const REGION_STATUS = {
  PENDING:    'pending',
  COLLECTING: 'collecting',
  RUNNING:    'running',
  DONE:       'done',
  ERROR:      'error',
};

// Identificación del tipo de página Magento donde corre el content script.
export const PAGE_TYPE = {
  LISTING: 'listing',
  EDIT:    'edit',
  OTHER:   'other',
};

// Texto esperado en los <h1>.
export const TEXTS = {
  PAGE_TITLE_LISTING: 'Manage Address Level 2',
  PAGE_TITLE_EDIT:    'Edit Address Level 2',
};

// Regex para extraer el id de comuna desde la URL de edición.
export const EDIT_URL_RE = /\/regional_management\/level2\/edit\/id\/(\d+)/i;

export const SELECTORS = {
  // Listing
  pageTitle:           'h1.page-title',
  filtersButton:       'button[data-action="grid-filter-expand"]',
  filtersWrap:         '.admin__data-grid-filters-wrap',
  filterRegionInput:   'input[name="region_name"]',
  filterApply:         'button[data-action="grid-filter-apply"]',
  filterReset:         'button[data-action="grid-filter-reset"]',
  activeFiltersWrap:   '.admin__data-grid-filters-current',
  activeFiltersList:   '[data-role="filter-list"] li',
  gridRow:             'tbody tr.data-row',
  gridLoadingMask:     '.admin__data-grid-loading-mask',
  editLink:            '.data-grid-actions-cell a[data-action="item-edit"]',
  recordsFound:        '.admin__data-grid-header .admin__control-support-text',
  pagerInputCurrent:   'input[data-ui-id="current-page-input"]',
  pagerNextBtn:        '.admin__data-grid-pager .action-next',
  pagerPrevBtn:        '.admin__data-grid-pager .action-previous',
  pagerPagesLabel:     '.admin__data-grid-pager label[for]',

  // Edit
  deliveryCollapsible:      '[data-index="delivery"]',
  deliveryCollapsibleTitle: '[data-index="delivery"] .fieldset-wrapper-title',
  deliveryMinInput:         'input[name="delivery_leadtime_min"]',
  deliveryMaxInput:         'input[name="delivery_leadtime_max"]',
  saveButton:               '#save',
  backButton:               '#back',
};

// Cap del log persistido para no inflar el storage.
export const LOG_CAP = 400;

// Defaults UI.
export const DEFAULTS = {
  minDays: 6,
  maxDays: 15,
};
