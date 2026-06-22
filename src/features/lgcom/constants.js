export const FEATURE_ID = 'lgcom';

// Canal que usa el bridge del mundo MAIN (src/content/graphql-bridge.js) para
// reenviar capturas por window.postMessage. Debe coincidir con SOURCE allí.
export const BRIDGE_SOURCE = 'ext-lge-cl/graphql';

// Preferencias de UI del popup (persistidas en chrome.storage.local).
export const STORAGE_KEYS = {
  SECTION:         `${FEATURE_ID}:section`,          // sección activa (info-web/destacados)
  DESTACADOS_TAB:  `${FEATURE_ID}:destacados-tab`,   // sub-tab de Destacados (review/config)
  DESTACADOS_AUTO: `${FEATURE_ID}:destacados-auto`,  // config revisión automática {enabled,intervalMinutes}
  DESTACADOS_RUN:  `${FEATURE_ID}:destacados-run`,   // estado de la corrida (live + último) {active,total,items,...}
  SCREEN:          `${FEATURE_ID}:screen`,           // pantalla activa (pdp/plp/pbp)
  AUTO_FOLLOW:     `${FEATURE_ID}:auto-follow`,      // bool: seguir la pantalla actual
  FONT_SCALE:      `${FEATURE_ID}:font-scale`,       // índice de tamaño de texto
};

// Secciones de nivel superior de la feature LG.com.
export const SECTIONS = [
  { id: 'info-web',   label: 'Información web' },   // PDP / PLP / PBP (captura GraphQL)
  { id: 'destacados', label: 'Revisar Destacados' },
];

// Sub-tabs internos de "Revisar Destacados".
export const DESTACADOS_TABS = [
  { id: 'review', label: 'Revisión' },
  { id: 'config', label: 'Configuración' },
];

// Pantallas (sub-opciones de la feature). Cada una agrupa las operaciones
// GraphQL/REST que le corresponden; el selector interno deja elegir entre ellas.
export const SCREENS = [
  { id: 'pdp', label: 'PDP', operations: ['getPbpProduct', 'products', 'getAddressLevel1', 'getAddressLevel2'] },
  { id: 'plp', label: 'PLP', operations: ['retrieveProductList', 'products', 'getProductsBySku'] },
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
// PBP pide UN solo SKU mientras la PLP pide varios → usamos el largo de skuList:
// 1 SKU → PBP; varios SKUs → PLP (caso landing promocional desde AEM).
export function screenForCapture(capture) {
  if (!capture) return null;
  const direct = OPERATION_SCREEN[capture.operationName];
  if (direct) return direct;
  if (capture.operationName === 'products' || capture.operationName === 'getProductsBySku') {
    const list = capture.variables?.skuList;
    if (Array.isArray(list) && list.length === 1) return 'pbp';
    // Varios SKUs: típico de la landing promocional (PLP especial desde AEM).
    if (Array.isArray(list) && list.length > 1) return 'plp';
  }
  return null;
}

// Escala de tamaño de texto de los campos (px). El índice se persiste.
export const FONT_SIZES = [11, 12.5, 14, 16, 18];

// Mensajes one-shot popup ↔ content (chrome.tabs.sendMessage).
export const MESSAGES = {
  GET_CAPTURES:    `${FEATURE_ID}:get-captures`,     // → { ok, captures:[{operationName,ts,url,variables}] }
  GET_OPERATION:   `${FEATURE_ID}:get-operation`,    // { operationName } → { ok, operationName, ts, variables, response }
  RUN_DESTACADOS:  `${FEATURE_ID}:run-destacados`,   // popup → service worker: dispara una revisión. → { ok }
  PARSE_SPOTLIGHT: `${FEATURE_ID}:parse-spotlight`,  // SW → content (pestaña de fondo): { expectPath } → { ok, ready, hasSpotlight, products }
};

// Nombre de la alarma de revisión automática (chrome.alarms, lo maneja el SW).
export const DESTACADOS_ALARM = `${FEATURE_ID}:destacados-auto`;

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
  getProductsBySku: {
    label: 'Landing (productos)',
    description: 'SKUs que conforman una landing promocional (PLP especial desde AEM con promotion id).',
  },
};

// Cuántas capturas retenemos por operación (la última suele bastar, pero
// guardamos algunas por si la PDP refetchea).
export const CAPTURE_CAP = 5;

// -----------------------------------------------------------------------------
// Revisar Destacados
// -----------------------------------------------------------------------------
//
// Páginas de categoría a revisar. Los "destacados" son los 3 productos del
// recuadro de spotlight: deben tener tag y ser comprables (stock). Como la
// extensión se reinstala seguido y un panel de configuración persistente se
// perdería, las URLs van EN DURO acá (ver Pedida.md, punto 1). Editar esta
// lista para agregar/quitar categorías a vigilar.
export const DESTACADOS_URLS = [
  { label: 'TVs y Soundbars',     url: 'https://www.lg.com/cl/tvs-y-soundbars/todos-los-tvs-y-soundbars/' },
  { label: 'Refrigeradores',      url: 'https://www.lg.com/cl/refrigeradores/todos-los-refrigeradores/' },
  { label: 'Lavadoras',           url: 'https://www.lg.com/cl/lavadoras/todas-las-lavadoras/' },
  { label: 'Monitores',           url: 'https://www.lg.com/cl/monitores/todos-los-monitores/' },
  { label: 'Aire acondicionado',  url: 'https://www.lg.com/cl/aire-acondicionado/todos-los-aires-acondicionados/' },
];

// Selectores para detectar los destacados dentro de una página de categoría.
export const DESTACADOS_SELECTORS = {
  spotlight:    '.c-result-area__spotlight',          // recuadro de destacados
  item:         '.spotlight-list li.c-product-list__item', // una caja de producto
  itemFallback: '.spotlight-list > li',
  tagBox:       '.neo-tag--box',                      // contenedor de tags (vacío = sin tag)
  skuButton:    '.btn-copy[data-sku]',
  skuText:      '.c-product-item__sku',
  modelName:    '.neo-card--ufn h3',
  link:         '.neo-card--ufn a[href]',
  stockControl: '[data-shop-stock-status]',           // botón "Comprar ahora" / "Avísame…"
};

// Estado de stock leído del data-attribute del botón de compra.
export const STOCK_STATUS = {
  IN_STOCK:     'IN_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
};

// Estado de una página revisada. PENDING/CHECKING son transitorios (progreso);
// el resto son terminales.
export const PAGE_STATUS = {
  PENDING:      'pending',      // en cola, todavía no revisada
  CHECKING:     'checking',     // revisándose en este momento
  OK:           'ok',           // todos los destacados con tag y stock
  ISSUES:       'issues',       // hay destacados sin tag o sin stock
  NO_SPOTLIGHT: 'no-spotlight', // la página no tiene recuadro de destacados
  ERROR:        'error',        // no se pudo leer la página
};

// Problemas posibles de un producto destacado.
export const PRODUCT_ISSUE = {
  NO_TAG:   'sin-tag',
  NO_STOCK: 'sin-stock',
};

// La página de categoría usa AEM: el recuadro de destacados lo inyecta el JS
// en el cliente (no viene en el HTML crudo). Por eso la revisión NO hace fetch
// del HTML, sino que abre la URL en una pestaña de fondo, deja que el navegador
// la renderice y lee el DOM vivo.
export const DESTACADOS_RENDER_TIMEOUT = 18000; // ms a esperar a que el spotlight renderice en la pestaña
export const DESTACADOS_SETTLE_MS = 1200;       // ms extra tras detectar el spotlight (stock/tags asíncronos)
export const DESTACADOS_TAB_TIMEOUT = 30000;    // ms tope por página (carga + render + parseo)
// Cuántas pestañas de fondo se revisan EN PARALELO (acelera vs una por una).
export const DESTACADOS_POOL = 3;

// Revisión automática: corre en segundo plano mientras haya una pestaña de
// www.lg.com abierta (el content script la maneja con un tick basado en el
// último run guardado, robusto ante navegaciones dentro de lg.com).
export const DESTACADOS_AUTO_DEFAULT = { enabled: false, intervalMinutes: 30 };
export const DESTACADOS_AUTO_MIN_MINUTES = 5;
export const DESTACADOS_AUTO_MAX_MINUTES = 1440; // 24 h
