import { SELECTORS } from '../../constants.js';
import { waitForElement, waitForGone, waitFor } from '../../../../shared/dom/wait.js';

/**
 * Determina si un elemento está visible al usuario. Cubre varias formas
 * de ocultar elementos que aparecen en GP1 / RUI:
 *  - `display: none` propio o de un ancestro (offsetParent === null).
 *  - `visibility: hidden` propio.
 *  - opacity 0.
 *  - posicionado fuera del viewport (rect.right < 0 || rect.bottom < 0).
 *  - dimensiones cero.
 *
 * Atajo: los elementos `position: fixed` tienen offsetParent === null
 * incluso cuando son visibles, así que en ese caso saltamos esa señal.
 */
function isVisible(el) {
  if (!el) return false;
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none') return false;
  if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
  if (parseFloat(cs.opacity) === 0) return false;
  if (cs.position !== 'fixed' && el.offsetParent === null) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  if (rect.right <= 0 || rect.bottom <= 0) return false;
  return true;
}

/** Devuelve el modal #dialog2 si está realmente visible, o null. */
export function getMarketingModal() {
  const el = document.querySelector(SELECTORS.modal);
  if (!isVisible(el)) return null;
  return el;
}

/** Export para que el módulo de messagebox use la misma heurística. */
export { isVisible };

export function isMarketingModalOpen() {
  return Boolean(getMarketingModal());
}

export function waitForModalOpen(opts = {}) {
  return waitFor(getMarketingModal, {
    description: 'que abra el modal de Marketing Info',
    timeout: 15000,
    ...opts,
  });
}

export function waitForModalClosed(opts = {}) {
  return waitForGone(SELECTORS.modal, {
    description: 'que cierre el modal de Marketing Info',
    timeout: 15000,
    ...opts,
  }).catch(() =>
    // si el modal queda en el DOM pero oculto, también cuenta como cerrado
    waitFor(() => !isMarketingModalOpen(), {
      description: 'que el modal pase a oculto',
      timeout: 1000,
      ...opts,
    }),
  );
}

/** Elemento DOM raíz para hacer querys dentro del modal abierto. */
export function modalRoot() {
  const m = getMarketingModal();
  if (!m) throw new Error('Modal de Marketing Info no está abierto');
  return m;
}

/** Espera a que aparezca un selector específico dentro del modal. */
export function waitInModal(selector, opts = {}) {
  return waitForElement(selector, { root: document, ...opts });
}
