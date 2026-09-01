// Modulo "Buscar orden" del apartado Magento.
//
// Recorre el listado de ordenes (con el rango de fechas que pide el usuario),
// entra a cada orden, decodifica las notas de transaccion (Webpay/Transbank y
// MercadoPago) y marca las que coinciden con los datos buscados. Todo lo que
// captura queda disponible como CSV aunque el proceso se detenga a medias.

export const MODULE_ID = 'buscar-orden';

export const STORAGE_KEYS = {
  RUN:   `magento:${MODULE_ID}:run`,
  DRAFT: `magento:${MODULE_ID}:draft`,
};

export const PAGE_TYPE = {
  LISTING:    'listing',
  ORDER_VIEW: 'order-view',
  OTHER:      'other',
};

export const ORDER_STATUS = {
  PENDING: 'pending',
  READING: 'reading',
  OK:      'ok',
  ERROR:   'error',
};

export const RUN_PHASE = {
  STARTING:    'starting',
  FILTERING:   'filtering',
  DISCOVERING: 'discovering',
  READING:     'reading',
  DONE:        'done',
};

export const FINISH_REASON = {
  DONE:        'done',
  CANCELLED:   'cancelled',
  ERROR:       'error',
  LIMIT:       'limit',
  FIRST_MATCH: 'first-match',
};

export const GATEWAY = {
  WEBPAY:      'webpay',
  MERCADOPAGO: 'mercadopago',
  UNKNOWN:     'unknown',
};

export const GATEWAY_LABEL = {
  [GATEWAY.WEBPAY]:      'WebPay / Transbank',
  [GATEWAY.MERCADOPAGO]: 'MercadoPago',
  [GATEWAY.UNKNOWN]:     'Sin pasarela',
};

// Campos buscables por pasarela. `noteKeys` son las etiquetas tal como Magento
// las escribe en la nota; se comparan normalizadas (sin acentos ni mayusculas),
// asi que basta con una variante por concepto. `numeric` compara solo digitos:
// el monto puede venir "341990" en la nota y "$341.990" tecleado por el usuario.
export const SEARCH_FIELDS = {
  [GATEWAY.WEBPAY]: [
    { key: 'authCode',     label: 'Codigo de autorizacion', noteKeys: ['codigo de autorizacion'], placeholder: '002187' },
    { key: 'responseCode', label: 'Codigo de respuesta',    noteKeys: ['codigo de respuesta'],    placeholder: '0' },
    { key: 'status',       label: 'Estado',                 noteKeys: ['estado'],                 placeholder: 'AUTHORIZED' },
    { key: 'vci',          label: 'VCI',                    noteKeys: ['vci'],                    placeholder: 'TSY' },
    { key: 'amount',       label: 'Monto',                  noteKeys: ['monto'],                  placeholder: '341990', numeric: true },
    { key: 'paymentType',  label: 'Tipo de pago',           noteKeys: ['tipo de pago'],           placeholder: 'VD' },
    { key: 'installments', label: 'Cuotas',                 noteKeys: ['cuotas'],                 placeholder: '0' },
    { key: 'sessionId',    label: 'ID de sesion',           noteKeys: ['id de sesion'],           placeholder: '1296933667', numeric: true },
    { key: 'buyOrder',     label: 'Orden de compra',        noteKeys: ['orden de compra'],        placeholder: '123001395247', numeric: true },
    { key: 'cardNumber',   label: 'Numero de tarjeta',      noteKeys: ['numero de tarjeta'],      placeholder: '0018' },
    { key: 'txDate',       label: 'Fecha de transaccion',   noteKeys: ['fecha de transaccion'],   placeholder: '26-07-2026' },
  ],
  [GATEWAY.MERCADOPAGO]: [
    { key: 'paymentId',    label: 'Numero de pago',     noteKeys: ['numero de pago', 'payment_id'],       placeholder: '169680708947', numeric: true },
    { key: 'status',       label: 'Estado',             noteKeys: ['estado', 'status'],                   placeholder: 'approved' },
    { key: 'statusDetail', label: 'Detalle del estado', noteKeys: ['detalle del estado', 'status_detail'], placeholder: 'accredited' },
  ],
};

// El grid de ordenes falla si el rango de Purchase Date supera el mes. Magento
// dice 1 mes; usamos 28 dias de tope para no quedar al borde.
export const MAX_RANGE_DAYS = 28;
export const DEFAULT_RANGE_DAYS = 7;

// Purchase Point que debe quedar seleccionado para que el grid filtre.
export const STORE_VIEW_LABEL = 'Chile Default Store View';
export const PURCHASE_POINT_LABEL = 'Purchase Point';

export const DEFAULT_ADMIN_BASE = 'https://shop.lg.com/obsadm';
export const ADMIN_BASE_RE = /^(https?:\/\/[^/]+\/[^/]*obsadm)\//i;
export const ORDERS_LISTING_PATH = '/sales/order/index/';
export const LISTING_URL_RE = /\/sales\/order\/(?:index|grid)?(?:[/?#]|$)/i;
export const ORDER_VIEW_URL_RE = /\/sales\/order\/view\/order_id\/(\d+)/i;

// Tope de rebotes detalle -> listado sin poder casar la orden que se estaba
// leyendo. Sin el, un desajuste deja al proceso navegando en circulo.
export const MAX_DETAIL_REDIRECTS = 5;

// Columnas del listado que se guardan por orden. El grid trae mas de 100 y
// copiarlas todas por cada orden infla el storage sin aportar nada.
export const LISTING_COLUMNS = [
  'ID',
  'Purchase Date',
  'Status',
  'Bill-to Name',
  'Customer Email',
  'Grand Total (Base)',
  'Payment Method',
];

export const PAGE_SIZE = 200;

export const SELECTORS = {
  // --- listado ---
  pageTitle:         'h1.page-title',
  gridWrap:          '.admin__data-grid-wrap, .admin__data-grid-outer-wrap',
  gridTable:         'table.data-grid[data-role="grid"]',
  // El grid de ordenes marca sus filas con la clase data-row; otras pantallas
  // del admin usan el atributo data-role. Aceptar las dos evita el caso peor:
  // quedarse con cero filas y dar el rango por vacio.
  gridRow:           'tbody tr.data-row, tbody tr[data-role="row"]',
  viewLink:          'a[href*="/sales/order/view/"]',
  loadingMask:       '.admin__data-grid-loading-mask, #loading-mask, .loading-mask',
  filtersToggle:     'button[data-action="grid-filter-expand"]',
  filtersWrapActive: '.admin__data-grid-filters-wrap._show',
  filterApply:       'button[data-action="grid-filter-apply"]',
  filterReset:       'button[data-action="grid-filter-reset"]',
  filtersCurrent:    '.admin__data-grid-filters-current._show',
  dateFrom:          'input[name="created_at[from]"]',
  dateTo:            'input[name="created_at[to]"]',
  storeCrumb:        '.admin__action-multiselect-crumb',
  formFieldLabel:    '.admin__form-field-label span, .admin__form-field-legend span',
  multiselectWrap:   '.admin__action-multiselect-wrap',
  multiselectToggle: '.admin__action-multiselect',
  multiselectMenu:   '.action-menu',
  multiselectItem:   '.action-menu-item',
  multiselectLabel:  '.admin__action-multiselect-label span',
  multiselectDone:   'button[data-action="close-advanced-select"]',
  pagerNext:         '.admin__data-grid-pager .action-next',
  pagerPrevious:     '.admin__data-grid-pager .action-previous',
  pagerCurrent:      '.admin__data-grid-pager input[data-ui-id="current-page-input"]',
  pageSizeInput:     'input[id$="listing_paging_sizes"]',
  pageSizeOption:    '.selectmenu-item-action',

  // --- detalle de la orden ---
  orderInfoTable: '.order-information-table',
  orderStatus:    '#order_status',
  orderTitle:     '.order-information .title',
  noteItem:       'li.note-list-item',
  noteDate:       '.note-list-date',
  noteTime:       '.note-list-time',
  noteStatus:     '.note-list-status',
  noteComment:    '.note-list-comment',
};

export const TEXTS = {
  PAGE_TITLE_LISTING: 'Orders',
};

export const LOG_CAP = 400;
