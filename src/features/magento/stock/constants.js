// Constantes del modulo "Stock" (apartado Magento).
//
// El portal OBS ya vigila cada hora la tienda lg.com/cl (stock, nombre y precio
// de cada SKU) y registra alertas cuando un producto pasa a sin stock, sale de
// la tienda o entra en poco stock. Este modulo conecta la extension con esa
// vigilancia: sondea las alertas nuevas y las avisa con notificaciones del
// sistema, da un resumen diario y deja pedir una revision al momento.
//
// La fuente es SOLO el portal: la extension no lee Magento ni el GraphQL de
// lg.com. Corre en el SERVICE WORKER con alarmas (como Ventas en vivo).
// Detalle en docs/features/magento-stock.md.

import { API as VEV_API, ZONA_HORARIA } from '../ventas-en-vivo/constants.js';
import { API as EPROMOTERS_API } from '../../e-promoters/constants.js';

export { ZONA_HORARIA };

export const MODULE_ID = 'stock';

export const STORAGE_KEYS = {
  CONFIG: `magento:${MODULE_ID}:config`,
  ESTADO: `magento:${MODULE_ID}:estado`,
  ALERTAS: `magento:${MODULE_ID}:alertas`,
  FOTO: `magento:${MODULE_ID}:foto`, // ultima respuesta de GET /stock (el popup pinta sin red)
};

export const MESSAGES = {
  START: `magento:${MODULE_ID}:start`, // popup -> SW: activar
  STOP: `magento:${MODULE_ID}:stop`, // popup -> SW: desactivar
  CONSULTAR: `magento:${MODULE_ID}:consultar`, // popup/debug -> SW: GET /stock ahora
  REVISAR: `magento:${MODULE_ID}:revisar`, // popup/debug -> SW: POST /revisar y notificar lo nuevo
  PROBAR_NOTIFICACION: `magento:${MODULE_ID}:probar-notificacion`,
  MARCAR_VISTAS: `magento:${MODULE_ID}:marcar-vistas`,
};

export const ALARMS = {
  POLL: `magento:${MODULE_ID}:poll`, // cada `intervaloMin`: GET /alertas?desde_id=
  RESUMEN: `magento:${MODULE_ID}:resumen`, // una vez al dia a `horaResumen` (hora de Chile)
};

// Prefijo de los ids de las notificaciones (el clic se despacha por prefijo).
export const NOTIF = {
  PREFIJO: `magento:${MODULE_ID}:`,
  ALERTA: `magento:${MODULE_ID}:alerta:`, // + id de la alerta (el clic abre su ficha)
  GRUPO: `magento:${MODULE_ID}:grupo:`, // + ts (el clic intenta abrir el popup)
  RESUMEN: `magento:${MODULE_ID}:resumen:`,
  PRUEBA: `magento:${MODULE_ID}:prueba:`,
};

// Icono de las notificaciones. `assets/` es el publicDir de Vite: en el paquete
// el archivo queda en la raiz (`icons/icon128.png`), igual que en el manifest.
export const ICONO_NOTIFICACION = 'icons/icon128.png';

export const TIPOS = {
  SIN_STOCK: 'sin_stock',
  FUERA_DE_TIENDA: 'fuera_de_tienda',
  POCO_STOCK: 'poco_stock',
};

export const TIPO_LABEL = {
  [TIPOS.SIN_STOCK]: 'Sin stock',
  [TIPOS.FUERA_DE_TIENDA]: 'Fuera de la tienda',
  [TIPOS.POCO_STOCK]: 'Poco stock',
};

export const ESTADOS = {
  EN_STOCK: 'en_stock',
  PREVENTA: 'preventa',
  AGOTADO: 'agotado',
  FUERA: 'fuera',
};

export const ESTADO_LABEL = {
  [ESTADOS.EN_STOCK]: 'En stock',
  [ESTADOS.PREVENTA]: 'Preventa',
  [ESTADOS.AGOTADO]: 'Agotado',
  [ESTADOS.FUERA]: 'Fuera',
};

// Filtros de la lista de productos del popup.
export const FILTROS = {
  TODOS: 'todos',
  EN_STOCK: ESTADOS.EN_STOCK,
  PREVENTA: ESTADOS.PREVENTA,
  AGOTADO: ESTADOS.AGOTADO,
  POCO_STOCK: 'poco_stock',
  FUERA: ESTADOS.FUERA,
};

export const DEFAULTS = {
  activo: false,
  intervaloMin: 15,
  notificar: {
    [TIPOS.SIN_STOCK]: true,
    [TIPOS.FUERA_DE_TIENDA]: true,
    [TIPOS.POCO_STOCK]: true,
  },
  resumenActivo: true,
  horaResumen: '09:30', // hora de Chile
  token: '', // vacio = el de e-promoters (API.TOKEN)
  endpoint: '', // vacio = API.BASE_URL
};

export const LIMITES = {
  intervaloMin: { min: 5, max: 60 },
};

// API del portal OBS (repo `obs`). Mismo host que Ventas en vivo (de ahi se
// toma el origen, para no repetir la IP) y mismo token (MAGENTO_PA_TOKEN).
//   GET  <base>            -> {revision, ultima_ok, umbral, resumen, productos}
//   GET  <base>/alertas    -> {alertas, ultimo_id, revision} (?desde_id=&limite=)
//   POST <base>/revisar    -> 201 {revision, alertas} | 409 | 502 | 429
export const API = {
  BASE_URL: `${new URL(VEV_API.BASE_URL).origin}/api/magento/stock`,
  TOKEN_HEADER: EPROMOTERS_API.TOKEN_HEADER,
};

export const TOKEN_DEFAULT = EPROMOTERS_API.TOKEN;

export const GET_TIMEOUT_MS = 30000;
export const POST_TIMEOUT_MS = 120000; // la revision de la tienda tarda ~20-40 s

// Alertas por pedido (el portal acepta 1..500) y tope de paginas por sondeo.
export const LIMITE_ALERTAS = 500;
export const MAX_PAGINAS = 20;
// La primera consulta (sin desde_id) trae unas pocas para llenar la lista del
// popup como ya vistas, sin notificarlas.
export const LIMITE_PRIMERA = 50;

export const ALERTAS_MAX = 200; // las que se guardan para el popup
export const MAX_NOTIF_INDIVIDUALES = 3; // mas que esto -> una sola agrupada
export const MAX_ITEMS_LISTA = 5; // items de la notificacion agrupada (type:'list')

export const PORTAL_ATRASADO_MS = 3 * 60 * 60 * 1000; // ultima revision ok con mas de 3 h
export const VENTANA_RESUMEN_MS = 24 * 60 * 60 * 1000; // alertas del resumen diario
export const FOTO_VIEJA_MS = 15 * 60 * 1000; // el popup pide una consulta si la foto es mas vieja
