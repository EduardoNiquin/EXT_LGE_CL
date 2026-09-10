import { SELECTORS } from '../constants.js';

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
