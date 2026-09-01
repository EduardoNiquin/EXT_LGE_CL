export const FEATURE_ID = 'magento';

export const STORAGE_KEYS = {
  RUN: `${FEATURE_ID}:global-shipping-rules:run`,
};

export const PAGE_TYPE = {
  LISTING: 'listing',
  DETAIL: 'detail',
  OTHER: 'other',
};

export const RULE_STATUS = {
  PENDING: 'pending',
  READING: 'reading',
  OK: 'ok',
  ERROR: 'error',
};

export const RUN_PHASE = {
  STARTING: 'starting',
  DISCOVERING: 'discovering',
  READING: 'reading',
  DONE: 'done',
};

export const FINISH_REASON = {
  DONE: 'done',
  CANCELLED: 'cancelled',
  ERROR: 'error',
};

// El admin puede colgar de otra base segun el ambiente, asi que se deriva de la
// pestana activa (mismo criterio que orden-info) y esto queda como ultimo recurso.
export const DEFAULT_ADMIN_BASE = 'https://shop.lg.com/obsadm';
export const ADMIN_BASE_RE = /^(https?:\/\/[^/]+\/[^/]*obsadm)\//i;
export const LISTING_PATH = '/global_shippingrule/management/index';
export const DEFAULT_LISTING_URL = `${DEFAULT_ADMIN_BASE}${LISTING_PATH}`;
export const LISTING_URL_RE = /\/global_shippingrule\/management\/(?:index)?(?:[/?#]|$)/i;
export const DETAIL_URL_RE = /\/global_shippingrule\/(?:management\/)?edit\/(?:id|entity_id)\/(\d+)/i;

// Tope de rebotes listado -> detalle -> listado sin poder casar la rule que se
// estaba leyendo. Sin este tope, un desajuste entre el ID de la columna del
// listado y el entity_id de la URL deja al proceso navegando en circulo contra
// Magento indefinidamente.
export const MAX_DETAIL_REDIRECTS = 5;

export const SELECTORS = {
  pageTitle: 'h1.page-title',
  listingTable: 'table.data-grid[data-role="grid"]',
  listingRow: 'tbody tr.data-row',
  listingEditLink: 'a[data-action="item-edit"], .data-grid-actions-cell a, td:last-child a',
  listingLoadingMask: '.admin__data-grid-loading-mask',
  listingPageSizeInputId: 'shipping_rule_management_listing.shipping_rule_management_listing.listing_top.listing_paging_sizes',
  gridWrap: '.admin__data-grid-outer-wrap',
  pageSizeMenu: '.admin__data-grid-pager-wrap .selectmenu, .selectmenu',
  pageSizeToggle: '.selectmenu-toggle-action, .selectmenu-toggle',
  pageSizeOption: '.selectmenu-item-action',
  pagerNext: '.admin__data-grid-pager .action-next',
  pagerPrevious: '.admin__data-grid-pager .action-previous',
  pagerCurrent: '.admin__data-grid-pager input[data-ui-id="current-page-input"]',
  detailReady: '[data-index="shippingrule_info"]',
  regionalRoot: '[data-index="regional_delivery"]',
  collapsibleTitle: '.fieldset-wrapper-title[data-state-collapsible]',
};

// Cuantas filas se piden por pagina en cada grilla. Recorrer paginas cuesta una
// peticion + un re-render cada vez, asi que conviene traer todo de una.
export const LISTING_PAGE_SIZE = 200;
export const REGIONAL_PAGE_SIZE = 200;

// Puente con el mundo MAIN (content/bridge.js). Le pide a los UI components de
// Magento las tarifas regionales completas en vez de recorrer el paginador.
export const BRIDGE = {
  SOURCE: 'ext-lge-cl/magento-bridge',
  TIMEOUT_MS: 3000,
  OPS: {
    PROBE: 'probe',
    EXPAND_REGIONAL: 'expand-regional',
  },
};

export const DETAIL_SECTION_SELECTORS = [
  '[data-index="website"]',
  '[data-index="shippingrule_info"]',
  '[data-index="product_segment"]',
  '[data-index="setup_carrier_service"]',
];

export const LOG_CAP = 400;
