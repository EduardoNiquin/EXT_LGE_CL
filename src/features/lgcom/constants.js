export const FEATURE_ID = 'lgcom';

// Canal que usa el bridge del mundo MAIN (src/content/graphql-bridge.js) para
// reenviar capturas por window.postMessage. Debe coincidir con SOURCE allí.
export const BRIDGE_SOURCE = 'ext-lge-cl/graphql';

// Mensajes one-shot popup ↔ content (chrome.tabs.sendMessage).
export const MESSAGES = {
  GET_CAPTURES:  `${FEATURE_ID}:get-captures`,   // → { ok, captures:[{operationName,ts,url,variables}] }
  GET_OPERATION: `${FEATURE_ID}:get-operation`,  // { operationName } → { ok, operationName, ts, variables, response }
};

// Hosts donde la feature tiene sentido.
export const LGCOM_HOST_RE = /(^|\.)lg\.com$/i;

// Reconoce la URL del endpoint GraphQL.
export const GRAPHQL_URL_RE = /\/api\/graphql(\?|$)/i;

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
  products: {
    label: 'Variantes',
    description: 'Listado de variantes del producto (tamaños/modelos) con precio y stock.',
  },
};

// Cuántas capturas retenemos por operación (la última suele bastar, pero
// guardamos algunas por si la PDP refetchea).
export const CAPTURE_CAP = 5;
