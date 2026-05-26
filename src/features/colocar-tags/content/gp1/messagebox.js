import { SELECTORS } from '../../constants.js';
import { waitFor, waitForGone } from '../../../../shared/dom/wait.js';
import { clickEl, findByText } from '../../../../shared/dom/events.js';
import { isVisible } from './modal.js';

/**
 * Devuelve el messagebox visible "más arriba" (mayor z-index) o null.
 * Puede haber varios apilados (el de confirm queda detrás del de éxito).
 *
 * Igual que el modal, usamos `isVisible` (computed style + offsetParent +
 * rect en viewport) en vez de sólo dimensiones, porque RUI deja boxes
 * en el DOM con dims pero `display: none` cuando están cerradas.
 */
export function getTopMessagebox() {
  const boxes = Array.from(document.querySelectorAll(SELECTORS.messagebox))
    .filter(isVisible)
    .sort((a, b) => {
      const za = parseInt(a.style.zIndex || '0', 10);
      const zb = parseInt(b.style.zIndex || '0', 10);
      return zb - za;
    });
  return boxes[0] || null;
}

export function getMessageboxBodyText(box) {
  if (!box) return '';
  return box.querySelector(SELECTORS.messageboxBody)?.textContent.trim() || '';
}

/**
 * Espera a que aparezca un messagebox cuyo body incluya `bodyContains` (opcional)
 * y que tenga un botón con texto `buttonLabel` (case-insensitive).
 */
export function waitForMessagebox({ bodyContains, buttonLabel, timeout = 15000, signal } = {}) {
  return waitFor(
    () => {
      const box = getTopMessagebox();
      if (!box) return null;
      if (bodyContains && !getMessageboxBodyText(box).toLowerCase().includes(bodyContains.toLowerCase())) {
        return null;
      }
      if (buttonLabel) {
        const btn = Array.from(box.querySelectorAll(SELECTORS.messageboxButton))
          .find((b) => b.textContent.trim().toUpperCase() === buttonLabel.toUpperCase());
        if (!btn) return null;
        return { box, button: btn };
      }
      return { box };
    },
    {
      description: `messagebox${bodyContains ? ` con "${bodyContains}"` : ''}${buttonLabel ? ` y botón ${buttonLabel}` : ''}`,
      timeout,
      signal,
    },
  );
}

/**
 * Click sobre el botón cuyo texto matchea `label` dentro del messagebox top.
 * Si `bodyContains` se pasa, primero espera a que el messagebox tenga ese texto.
 */
export async function clickMessageboxButton(label, opts = {}) {
  const { box, button } = await waitForMessagebox({
    bodyContains: opts.bodyContains,
    buttonLabel: label,
    timeout: opts.timeout,
    signal: opts.signal,
  });
  clickEl(button);
  return { box, button };
}

/** Espera a que NO haya messageboxes visibles. */
export function waitForNoMessagebox(opts = {}) {
  return waitFor(() => !getTopMessagebox(), {
    description: 'que se cierren los messageboxes',
    timeout: 10000,
    ...opts,
  });
}

// Re-export para que las flows puedan armar matchers sin acoplar al selector.
export { findByText };
export const messageboxSelector = SELECTORS.messagebox;
// Suprimir warning de waitForGone no usado (lo re-exportamos por si una flow lo necesita).
export { waitForGone };
