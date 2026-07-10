export const FEATURE_ID = 'solotodo';

// El backoffice de SoloTodo es una SPA React (Material UI). La página de
// "Precios actuales" (/reports/current_prices) tiene un botón "Exportar" que abre
// el formulario de export; ese form se llena sin recargas. El content script
// matchea <all_urls>; la detección combina host/ruta + DOM.
export const HOST = 'backoffice.solotodo.com';
export const REPORT_PATH = '/reports/current_prices';
export const REPORT_URL = `https://${HOST}${REPORT_PATH}`;

export const STORAGE_KEYS = {
  RUN:   `${FEATURE_ID}:run`,
  DRAFT: `${FEATURE_ID}:draft`,
};

// Mensaje one-shot (lectura de pantalla para el popup / debug).
export const MESSAGES = {
  GET_PAGE_DATA: `${FEATURE_ID}:get-page-data`,
};

// Estado por paso de la corrida (para el detalle del progreso en vivo).
export const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  OK:      'ok',
  ERROR:   'error',
  SKIPPED: 'skipped',
};

// Motivos de finalización del run.
export const FINISH_REASON = {
  DONE:         'done',
  CANCELLED:    'cancelled',
  ERROR:        'error',
  NOT_DETECTED: 'not-detected',
};

// Textos visibles (labels de los campos MUI) — matching por texto, NO por id:
// los ids `_R_xxx_` son dinámicos y cambian por render.
export const LABELS = {
  EXPORTAR:  'Exportar',
  CATEGORIA: 'Categoría',
  MONEDA:    'Moneda',
  TIENDAS:   'Tiendas',
  PAISES:    'Países',
  FILENAME:  'Nombre de archivo',
  GENERAR:   'Generar',
};

export const SELECTORS = {
  // MUI Autocomplete.
  autocompleteRoot: '.MuiAutocomplete-root',
  formLabel:        'label.MuiInputLabel-root, label.MuiFormLabel-root',
  popper:           '.MuiAutocomplete-popper',
  listbox:          'ul[role="listbox"]',
  option:           'li[role="option"]',
  // Campo de texto simple "Nombre de archivo".
  filenameInput:    'input[name="filename"]',
  // Botón submit "Generar".
  submitButton:     'button[type="submit"], button.MuiButton-root',
  // Botones/enlaces genéricos (para ubicar "Exportar" por texto).
  buttonLike:       'button, a[role="button"], .MuiButton-root, .MuiButtonBase-root',
};

// Pasos de la automatización, EN ORDEN. `key` identifica la lógica de llenado;
// `label` es lo que se muestra en el progreso del popup.
export const STEP = {
  EXPORT:    'export',
  CATEGORIA: 'categoria',
  MONEDA:    'moneda',
  TIENDAS:   'tiendas',
  PAISES:    'paises',
  FILENAME:  'filename',
  GENERAR:   'generar',
};

// Listado de tiendas para la categoría de TV (orden pedido por el usuario).
const TV_STORES = [
  'ABC', 'AbcDin', 'Bip', 'Bookcomputer', 'Centrale', 'Dreamtec', 'Dust2',
  'EForest', 'Falabella', 'Falabella Marketplace', 'Globalbox', 'Hites',
  'Infosep', 'KDTEC', 'La Polar', 'Lider', 'Lider Marketplace', 'Llevatelo.cl',
  'LOi Chile', 'Mercado Libre', 'Mercado Libre LG', 'NotebookStore', 'Paris',
  'Paris Marketplace', 'PC Express', 'PC Factory', 'Ripley', 'Ripley Marketplace',
  'Samsung Shop', 'Sodimac', 'SP Digital', 'Tecno Mas', 'Tecno Master',
  'Tienda Oficial LG', 'Todoclick', 'Tottus', 'Travel Tienda', 'V Gamers',
  'Wei', 'Winpy',
];

// Presets por categoría. Cada preset define exactamente qué se selecciona en cada
// campo. Escalable: para sumar una categoría, agregar otra entrada acá.
export const CATEGORIES = [
  {
    id: 'tv',
    label: 'Televisores',
    category: 'Televisores',      // opción a elegir en el campo "Categoría"
    currency: 'Chilean peso',     // opción del campo "Moneda"
    stores: TV_STORES,            // opciones del campo "Tiendas" (multi)
    countries: ['Chile'],         // opciones del campo "Países" (multi)
    filenamePrefix: 'TV-SOLOTODO',// nombre de archivo = prefijo-YYYY-MM-DD
  },
];

export const DEFAULT_CATEGORY_ID = 'tv';

export function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

export const LOG_CAP = 400;

// Watchdog: si ningún frame tiene el formulario tras Iniciar, se reporta
// "pestaña no detectada".
export const CLAIM_WATCHDOG_MS = 3500;
