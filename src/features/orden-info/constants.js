export const FEATURE_ID = 'orden-info';

export const STORAGE_KEYS = {
  SEARCH:     `${FEATURE_ID}:search`,     // estado de la búsqueda (navegación)
  LAST_QUERY: `${FEATURE_ID}:last-query`, // último número de orden buscado
};

// Estado de la búsqueda guardada en STORAGE_KEYS.SEARCH:
//   { active, orderNumber, status, startedAt, finishedAt, error? }
export const SEARCH_STATUS = {
  PENDING:   'pending',     // popup pidió buscar; aún no se aplicó en el grid
  FILTERING: 'filtering',   // aplicando filtros requeridos (fecha / purchase point)
  SEARCHING: 'searching',   // se aplicó el fulltext, esperando resultado
  OPENING:   'opening',     // fila encontrada, navegando a la orden
  DONE:      'done',        // ya estamos en la orden
  NOT_FOUND: 'not-found',
  ERROR:     'error',
};

// El grid de órdenes exige un rango de Purchase Date que no exceda 1 mes.
// Usamos 29 días hacia atrás desde hoy para quedar dentro del límite.
export const DATE_WINDOW_DAYS = 29;

// Purchase Point que debe quedar seleccionado para que la búsqueda funcione.
export const STORE_VIEW_LABEL = 'Chile Default Store View';

export const PAGE_TYPE = {
  ORDER_VIEW: 'order-view',
  LISTING:    'listing',
  OTHER:      'other',
};

// Mensaje one-shot popup → content para leer la orden de la pestaña activa.
export const MESSAGES = {
  GET_ORDER_DATA: `${FEATURE_ID}:get-order-data`, // → { ok, data?, reason?, diag? }
};

// URL del listado de órdenes (admin Magento). El path /obsadm/ se deriva en
// runtime de la pestaña activa cuando es posible; éste es el fallback.
export const DEFAULT_ADMIN_BASE = 'https://shop.lg.com/obsadm';
export const ORDERS_LISTING_PATH = '/sales/order/index/';

// Detección de tipo de página por URL.
export const ORDER_VIEW_URL_RE = /\/sales\/order\/view\/order_id\/(\d+)/i;
export const ORDERS_LISTING_URL_RE = /\/sales\/order\/(index|grid)?/i;

export const SELECTORS = {
  // --- Order view ---
  orderInfoTable:    '.order-information-table',
  accountInfoTable:  '.order-account-information-table',
  orderStatus:       '#order_status',
  orderTitle:        '.order-information .title',
  customSection:     '.custom-section',
  noteList:          'ul.note-list',
  noteItem:          'li.note-list-item',
  noteDate:          '.note-list-date',
  noteTime:          '.note-list-time',
  noteStatus:        '.note-list-status',
  noteComment:       '.note-list-comment',
  totalsSection:     '.order-totals',
  totalsTable:       '.order-subtotal-table',

  // --- Payment Information (order view) ---
  paymentMethod:     '.order-payment-method',
  paymentTitle:      '.order-payment-method-title',
  paymentTable:      '.order-payment-method-title .data-table, .order-payment-method .data-table',

  // --- Listing (grid de órdenes) ---
  pageTitle:         'h1.page-title',
  gridWrap:          '.admin__data-grid-wrap, .admin__data-grid-outer-wrap',
  searchInput:       '#fulltext',
  searchSubmit:      '.data-grid-search-control button[aria-label="Search"], .data-grid-search-control-wrap button[aria-label="Search"], .data-grid-search-control-wrap button.action-submit',
  filtersToggle:     'button[data-action="grid-filter-expand"]',
  filterApply:       'button[data-action="grid-filter-apply"]',
  filterReset:       'button[data-action="grid-filter-reset"]',
  dateFrom:          'input[name="created_at[from]"]',
  dateTo:            'input[name="created_at[to]"]',
  storeCrumb:        '.admin__action-multiselect-crumb',
  gridRow:           'tr.data-row, tr[data-role="row"]',
  rowCell:           'td.data-grid-cell',
  multicheckCell:    '.data-grid-multicheck-cell',
  actionsCell:       '.data-grid-actions-cell',
  loadingMask:       '.admin__data-grid-loading-mask, #loading-mask, .loading-mask',
};

export const TEXTS = {
  PAGE_TITLE_LISTING: 'Orders',
};

export const LOG_CAP = 200;

// -----------------------------------------------------------------------------
// Diccionarios de significados de transacciones (Transbank / MercadoPago).
// El usuario ve el motivo del rechazo directamente en la extensión.
// -----------------------------------------------------------------------------

// Pasarela detectada a partir del contenido del comentario de la nota.
export const GATEWAY = {
  TRANSBANK:   'transbank',
  MERCADOPAGO: 'mercadopago',
  UNKNOWN:     'unknown',
};

// Transbank Webpay — Código de respuesta (responseCode).
export const TRANSBANK_RESPONSE_CODES = {
  '0':  'Transacción aprobada',
  '-1': 'Rechazo — reintente (posible error en los datos ingresados)',
  '-2': 'Rechazo — la transacción debe reintentarse',
  '-3': 'Error en la transacción',
  '-4': 'Rechazo de la transacción por parte del emisor',
  '-5': 'Rechazo por error de tasa',
  '-6': 'Excede el cupo máximo mensual',
  '-7': 'Excede el límite diario por transacción',
  '-8': 'Rubro no autorizado',
};

// Transbank — VCI (resultado de la autenticación 3-D Secure).
export const TRANSBANK_VCI = {
  TSY: 'Autenticación exitosa',
  TSN: 'Autenticación fallida / no autenticada',
  TO:  'Tiempo máximo de autenticación excedido (timeout)',
  ABO: 'Autenticación abortada por el tarjetahabiente',
  U3:  'Error interno en la autenticación',
  NP:  'No participa de la autenticación (comercio o tarjeta)',
  '':  'Sin información de autenticación',
};

// Transbank — Tipo de pago (paymentTypeCode).
export const TRANSBANK_PAYMENT_TYPE = {
  VD: 'Venta Débito',
  VN: 'Venta Normal (crédito sin cuotas)',
  VC: 'Venta en cuotas (con interés)',
  SI: '3 cuotas sin interés',
  S2: '2 cuotas sin interés',
  NC: 'N cuotas sin interés',
  VP: 'Venta Prepago',
};

// Transbank — Estado de la transacción (status).
export const TRANSBANK_STATUS = {
  INITIALIZED:         'Iniciada',
  AUTHORIZED:          'Autorizada / Aprobada',
  FAILED:              'Fallida / Rechazada',
  NULLIFIED:           'Anulada',
  PARTIALLY_NULLIFIED: 'Parcialmente anulada',
  CAPTURED:            'Capturada',
  REVERSED:            'Reversada',
};

// MercadoPago — status.
export const MERCADOPAGO_STATUS = {
  approved:     'Aprobado',
  authorized:   'Autorizado (pendiente de captura)',
  pending:      'Pendiente',
  in_process:   'En proceso / revisión',
  in_mediation: 'En mediación / disputa',
  rejected:     'Rechazado',
  cancelled:    'Cancelado',
  refunded:     'Reembolsado',
  charged_back: 'Contracargo',
};

// MercadoPago — status_detail (motivos más comunes).
export const MERCADOPAGO_STATUS_DETAIL = {
  accredited:                          'Acreditado (pago aprobado)',
  pending_contingency:                 'En procesamiento — esperá unos minutos',
  pending_review_manual:               'En revisión manual',
  pending_waiting_payment:             'Esperando el pago del cliente',
  pending_waiting_transfer:            'Esperando la transferencia del cliente',
  cc_rejected_bad_filled_card_number:  'Número de tarjeta mal ingresado',
  cc_rejected_bad_filled_date:         'Fecha de vencimiento incorrecta',
  cc_rejected_bad_filled_other:        'Algún dato de la tarjeta mal ingresado',
  cc_rejected_bad_filled_security_code:'Código de seguridad (CVV) incorrecto',
  cc_rejected_blacklist:               'Tarjeta rechazada por seguridad (lista negra)',
  cc_rejected_call_for_authorize:      'El cliente debe autorizar el pago con su banco',
  cc_rejected_card_disabled:           'Tarjeta inactiva — el cliente debe activarla con su banco',
  cc_rejected_card_error:              'No se pudo procesar el pago',
  cc_rejected_duplicated_payment:      'Pago duplicado',
  cc_rejected_high_risk:               'Rechazado por prevención de fraude (alto riesgo)',
  cc_rejected_insufficient_amount:     'Fondos insuficientes',
  cc_rejected_invalid_installments:    'Cuotas no soportadas por la tarjeta',
  cc_rejected_max_attempts:            'Superó la cantidad de intentos permitidos',
  cc_rejected_other_reason:            'Rechazo genérico por el emisor de la tarjeta',
  cc_rejected_3ds_mandatory:           'Requiere autenticación 3-D Secure',
  rejected_high_risk:                  'Rechazado por prevención de fraude (alto riesgo)',
  rejected_by_bank:                    'Rechazado por el banco emisor',
  rejected_insufficient_data:          'Datos insuficientes para procesar el pago',
};
