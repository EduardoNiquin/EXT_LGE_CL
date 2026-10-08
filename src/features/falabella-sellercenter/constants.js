// Feature "Falabella SellerCenter" — herramientas sobre la API de SellerCenter
// (sellercenter-api.falabella.com). No opera sobre una pestana: todo corre en el
// SERVICE WORKER (sobrevive al cierre del popup) y el popup refleja el estado en
// vivo via storage.onChanged.
//
// Modulos:
//   - Identificar paquetes en ordenes: busca ordenes con 2+ productos que
//     Falabella agrupo en un solo paquete (deberian ir en paquetes separados).
//   - Credenciales: vienen incluidas en la extension (cifradas en el build);
//     el popup permite usar otras.
//
// No confundir con `seller-center-falabella` (soporte Salesforce, otro sitio).

export const FEATURE_ID = 'falabella-sellercenter';

export const STORAGE_KEYS = {
  CREDENCIALES:    `${FEATURE_ID}:credenciales`,     // { userId, apiKey }
  PAQUETES_RUN:    `${FEATURE_ID}:paquetes:run`,     // estado de la corrida (liviano)
  PAQUETES_RESULT: `${FEATURE_ID}:paquetes:result`,  // ordenes con problema
  PAQUETES_DRAFT:  `${FEATURE_ID}:paquetes:draft`,   // ultimo rango elegido
};

// Mensajes popup -> service worker.
export const MESSAGES = {
  PAQUETES_START:  `${FEATURE_ID}:paquetes:start`,
  PAQUETES_CANCEL: `${FEATURE_ID}:paquetes:cancel`,
  PROBAR_CREDENCIALES: `${FEATURE_ID}:credenciales:probar`,
  ESTADO_CREDENCIALES: `${FEATURE_ID}:credenciales:estado`,
};

// -----------------------------------------------------------------------------
// API de SellerCenter
// -----------------------------------------------------------------------------
// Sin token ni login: cada peticion se firma con HMAC-SHA256 (clave = API Key)
// sobre todos los parametros ordenados por nombre. `Version` va fija en 1.0 (no
// es la version real de la API; si se cambia, ninguna firma vale). El Timestamp
// va dentro de la firma y caduca (E003), asi que se firma de nuevo en cada
// intento. El User-Agent del navegador sirve (medido; una extension no puede
// cambiarlo).
export const API = {
  BASE_URL: 'https://sellercenter-api.falabella.com/',
  VERSION: '1.0',
  FORMAT: 'JSON',
  // GetOrders ignora Limit > 100 (medido: 500/1000/5000 devuelven 100).
  PAGE_SIZE: 100,
  // GetMultipleOrderItems acepta lotes de hasta 200 ordenes.
  ITEMS_BATCH: 200,
  // Paginas de GetOrders en paralelo. Cada una tarda ~1,3 s.
  CONCURRENCIA: 3,
  REINTENTOS: 3,
  TIMEOUT_MS: 60_000,
  // CreatedAt viene en hora de Chile pero el filtro CreatedAfter/Before lo
  // compara como si fuera UTC: se pide con 6 h de margen por punta y el dia se
  // decide despues mirando CreatedAt.
  MARGEN_HORAS: 6,
  // La API solo devuelve ~30 dias hacia atras.
  DIAS_HISTORIA: 30,
};

// -----------------------------------------------------------------------------
// Identificar paquetes
// -----------------------------------------------------------------------------

// Estados de orden/item de la API (valores del filtro `Status` de GetOrders).
export const ESTADOS = [
  { id: 'pending',       label: 'Pendiente' },
  { id: 'ready_to_ship', label: 'Listo para despacho' },
  { id: 'shipped',       label: 'Enviado' },
  { id: 'delivered',     label: 'Entregado' },
  { id: 'canceled',      label: 'Cancelado' },
  { id: 'failed',        label: 'Fallido' },
  { id: 'returned',      label: 'Devuelto' },
];
export const ESTADO_LABEL = Object.fromEntries(ESTADOS.map((e) => [e.id, e.label]));
export const etiquetaEstado = (id) => ESTADO_LABEL[id] || id || '';

// Items que ya no se despachan: no cuentan para decidir si la orden esta bien
// separada (una orden de 2 con 1 cancelado es de 1 producto).
export const ITEM_STATUS_INACTIVOS = ['canceled', 'failed', 'returned'];

export const PHASE = {
  IDLE:      'idle',
  ORDERS:    'orders',    // GetOrders, todas las paginas
  ITEMS:     'items',     // GetMultipleOrderItems de las ordenes multi-producto
  ANALYZING: 'analyzing',
  DONE:      'done',
};

export const PHASE_LABEL = {
  [PHASE.IDLE]:      'En espera',
  [PHASE.ORDERS]:    'Leyendo ordenes…',
  [PHASE.ITEMS]:     'Revisando productos y paquetes…',
  [PHASE.ANALYZING]: 'Analizando…',
  [PHASE.DONE]:      'Listo',
};

export const FINISH_REASON = {
  DONE:      'done',
  CANCELLED: 'cancelled',
  ERROR:     'error',
};

export const LOG_CAP = 400;

export const EXPORT_FILENAME_PREFIX = 'falabella-paquetes-sin-separar';
