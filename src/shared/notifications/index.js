// Notificaciones del sistema (en Windows, las del centro de notificaciones)
// sobre `chrome.notifications`. Solo para el service worker: es el unico
// contexto vivo cuando hay que avisar con el popup cerrado.
//
// - `mostrarNotificacion(id, opciones)` completa el icono y nunca lanza.
// - `alClicNotificacion(prefijo, handler)`: un unico listener de
//   `chrome.notifications.onClicked` para toda la extension, que despacha por
//   prefijo del id (`magento:stock:...`). Registrar dos veces el mismo prefijo
//   reemplaza el handler; el listener se engancha una sola vez.
// - `abrirPopup()` / `abrirPestana(url)`: lo que suele hacer un clic.
//
// Requiere el permiso "notifications" (manifest.base.json).

import { logger } from '../utils/logger.js';
import { toMessage } from '../errors/index.js';

const log = logger('service-worker');

// `assets/` es el publicDir de Vite: en el paquete el icono queda en la raiz.
export const ICONO_DEFAULT = 'icons/icon128.png';

const manejadores = new Map();
let enganchado = false;

function iconUrl(ruta) {
  try {
    return chrome.runtime.getURL(ruta || ICONO_DEFAULT);
  } catch {
    return ruta || ICONO_DEFAULT;
  }
}

/**
 * Muestra (o reemplaza, si el id ya existe) una notificacion.
 * @param {string} id
 * @param {chrome.notifications.NotificationOptions} opciones  `type`, `title`, `message`... (`iconUrl` opcional)
 * @returns {Promise<string|null>} el id, o null si no se pudo
 */
export async function mostrarNotificacion(id, opciones) {
  try {
    if (!chrome?.notifications?.create) throw new Error('chrome.notifications no esta disponible (falta el permiso?)');
    const completas = { priority: 0, ...opciones, iconUrl: iconUrl(opciones?.iconUrl) };
    return await chrome.notifications.create(id, completas);
  } catch (err) {
    log.warn('no se pudo mostrar la notificacion', { id, error: toMessage(err) });
    return null;
  }
}

export async function cerrarNotificacion(id) {
  try { await chrome.notifications.clear(id); } catch { /* ya no existe */ }
}

/** 'granted' | 'denied' (el usuario puede apagarlas para la extension). */
export async function nivelDePermiso() {
  try {
    return await chrome.notifications.getPermissionLevel();
  } catch {
    return 'denied';
  }
}

/**
 * Handler del clic para las notificaciones cuyo id empieza con `prefijo`.
 * El handler recibe el id; la notificacion se cierra despues del clic.
 */
export function alClicNotificacion(prefijo, handler) {
  manejadores.set(prefijo, handler);
  if (enganchado || !chrome?.notifications?.onClicked) return;
  enganchado = true;
  chrome.notifications.onClicked.addListener((id) => {
    const entrada = [...manejadores.entries()]
      .filter(([p]) => String(id).startsWith(p))
      .sort((a, b) => b[0].length - a[0].length)[0];
    Promise.resolve()
      .then(() => entrada?.[1](id))
      .catch((err) => log.warn('fallo el clic de la notificacion', { id, error: toMessage(err) }))
      .finally(() => cerrarNotificacion(id));
  });
}

/** Intenta abrir el popup de la extension. No lanza: false si el navegador no lo deja. */
export async function abrirPopup() {
  try {
    await chrome.action.openPopup();
    return true;
  } catch (err) {
    log.debug('no se pudo abrir el popup desde la notificacion', toMessage(err));
    return false;
  }
}

/** Abre una URL http(s) en una pestana nueva (otro esquema se ignora). No lanza. */
export async function abrirPestana(url) {
  if (!url || !/^https?:\/\//i.test(String(url))) return false;
  try {
    await chrome.tabs.create({ url });
    return true;
  } catch (err) {
    log.warn('no se pudo abrir la pestana', { url, error: toMessage(err) });
    return false;
  }
}
