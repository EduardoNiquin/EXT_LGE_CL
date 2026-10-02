// Constantes del modulo "Ventas en vivo".
//
// Cada pocos minutos se pide al admin de Magento el export CSV estandar del grid
// de ordenes (el mismo boton "Export -> CSV" que se usa a mano), filtrado por
// fecha de creacion, y se manda tal cual al portal OBS, que lo normaliza en el
// detalle de ordenes. Con eso el panel "En vivo" de Ventas del portal muestra
// las ordenes de lg.com/cl casi al momento.
//
// En esta instancia el export es ASINCRONO (medido el 01-10-2026): el GET a
// gridToCsv solo lo encola y el archivo aparece segundos despues en la pagina
// "Export Files Listing" del modulo propio de LG (lg_order_export), de donde se
// descarga y, si se configura, se borra. Detalle en
// docs/features/magento-ventas-en-vivo.md.
//
// Corre en el SERVICE WORKER con alarmas (no necesita una pestana abierta
// mientras la sesion del admin viva). Si el service worker ve el login, le pide
// el export a una pestana del admin abierta (mensaje TICK).

import { DEFAULT_ADMIN_BASE } from '../constants.js';
import { STORE_ID } from '../informacion_de_orden/constants.js';
import { API as EPROMOTERS_API } from '../../e-promoters/constants.js';

export { DEFAULT_ADMIN_BASE, ADMIN_BASE_RE } from '../constants.js';
export { ORDERS_LISTING_PATH, GRID_NAMESPACE, STORE_ID } from '../informacion_de_orden/constants.js';

export const MODULE_ID = 'ventas-en-vivo';

export const STORAGE_KEYS = {
  CONFIG: `magento:${MODULE_ID}:config`,
  ESTADO: `magento:${MODULE_ID}:estado`,
  HISTORIAL: `magento:${MODULE_ID}:historial`,
};

export const MESSAGES = {
  START: `magento:${MODULE_ID}:start`, // popup -> SW: activar
  STOP: `magento:${MODULE_ID}:stop`, // popup -> SW: desactivar
  TICK_NOW: `magento:${MODULE_ID}:tick-now`, // popup/debug -> SW: enviar ahora
  TICK: `magento:${MODULE_ID}:tick`, // SW -> content del admin: sacar el export con la sesion de la pagina
  BORRAR: `magento:${MODULE_ID}:borrar`, // SW -> content del admin: borrar el archivo del export (tras el POST)
};

export const ALARM = `magento:${MODULE_ID}:tick`;

export const DEFAULTS = {
  activo: false,
  intervaloMin: 5,
  diasCortos: 2, // rango de cada tick: hoy y ayer
  diasLargos: 7, // rango de repaso, cada `cadaNTicksLargo` ticks (y el primero)
  cadaNTicksLargo: 12, // con 5 min: una vez por hora
  storeId: STORE_ID, // OBLIGATORIO: sin filters[store_id][] el export contesta 500 (vacio = STORE_ID)
  borrarArchivo: true, // borrar el archivo de "Export Files Listing" tras mandarlo al portal
  esperaArchivoMs: 2000, // primer sondeo de la lista de exports y pausa entre sondeos
  esperaArchivoMaxMs: 120000, // tope de espera del archivo
  adminBase: DEFAULT_ADMIN_BASE,
  token: '', // vacio = el de e-promoters (API.TOKEN)
  endpoint: '', // vacio = API.BASE_URL
};

export const LIMITES = {
  intervaloMin: { min: 1, max: 60 },
  diasCortos: { min: 1, max: 28 },
  diasLargos: { min: 1, max: 28 }, // el grid de LG rechaza rangos de mas de un mes
  cadaNTicksLargo: { min: 1, max: 1000 },
  esperaArchivoMs: { min: 500, max: 30000 },
  esperaArchivoMaxMs: { min: 10000, max: 600000 },
};

// Endpoint de importacion del portal OBS (repo `obs`). Cuerpo = el texto del CSV.
// Contesta 201 {ok, carga:{id, estado, filas_leidas, creadas, actualizadas,
// omitidas, duracion_ms}, hasta}; 401 token malo; 422 {error, message}; 503 sin
// token configurado en el servidor.
export const API = {
  BASE_URL: 'https://147.93.176.66/api/magento/detalle-ordenes/import',
  TOKEN_HEADER: EPROMOTERS_API.TOKEN_HEADER,
};

// Mismo token que e-promoters (MAGENTO_PA_TOKEN del portal); se puede cambiar en el popup.
export const TOKEN_DEFAULT = EPROMOTERS_API.TOKEN;

// La URL del export, tal como viaja en la config del boton Export del listado.
export const EXPORT_URL_RE = /https?:\/\/[^"'\s\\<>]+\/mui\/export\/gridToCsv(?:\/key\/[^"'/\s\\<>]+)?\/?/i;

// "Export Files Listing" del modulo propio de LG. Su URL (con la key de la
// sesion) viaja en el menu lateral de cualquier pagina del admin, escapada
// (`lg_order_export\/export\/index\/key\/<hex>\/`) o suelta en un href.
export const EXPORT_LIST_URL_RE = /https?:\/\/[^"'\s\\<>]+\/lg_order_export\/export\/index(?:\/key\/[^"'/\s\\<>]+)?\/?/i;
// La misma ruta sin host (href relativo).
export const EXPORT_LIST_PATH_RE = /\/[^"'\s\\<>]*?\/lg_order_export\/export\/index(?:\/key\/[^"'/\s\\<>]+)?\/?/i;
// Lo que distingue la URL final de la lista (una key vencida redirige al dashboard).
export const EXPORT_LIST_MARCA = '/lg_order_export/export/index';

// Encolado OK: 302 al listado de ordenes con este mensaje de exito.
export const ENCOLADO_RE = /added to queue/i;
export const LISTADO_ORDENES_RE = /\/sales\/order\/index\//i;

// Items de la lista de exports.
export const EXPORT_TIPO_ORDEN = 'order'; // el del grid de ordenes (hay otros, p. ej. pto_v2)
export const EXPORT_STATUS_OK = 'success';
export const EXPORT_STATUS_FALLO = ['error', 'failed', 'fail', 'failure', 'canceled', 'cancelled'];

export const LISTADO_TIMEOUT_MS = 30000;
export const ENCOLAR_TIMEOUT_MS = 60000; // la respuesta es el listado de ordenes (~430 KB)
export const LISTA_EXPORT_TIMEOUT_MS = 30000;
export const DESCARGA_TIMEOUT_MS = 120000;
export const BORRADO_TIMEOUT_MS = 30000;
export const PORTAL_TIMEOUT_MS = 120000;
// Cuanto se espera la respuesta de la pestana del admin: este margen (listado,
// lista, encolar, descarga) + `esperaArchivoMaxMs` de la config.
export const PESTANA_TIMEOUT_MS = 240000;
export const PESTANA_BORRAR_TIMEOUT_MS = 45000;

export const HISTORIAL_MAX = 50;
export const MAX_FALLOS_BADGE = 3;
export const BADGE_TEXTO = '!';
export const BADGE_COLOR = '#c0392b';

export const RESULTADO = {
  OK: 'ok',
  ERROR: 'error',
  SESION_CADUCADA: 'sesion_caducada',
};

export const VIA = {
  SW: 'sw',
  TAB: 'tab',
};

export const RANGO = {
  CORTO: 'corto',
  LARGO: 'largo',
};

export const ZONA_HORARIA = 'America/Santiago';
