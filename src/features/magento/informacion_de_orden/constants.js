// Constantes del modulo "Informacion de Orden" (captura de ordenes a CSV).
//
// La referencia de todo lo que hay aca es `docs/intrucciones.md` (levantado
// contra el admin real): el endpoint del grid con sus filtros obligatorios, la
// ficha de la orden con sus secciones, y los cuatro metodos de pago de Chile.
//
// El grid resuelve QUE ordenes hay y el enlace de cada una; la informacion sale
// de la ficha (`/sales/order/view/order_id/<id>`), que es la que trae los datos
// del cliente sin enmascarar, los items, los totales y el historial.

export const MODULE_ID = 'informacion-de-orden';

export const STORAGE_KEYS = {
  RUN: `magento:${MODULE_ID}:run`,
  DRAFT: `magento:${MODULE_ID}:draft`,
  // El resultado va aparte del run: cientos de ordenes con sus campos no entran
  // en un run que ademas se reescribe en cada avance (criterio de e-promoters).
  RESULT: `magento:${MODULE_ID}:result`,
};

// De donde salen las ordenes a capturar.
export const SOURCE_MODE = {
  RANGE: 'range', // todo el rango de fechas
  LIST: 'list', // solo los numeros de orden pegados (dentro del rango)
};

export const RUN_PHASE = {
  STARTING: 'starting',
  ENDPOINT: 'endpoint', // resolviendo la key del grid
  DISCOVERING: 'discovering', // buscando las ordenes y sus enlaces
  FETCHING: 'fetching', // entrando a la ficha de cada orden
  BUILDING: 'building', // armando el CSV
  DONE: 'done',
};

export const ORDER_STATUS = {
  PENDING: 'pending',
  OK: 'ok',
  NOT_FOUND: 'not-found',
  ERROR: 'error',
};

export const FINISH_REASON = {
  DONE: 'done',
  CANCELLED: 'cancelled',
  ERROR: 'error',
  NOT_DETECTED: 'not-detected',
};

// -----------------------------------------------------------------------------
// Reglas del grid de LG (docs/intrucciones.md seccion 4.4)
// -----------------------------------------------------------------------------

// El servidor responde 200 con texto plano que empieza asi cuando los filtros
// obligatorios faltan o el rango es muy largo. NO es un error HTTP.
export const FILTER_ERROR_PREFIX = 'ORDER_FILTER_ERROR';

// El mensaje dice "1 mes"; en la prueba 29 dias paso y 60 fallo. 28 es la
// ventana segura.
export const MAX_RANGE_DAYS = 28;
export const DEFAULT_RANGE_DAYS = 7;

// Purchase Point obligatorio. 123 = Chile (store_id de la instancia observada).
export const STORE_ID = '123';
export const STORE_VIEW_LABEL = 'Chile Default Store View';

export const GRID_NAMESPACE = 'sales_order_grid';
export const PAGE_SIZE = 200; // ordenes por consulta en modo rango
export const LIST_PAGE_SIZE = 10; // modo lista: se busca una orden puntual
export const MAX_PAGES = 200; // tope duro de paginas de descubrimiento
export const MAX_ORDERS = 5000; // tope duro de fichas por corrida

// -----------------------------------------------------------------------------
// Concurrencia (el selector "Consultas simultaneas" del popup)
// -----------------------------------------------------------------------------

export const CONCURRENCY_MIN = 1;
export const CONCURRENCY_DEFAULT = 4;



/** Restringe el paralelismo al rango permitido (fallback al valor por defecto). */
export function clampConcurrency(value) {
  if (String(value ?? '').trim() === '') return CONCURRENCY_DEFAULT;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return CONCURRENCY_DEFAULT;
  return Math.max(CONCURRENCY_MIN, n);
}

// -----------------------------------------------------------------------------
// URLs del admin
// -----------------------------------------------------------------------------

export const DEFAULT_ADMIN_BASE = 'https://shop.lg.com/obsadm';
export const ADMIN_BASE_RE = /^(https?:\/\/[^/]+\/[^/]*obsadm)\//i;
export const ORDERS_LISTING_PATH = '/sales/order/index/';
export const ORDER_VIEW_PATH = '/sales/order/view/order_id/';
// El endpoint del grid, tal como viaja en el `update_url` del ui component.
export const GRID_ENDPOINT_RE = /https?:\/\/[^"'\s\\]*\/mui\/index\/render\/key\/[A-Za-z0-9]+\/?/i;

export const ENDPOINT_TIMEOUT_MS = 30000;
export const CLAIM_WATCHDOG_MS = 3500;

// -----------------------------------------------------------------------------
// Metodos de pago (docs/intrucciones.md seccion 6)
// -----------------------------------------------------------------------------

export const PAYMENT_METHOD = {
  WEBPAY: 'transbank_webpay',
  MP_BASIC: 'fih_mercadopago_basic',
  MP_GLOBAL: 'mercadopago_global_credit_card',
  MARKETPLACE: 'marketplace_payment',
};

export const GATEWAY = {
  WEBPAY: 'webpay',
  MERCADOPAGO: 'mercadopago',
  MARKETPLACE: 'marketplace',
  UNKNOWN: 'unknown',
};

export const GATEWAY_LABEL = {
  [GATEWAY.WEBPAY]: 'Webpay / Transbank',
  [GATEWAY.MERCADOPAGO]: 'MercadoPago',
  [GATEWAY.MARKETPLACE]: 'Marketplace',
  [GATEWAY.UNKNOWN]: 'Sin pasarela',
};

// Tipos de pago de Transbank (paymentTypeCode).
export const TRANSBANK_PAYMENT_TYPE = {
  VD: 'Venta debito',
  VN: 'Venta normal (sin cuotas)',
  VC: 'Venta en cuotas',
  SI: 'Cuotas sin interes',
  S2: 'Cuotas sin interes (2)',
  NC: 'Cuotas comercio',
  VP: 'Venta prepago',
};

// -----------------------------------------------------------------------------
// La ficha de la orden (docs/intrucciones.md seccion 5)
// -----------------------------------------------------------------------------

export const DETAIL_SECTION = {
  INFO: 'info', // Order Information + Account Information
  ADDRESSES: 'addresses', // direcciones completas, sin enmascarar
  PAYMENT: 'payment', // bloque de pago + metodo de envio
  TOTALS: 'totals', // tabla de totales
  HISTORY: 'history', // notas del historial + transacciones decodificadas
  LOGS: 'logs', // ERP / OSMS export log + Full In House
};

// Las que se ofrecen como casilla en el popup. INFO arrastra ADDRESSES y
// PAYMENT arrastra TOTALS: para quien lee la ficha son la misma pantalla.
export const DETAIL_SECTION_CHOICES = [
  {
    key: DETAIL_SECTION.INFO,
    label: 'Orden, cuenta y direcciones',
    hint: 'Fecha, estado, origen, IP, dispositivo, cliente y las direcciones completas (sin enmascarar).',
    implies: [DETAIL_SECTION.ADDRESSES],
  },
  {
    key: DETAIL_SECTION.PAYMENT,
    label: 'Pago, envio y totales',
    hint: 'Bloque de pago (sus campos cambian segun la pasarela), metodo de envio y la tabla de totales.',
    implies: [DETAIL_SECTION.TOTALS],
  },
  {
    key: DETAIL_SECTION.HISTORY,
    label: 'Historial y transacciones',
    hint: 'Comentarios del historial y las notas de Transbank/MercadoPago decodificadas.',
    implies: [],
  },
  {
    key: DETAIL_SECTION.LOGS,
    label: 'Logs ERP / OSMS y facturacion',
    hint: 'ERP y OSMS Export Log y Full In House. Suman una peticion extra por orden.',
    implies: [],
  },
];

export const DEFAULT_SECTIONS = {
  [DETAIL_SECTION.INFO]: true,
  [DETAIL_SECTION.PAYMENT]: true,
  [DETAIL_SECTION.HISTORY]: true,
  [DETAIL_SECTION.LOGS]: true,
};

/** Expande las casillas del popup a las secciones que lee el parser. */
export function expandSections(selected = {}) {
  const out = {};
  for (const choice of DETAIL_SECTION_CHOICES) {
    const on = selected[choice.key] !== false;
    out[choice.key] = on;
    for (const implied of choice.implies) out[implied] = on;
  }
  return out;
}

// Prefijo de las columnas dinamicas del CSV: "<seccion> - <etiqueta>".
export const SECTION_LABEL = {
  orden: 'Orden',
  cliente: 'Cliente',
  direcciones: 'Direccion',
  pago: 'Pago',
  envio: 'Envio',
  totales: 'Totales',
  inHouse: 'In House',
  erp: 'ERP',
  osms: 'OSMS',
};

export const DETAIL_SELECTORS = {
  orderTitle: '.order-information .admin__page-section-item-title .title, .order-information .title',
  orderStatus: '#order_status',
  orderInfoTable: 'table.order-information-table, .order-information-table',
  accountInfoTable: 'table.order-account-information-table, .order-account-information-table',
  addresses: '.order-addresses',
  addressItem: '.admin__page-section-item',
  addressTitle: '.admin__page-section-item-title .title',
  paymentMethod: '.order-payment-method',
  paymentTitle: '.order-payment-method-title',
  shippingMethod: '.order-shipping-method',
  itemsTable: 'table.edit-order-table',
  totals: '.order-totals',
  customSection: '.custom-section',
  gerpLog: '.gerp-export-log',
  osmsLog: '.osms-export-log',
  noteItem: 'li.note-list-item',
  noteDate: '.note-list-date',
  noteTime: '.note-list-time',
  noteStatus: '.note-list-status',
  noteComment: '.note-list-comment',
};

// Pestanas que Magento carga por AJAX con su propia key y form_key: la URL se
// saca del HTML de la ficha, no se arma a mano (la key cambia por sesion).
export const TAB_URL_RE = {
  gerp: /\/sales\/order\/gerpExportLog\/[^"'\\\s<>]+/i,
  osms: /\/sales\/order\/osmsExportLog\/[^"'\\\s<>]+/i,
};

export const DETAIL_TIMEOUT_MS = 45000;

// -----------------------------------------------------------------------------
// Columnas del CSV (una fila por orden)
// -----------------------------------------------------------------------------
//
// El grid aporta lo minimo para identificar la orden, mas el detalle del pago
// que la ficha no muestra (`additional_information`). TODO lo demas sale de la
// ficha como columnas dinamicas "<seccion> - <etiqueta>": las filas cambian de
// una orden a otra, asi que leerlas por posicion seria adivinar.
//
// `key` -> campo del item del grid.  `pay` -> campo del pago ya normalizado.
// `money` -> se limpia el formato ("$453,981.00" -> "453981.00").

export const GRID_COLUMNS = [
  { label: 'Orden', key: 'increment_id' },
  { label: 'Order ID', key: 'entity_id' },
  { label: 'Fecha (UTC)', key: 'created_at' },
  { label: 'Fecha local', key: 'local_time' },
  { label: 'Estado (grid)', key: 'status' },
  { label: 'Canal', key: 'sale_channel' },
  { label: 'Marketplace', key: 'marketplace_name' },
  { label: 'Marketplace Order ID', key: 'marketplace_order_id' },
  { label: 'Store', key: 'store_name' },
  { label: 'Total (grid)', key: 'base_grand_total', money: true },
  { label: 'Moneda', key: 'base_currency_code' },
];

export const PAYMENT_COLUMNS = [
  { label: 'Metodo de pago', key: 'payment_method' },
  { label: 'Pasarela', pay: 'gatewayLabel' },
  { label: 'ID transaccion', pay: 'txId' },
  { label: 'Codigo autorizacion', pay: 'authCode' },
  { label: 'Marca', pay: 'brand' },
  { label: 'Ultimos 4', pay: 'last4' },
  { label: 'Cuotas', pay: 'installments' },
  { label: 'Tipo de pago', pay: 'paymentTypeLabel' },
  { label: 'Estado pago', pay: 'pgStatus' },
  { label: 'Detalle estado', pay: 'pgStatusDetail' },
  { label: 'Monto pago', pay: 'amount', money: true },
  { label: 'Comision', pay: 'fee', money: true },
  { label: 'Neto', pay: 'netAmount', money: true },
  { label: '3DS', pay: 'threeDs' },
];

// Resumen de los productos: una orden con varios items concatena con " | ", asi
// la fila por orden no pierde el detalle de golpe. Cada columna busca su dato
// entre varios encabezados posibles, porque el nombre cambia entre versiones.
export const ITEM_COLUMNS = [
  { label: 'Item - SKU', headers: ['Model', 'SKU', 'Product'] },
  { label: 'Item - Cantidad', headers: ['Qty'] },
  { label: 'Item - Precio', headers: ['Price'] },
  { label: 'Item - Total', headers: ['Row Total'] },
  { label: 'Item - Descripcion', headers: ['Description'] },
  { label: 'Item - Estado', headers: ['Item Status'] },
  { label: 'Item - Estado ERP', headers: ['ERP Status'] },
  { label: 'Item - Bodega', headers: ['Warehouse Code'] },
  { label: 'Item - ERP Sales #', headers: ['ERP Sales #'] },
  { label: 'Item - Courier', headers: ['Carrier'] },
  { label: 'Item - Tracking', headers: ['Tracking Number'] },
  { label: 'Item - Entrega estimada', headers: ['Estimated Delivery Date'] },
  { label: 'Item - Serie', headers: ['Serial Number'] },
  { label: 'Item - Envio', headers: ['Global Shipping Info'] },
];

export const ITEM_JOIN = ' | ';
export const HISTORY_JOIN = ' || ';
export const HISTORY_MAX_CHARS = 4000;

// Columnas de control, siempre al final.
export const META_COLUMNS = ['Estado captura', 'Error'];

export const LOG_CAP = 400;
export const PREVIEW_ROWS = 150;
