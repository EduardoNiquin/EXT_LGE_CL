// Helpers para ubicar botones Vuetify por su texto visible (`.v-btn__content`) o
// por ícono, ya que los ids/clases utilitarias no son estables.

import { SELECTORS } from '../../constants.js';

/**
 * Primer <button> cuyo `.v-btn__content` (o su texto) matchea `text`
 * (case-insensitive, contains). Restringible a `root`.
 */
export function findButtonByText(text, root = document) {
  const want = text.trim().toLowerCase();
  const btns = Array.from(root.querySelectorAll('button'));
  return btns.find((b) => {
    const c = b.querySelector(SELECTORS.vBtnContent) || b;
    return (c.textContent || '').trim().toLowerCase().includes(want);
  }) || null;
}

/** El FAB de guardar (botón flotante con ícono mdi-content-save). */
export function findFabSave(root = document) {
  const fab = Array.from(root.querySelectorAll(SELECTORS.fabSave))
    .find((b) => b.querySelector(SELECTORS.fabSaveIcon));
  if (fab) return fab;
  // Fallback: cualquier botón con el ícono content-save.
  const icon = root.querySelector(`button ${SELECTORS.fabSaveIcon}`);
  return icon ? icon.closest('button') : null;
}
