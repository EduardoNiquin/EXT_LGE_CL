// Feature "E-promoters" — apartado para los e-promoters.
//
// Sub-seccion actual: "Informe ordenes". Toma el informe de ordenes de Magento
// (cargado como CSV/JSON o pedido a la API), lo filtra (rango de fechas por
// "Local Time", estados a recuperar y dedupe de canceladas) y entrega un CSV
// recortado a las columnas que los e-promoters necesitan.
//
// El procesamiento corre en el SERVICE WORKER (sobrevive al cierre del popup);
// el estado de la corrida vive en chrome.storage.local y el popup lo refleja en
// vivo via storage.onChanged.

export const FEATURE_ID = 'e-promoters';

export const STORAGE_KEYS = {
  RUN:    `${FEATURE_ID}:informe:run`,    // estado de la corrida (liviano)
  RESULT: `${FEATURE_ID}:informe:result`, // CSV generado (para re-descargar)
  DRAFT:  `${FEATURE_ID}:informe:draft`,  // ultima config del formulario
};

// Mensajes popup -> service worker.
export const MESSAGES = {
  START:  `${FEATURE_ID}:informe:start`,
  CANCEL: `${FEATURE_ID}:informe:cancel`,
};

// Origen de los datos.
export const SOURCE = {
  API: 'api',
  CSV: 'csv',
};

// Fases del procesamiento (para el indicador "que esta haciendo").
export const PHASE = {
  IDLE:        'idle',
  DOWNLOADING: 'downloading',   // pidiendo data a la API
  PARSING:     'parsing',       // parseando CSV/JSON
  FILTERING:   'filtering',     // filtros (fecha + estado)
  DEDUPING:    'deduping',      // quitando canceladas duplicadas
  BUILDING:    'building',      // armando el CSV de salida
  SAVING:      'saving',        // disparando la descarga
  DONE:        'done',
};

export const PHASE_LABEL = {
  [PHASE.IDLE]:        'En espera',
  [PHASE.DOWNLOADING]: 'Descargando datos de la API…',
  [PHASE.PARSING]:     'Leyendo el informe…',
  [PHASE.FILTERING]:   'Aplicando filtros…',
  [PHASE.DEDUPING]:    'Quitando canceladas duplicadas…',
  [PHASE.BUILDING]:    'Generando el CSV…',
  [PHASE.SAVING]:      'Descargando el archivo…',
  [PHASE.DONE]:        'Listo',
};

export const FINISH_REASON = {
  DONE:      'done',
  CANCELLED: 'cancelled',
  ERROR:     'error',
};

// -----------------------------------------------------------------------------
// Reglas de negocio (filtrado)
// -----------------------------------------------------------------------------

// Estados que se CONSERVAN (ordenes a recuperar). Confirmado con el usuario.
export const KEEP_STATUSES = [
  'payment_declined',
  'transaction_expired',
  'canceled',
  'customer_canceled',
];

// Estados que cuentan como "cancelada" para el dedupe (por Customer Email +
// Bill-to Name, conservando la primera ocurrencia).
export const CANCELLED_STATUSES = [
  'canceled',
  'customer_canceled',
];

// Columna usada para el filtro por rango de fechas. Formato origen:
// "2026-06-23 09:37:02" (se compara solo la parte de fecha YYYY-MM-DD).
export const DATE_COLUMN = 'Local Time';

// Filtro por "Warehouse Code": se CONSERVAN solo las filas cuyo codigo contenga
// este token (p.ej. "N2U" o "NB9N2U"). Comparacion tolerante a mayusculas.
export const WAREHOUSE_COLUMN = 'Warehouse Code';
export const WAREHOUSE_KEEP_TOKEN = 'N2U';

// Columnas del CSV de salida, EN ORDEN. `out` = encabezado final (tal cual lo
// pidio el usuario); `src` = encabezado en el origen (Magento/API). El lookup en
// el origen es tolerante a mayusculas/espacios (ver shared/report.js).
export const OUTPUT_COLUMNS = [
  { out: 'Local Time',           src: 'Local Time' },
  { out: 'ID',                   src: 'ID' },
  { out: 'Bill-to Name',         src: 'Bill-to Name' },
  { out: 'Customer Email',       src: 'Customer Email' },
  { out: 'User Phone (Shipping)', src: 'User Phone (Shipping)' },
  { out: 'SKU PRICE',            src: 'SKU PRICE' },
  { out: 'SKU Without Prefix',   src: 'SKU Without Prefix' },
  { out: 'Grand Total (Base)',   src: 'Grand Total (Base)' },
  { out: 'Coupon Code',          src: 'Coupon Code' },
  { out: 'Coupon Rule',          src: 'Coupon Rule' },
  { out: 'Discount Amount',      src: 'Discount Amount' },
  { out: 'Status',               src: 'Status' },
  { out: 'Qty Ordered',          src: 'Qty Ordered' },
  { out: 'WareHouse Code',       src: 'Warehouse Code' },
];

// Claves para identificar duplicados de canceladas.
export const DEDUPE_KEYS = ['Customer Email', 'Bill-to Name'];

// -----------------------------------------------------------------------------
// API de ordenes Magento
// -----------------------------------------------------------------------------
// Mismas credenciales que el PowerQuery de Excel (X-Api-Token = MAGENTO_PA_TOKEN).
// El servidor filtra por order_date (timestamp en otra zona horaria), asi que
// pedimos una ventana mas ancha (+-1 dia) y luego filtramos exacto por
// "Local Time" en el cliente.
export const API = {
  BASE_URL: 'https://147.93.176.66/api/magento/orders',
  TOKEN: '9f27700e322dc0dcd3413d9c16ba3f737b730897ab553729378a1014279b5e62',
  TOKEN_HEADER: 'X-Api-Token',
  LIMIT: 50000,
  FORMAT: 'json',          // la API entrega JSON o CSV; usamos JSON (mismas keys)
  WINDOW_PAD_DAYS: 1,      // colchon a cada lado para el desfase de zona horaria
};

export const LOG_CAP = 400;

export const OUTPUT_FILENAME_PREFIX = 'informe-ordenes-epromoters';
