export const FEATURE_ID = 'lgcom';

// Canal que usa el bridge del mundo MAIN (src/content/graphql-bridge.js) para
// reenviar capturas por window.postMessage. Debe coincidir con SOURCE allí.
export const BRIDGE_SOURCE = 'ext-lge-cl/graphql';

// Preferencias de UI del popup (persistidas en chrome.storage.local).
export const STORAGE_KEYS = {
  SCREEN:      `${FEATURE_ID}:screen`,       // pantalla activa (pdp/plp/pbp)
  AUTO_FOLLOW: `${FEATURE_ID}:auto-follow`,  // bool: seguir la pantalla actual
  FONT_SCALE:  `${FEATURE_ID}:font-scale`,   // índice de tamaño de texto
};

// Pantallas (sub-opciones de la feature). Cada una agrupa las operaciones
// GraphQL/REST que le corresponden; el selector interno deja elegir entre ellas.
export const SCREENS = [
  { id: 'pdp', label: 'PDP', operations: ['getPbpProduct', 'products', 'getAddressLevel1', 'getAddressLevel2'] },
  { id: 'plp', label: 'PLP', operations: ['retrieveProductList', 'products'] },
  { id: 'pbp', label: 'PBP', operations: ['products'] },
];

// Para "auto-seguir": operación → pantalla "dueña" (las ambiguas se omiten para
// no forzar un cambio de pantalla equivocado).
export const OPERATION_SCREEN = {
  getPbpProduct:    'pdp',
  getAddressLevel1: 'pdp',
  getAddressLevel2: 'pdp',
  retrieveProductList: 'plp',
};

// Clasifica una captura a una pantalla para el auto-seguimiento.
// PDP y PLP se detectan por operación (getPbpProduct / retrieveProductList).
// PBP comparte `getProductsBySku` (capturado como `products`) con la PLP, pero la
// PBP pide UN solo SKU mientras la PLP pide varios → usamos el largo de skuList.
// Con varios SKUs la operación es ambigua (PLP vs variantes de PDP) → no fuerza.
export function screenForCapture(capture) {
  if (!capture) return null;
  const direct = OPERATION_SCREEN[capture.operationName];
  if (direct) return direct;
  if (capture.operationName === 'products' || capture.operationName === 'getProductsBySku') {
    const list = capture.variables?.skuList;
    if (Array.isArray(list) && list.length === 1) return 'pbp';
  }
  return null;
}

// Escala de tamaño de texto de los campos (px). El índice se persiste.
export const FONT_SIZES = [11, 12.5, 14, 16, 18];

// Mensajes one-shot popup ↔ content (chrome.tabs.sendMessage).
export const MESSAGES = {
  GET_CAPTURES:  `${FEATURE_ID}:get-captures`,   // → { ok, captures:[{operationName,ts,url,variables}] }
  GET_OPERATION: `${FEATURE_ID}:get-operation`,  // { operationName } → { ok, operationName, ts, variables, response }
};

// Hosts donde la feature tiene sentido.
export const LGCOM_HOST_RE = /(^|\.)lg\.com$/i;

// Reconoce la URL del endpoint GraphQL.
export const GRAPHQL_URL_RE = /\/api\/graphql(\?|$)/i;

// Reconoce los endpoints REST proxy de LG (PLP: retrieveProductList, etc.).
export const PROXY_URL_RE = /\/ncms\/[^?]*\/proxy\/([A-Za-z0-9_]+)/i;

// Operaciones GraphQL conocidas → metadata para la UI. Las no listadas caen al
// renderer genérico (JSON crudo).
export const OPERATIONS = {
  getPbpProduct: {
    label: 'Producto (PDP)',
    description: 'Página de producto — precio, descuento, cuotas, despacho, stock, cobertura.',
  },
  getAddressLevel1: {
    label: 'Regiones',
    description: 'Listado de regiones (Address Level 1) de Chile con su id.',
  },
  getAddressLevel2: {
    label: 'Comunas',
    description: 'Listado de comunas (Address Level 2) de una región con su id.',
  },
  products: {
    label: 'Variantes',
    description: 'Listado de variantes del producto (tamaños/modelos) con precio y stock.',
  },
  retrieveProductList: {
    label: 'Lista de productos (PLP)',
    description: 'Catálogo de la PLP con tags, MSRP, estado y datos por modelo.',
  },
};

// Cuántas capturas retenemos por operación (la última suele bastar, pero
// guardamos algunas por si la PDP refetchea).
export const CAPTURE_CAP = 5;
