import { SELECTORS, TEXTS } from '../constants.js';

function textOf(message) {
  const inner = message.querySelector(SELECTORS.messageText);
  return (inner || message).textContent.replace(/\s+/g, ' ').trim();
}

/** Mensajes que el admin muestra arriba de la pantalla (exito / error). */
export function readMessages() {
  const areas = document.querySelectorAll(SELECTORS.messagesArea);
  const success = [];
  const errors = [];
  areas.forEach((area) => {
    area.querySelectorAll(SELECTORS.messageSuccess).forEach((message) => success.push(textOf(message)));
    area.querySelectorAll(SELECTORS.messageError).forEach((message) => errors.push(textOf(message)));
  });
  return { success: success.filter(Boolean), errors: errors.filter(Boolean) };
}

/** True si algun mensaje de exito contiene `needle`. */
export function hasSuccess(needle) {
  const target = needle.toLowerCase();
  return readMessages().success.some((message) => message.toLowerCase().includes(target));
}

/**
 * Clasifica el mensaje con el que Magento devuelve el formulario del padre.
 *
 * `This sku has been existed.` NO es un fallo del SKU: el servidor lo
 * reconocio y lo valido contra el catalogo, solo que ese producto ya tiene su
 * package rule. Como este modulo nunca borra nada, el bundle se omite.
 *
 * @param {string} message
 * @returns {?{ message: string, duplicate: boolean }} null si no hay mensaje.
 */
export function classifyRejection(message) {
  const text = String(message ?? '').trim();
  if (!text) return null;
  return {
    message: text,
    duplicate: text.toLowerCase().includes(TEXTS.SKU_EXISTS.toLowerCase()),
  };
}
