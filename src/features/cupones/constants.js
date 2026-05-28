export const FEATURE_ID = 'cupones';

export const STORAGE_KEYS = {
  RUN:         `${FEATURE_ID}:run`,
  LAST_CONFIG: `${FEATURE_ID}:last-config`,
};

// Estado por item de la cola (cada item es un cupón a procesar).
export const ITEM_STATUS = {
  PENDING:   'pending',
  SEARCHING: 'searching',
  EDITING:   'editing',
  OK:        'ok',
  ERROR:     'error',
  NOT_FOUND: 'not-found',
};

// Identificación del tipo de página Magento.
export const PAGE_TYPE = {
  LISTING: 'listing',
  EDIT:    'edit',
  OTHER:   'other',
};

// Modo de búsqueda: por ID numérico o por nombre de Rule.
export const SEARCH_BY = {
  ID:   'id',
  RULE: 'rule',
};

// Texto del <h1> esperado en la pantalla listing.
export const TEXTS = {
  PAGE_TITLE_LISTING: 'Cart Price Rules',
};

// Regex para extraer el id de regla desde la URL de edición.
export const EDIT_URL_RE = /\/sales_rule\/promo_quote\/edit\/id\/(\d+)/i;

// Y para confirmar que la URL es de Cart Price Rules.
export const LISTING_URL_RE = /\/sales_rule\/promo_quote\/(index|grid)?/i;

export const SELECTORS = {
  // Listing
  pageTitle:           'h1.page-title',
  gridTable:           '#promo_quote_grid_table',
  filterRuleId:        '#promo_quote_grid_filter_rule_id',
  filterName:          '#promo_quote_grid_filter_name',
  filterCouponCode:    '#promo_quote_grid_filter_coupon_code',
  filterSearchButton:  'button[data-action="grid-filter-apply"]',
  filterResetButton:   'button[data-action="grid-filter-reset"]',
  gridRow:             '#promo_quote_grid_table tbody tr[data-role="row"]',
  rowEditLink:         'td[data-column="action"] a',
  rowRuleIdCell:       'td[data-column="rule_id"]',
  rowNameCell:         'td[data-column="name"]',
  loadingMask:         '#loading-mask, .loading-mask, .admin__data-grid-loading-mask',

  // Edit
  actionsBlock:        'div[data-index="actions"]',
  actionsTitle:        'div[data-index="actions"] > .fieldset-wrapper-title',
  ruleTree:            'div[data-index="actions"] .rule-tree',
  ruleConditionsRoot:  'div[data-index="actions"] .rule-tree ul.rule-param-children',
  ruleRemoveButton:    'div[data-index="actions"] .rule-tree a.rule-param-remove',
  saveButton:          '#save',
  backButton:          '#back',
};

export const LOG_CAP = 400;

// Defaults UI: por defecto buscamos por ID (lo más estable contra duplicados de
// nombre).
export const DEFAULTS = {
  searchBy: SEARCH_BY.ID,
};
