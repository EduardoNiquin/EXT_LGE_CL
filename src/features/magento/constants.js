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

export const DEFAULT_LISTING_URL = 'https://shop.lg.com/obsadm/global_shippingrule/management/index';
export const LISTING_URL_RE = /\/global_shippingrule\/management\/(?:index)?(?:[/?#]|$)/i;
export const DETAIL_URL_RE = /\/global_shippingrule\/(?:management\/)?edit\/(?:id|entity_id)\/(\d+)/i;

export const SELECTORS = {
  pageTitle: 'h1.page-title',
  listingTable: 'table.data-grid[data-role="grid"]',
  listingRow: 'tbody tr.data-row',
  listingEditLink: 'a[data-action="item-edit"], .data-grid-actions-cell a, td:last-child a',
  listingLoadingMask: '.admin__data-grid-loading-mask',
  listingPageSizeInputId: 'shipping_rule_management_listing.shipping_rule_management_listing.listing_top.listing_paging_sizes',
  pagerNext: '.admin__data-grid-pager .action-next',
  pagerPrevious: '.admin__data-grid-pager .action-previous',
  pagerCurrent: '.admin__data-grid-pager input[data-ui-id="current-page-input"]',
  detailReady: '[data-index="shippingrule_info"]',
  regionalRoot: '[data-index="regional_delivery"]',
};

export const DETAIL_SECTION_SELECTORS = [
  '[data-index="website"]',
  '[data-index="shippingrule_info"]',
  '[data-index="product_segment"]',
  '[data-index="setup_carrier_service"]',
];

export const LOG_CAP = 400;
