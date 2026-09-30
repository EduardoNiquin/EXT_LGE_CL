import { ADMIN_BASE_RE } from '../../constants.js';
import { EDIT_URL_RE, LISTING_URL_RE, PAGE_TYPE, SAVED_RE, SELECTORS } from '../constants.js';

export function detectPage(url = location.href) {
  const edit = String(url).match(EDIT_URL_RE);
  if (edit) return { type: PAGE_TYPE.EDIT, ruleId: edit[1], url };
  if (LISTING_URL_RE.test(url)) return { type: PAGE_TYPE.LISTING, url };
  return { type: PAGE_TYPE.OTHER, url };
}

export function adminBaseFrom(url = location.href) {
  return String(url || '').match(ADMIN_BASE_RE)?.[1] || '';
}

function textsOf(selector) {
  return Array.from(document.querySelectorAll(selector))
    .map((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Mensajes que Magento deja arriba de la pagina despues de un Save. */
export function pageMessages() {
  return {
    success: textsOf(SELECTORS.messageSuccess),
    errors: textsOf(SELECTORS.messageError),
  };
}

/**
 * Resultado del Save segun los mensajes de la pagina a la que llego Magento.
 * Ojo: arriba se acumulan mensajes de exito de OTRAS tareas del admin (medido:
 * "Task \"Trigger recollect totals...\" ... successfully updated"), asi que el
 * exito se reconoce por el texto del guardado, no por cualquier mensaje verde.
 * @returns {{ saved: boolean, message: string, errors: string[] }}
 */
export function saveOutcome() {
  const { success, errors } = pageMessages();
  const message = success.find((text) => SAVED_RE.test(text)) || '';
  return { saved: Boolean(message), message, errors };
}

/** Errores de validacion visibles del formulario (solo si esta dibujado). */
export function fieldErrors() {
  return textsOf(SELECTORS.fieldError);
}

export function diagnose() {
  return {
    page: detectPage(),
    adminBase: adminBaseFrom(),
    isTopFrame: window === window.top,
    visibility: document.visibilityState,
    saveButton: Boolean(document.querySelector(SELECTORS.saveButton)),
    messages: pageMessages(),
  };
}
