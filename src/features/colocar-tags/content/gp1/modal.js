import { SELECTORS } from '../../constants.js';
import { waitForElement, waitForGone, waitFor } from '../../../../shared/dom/wait.js';

/** Devuelve el modal #dialog2 si está visible, o null. */
export function getMarketingModal() {
  const el = document.querySelector(SELECTORS.modal);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return el;
}

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
