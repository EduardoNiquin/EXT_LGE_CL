// Comandos de debug de "Stock" -> window.__extLgeCl.magentoStock.*
//
// Se registran en el content script y el popup (via magento/debug.js) y en el
// service worker (background/index.js, que reemplaza `consultar`, `revisar` y
// `notificarPrueba` por la llamada directa: un sendMessage al propio SW no llega).

import { cmd, register } from '../../../shared/debug/index.js';
import { MESSAGES } from './constants.js';
import { getAlertas, getConfig, getEstado, getFoto, limpiarEstado } from './state.js';

const NAMESPACE = 'magentoStock';

const BASE = {
  estado: cmd(() => getEstado(), 'Estado: ultimo sondeo, ultimoIdVisto, ultima revision del portal, error'),
  config: cmd(() => getConfig(), 'Config guardada (con los valores por defecto)'),
  alertas: cmd(() => getAlertas(), 'Alertas guardadas (la mas nueva primero, con la marca visto)'),
  foto: cmd(() => getFoto(), 'Ultima respuesta de GET /stock (la que pinta el popup)'),
  consultar: cmd(
    () => chrome.runtime.sendMessage({ type: MESSAGES.CONSULTAR }),
    'Pide al service worker un GET /stock ahora',
  ),
  revisar: cmd(
    () => chrome.runtime.sendMessage({ type: MESSAGES.REVISAR }),
    'Pide al portal una revision de la tienda ahora (POST /revisar, ~20-40 s) y notifica lo nuevo',
  ),
  notificarPrueba: cmd(
    () => chrome.runtime.sendMessage({ type: MESSAGES.PROBAR_NOTIFICACION }),
    'Muestra una notificacion de prueba',
  ),
  reset: cmd(async () => { await limpiarEstado(); return true; }, 'Borra estado, alertas y foto (no la config); el proximo sondeo es "primera vez"'),
};

/** Registra los comandos; `extra` reemplaza o suma (el SW cambia los que van por mensaje). */
export function registrarDebug(extra = {}) {
  register(NAMESPACE, { ...BASE, ...extra });
}

registrarDebug();
