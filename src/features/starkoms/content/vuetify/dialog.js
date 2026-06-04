// Helpers para el v-dialog de "Cambiar estado" del pedido.

import { SELECTORS } from '../../constants.js';
import { waitForElement, waitForGone } from '../../../../shared/dom/wait.js';

/** Espera a que el diálogo activo esté presente. */
export function waitDialog({ signal, timeout = 5000 } = {}) {
  return waitForElement(SELECTORS.dialog, { signal, timeout, description: 'diálogo de cambio de estado' });
}

/** Espera a que el diálogo se cierre. */
export function waitDialogClosed({ signal, timeout = 5000 } = {}) {
  return waitForGone(SELECTORS.dialog, { signal, timeout, description: 'cierre del diálogo' });
}

/** El diálogo activo (o null). */
export function getDialog() {
  return document.querySelector(SELECTORS.dialog);
}

/**
 * Botón dentro de `.v-card__actions` del diálogo cuyo `.v-btn__content` matchea
 * el texto (case-insensitive, contains). Útil para "Guardar" / "Cancelar".
 */
export function dialogButton(text) {
  const actions = document.querySelector(SELECTORS.dialogActions);
  if (!actions) return null;
  const want = text.trim().toLowerCase();
  const btns = Array.from(actions.querySelectorAll('button'));
  return btns.find((b) => {
    const c = b.querySelector(SELECTORS.vBtnContent) || b;
    return (c.textContent || '').trim().toLowerCase().includes(want);
  }) || null;
}
