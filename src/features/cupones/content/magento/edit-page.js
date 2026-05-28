// Driver de la pantalla "Edit Cart Price Rule":
//   - Abrir el colapsable "Actions" (donde viven las conditions de la regla).
//   - Eliminar todas las conditions clickeando los botones X (rule-param-remove).
//   - Guardar con #save (Magento navega solo al listing).
//   - leaveEditPage() como salida de emergencia ante errores.

import { SELECTORS } from '../../constants.js';
import { clickEl } from '../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../shared/dom/wait.js';

/** Abre el colapsable Actions si está cerrado. */
export async function openActionsCollapsible({ signal, timeout = 10000 } = {}) {
  const block = await waitForElement(SELECTORS.actionsBlock, {
    signal, timeout, description: 'colapsable Actions',
  });
  const title = block.querySelector('.fieldset-wrapper-title');
  if (!title) throw new Error('No se encontró el header del colapsable Actions');
  const isOpen = () => title.getAttribute('data-state-collapsible') === 'open';

  if (!isOpen()) {
    // Llevar el bloque al viewport antes de clickear: el colapsable está
    // bastante abajo en el form y algunos handlers de Magento usan offsetParent.
    try { title.scrollIntoView({ block: 'center' }); } catch { /* no-op */ }
    clickEl(title);
    await waitFor(isOpen, { signal, timeout: 5000, description: 'colapsable Actions abierto' });
  }

  // Esperar a que el árbol de condiciones esté montado.
  await waitForElement(SELECTORS.ruleTree, {
    signal, timeout: 5000, description: 'árbol de condiciones de la regla',
  });
  await sleep(100, signal);
}

/**
 * Cuenta cuántos botones de remove visibles (no en displays inactivos) hay en
 * el árbol de condiciones de Actions. Sólo los `<a>` directamente clicables.
 */
function countRemoveButtons() {
  return document.querySelectorAll(SELECTORS.ruleRemoveButton).length;
}

/**
 * Elimina todas las condiciones del bloque Actions clickeando cada botón "X".
 * Devuelve la cantidad efectivamente eliminada.
 *
 * Diseño: en cada iteración tomamos el primer remove visible, contamos antes
 * de clickear y esperamos a que el conteo baje. Esto evita race conditions con
 * el código del rule editor de Magento, que reescribe nodos del DOM tras cada
 * eliminación. Hard cap por seguridad.
 */
export async function removeAllConditions({ signal, maxIterations = 50 } = {}) {
  let removed = 0;
  let safety = maxIterations;

  while (safety-- > 0) {
    const remaining = countRemoveButtons();
    if (remaining === 0) return removed;

    const target = document.querySelector(SELECTORS.ruleRemoveButton);
    if (!target) return removed;

    clickEl(target);

    // Esperar a que el conteo decrezca. Si pasa el timeout, asumimos que el
    // remove no surtió efecto y abortamos para no quedar en loop.
    try {
      await waitFor(() => {
        const now = countRemoveButtons();
        return now < remaining ? now : null;
      }, { signal, timeout: 4000, interval: 100, description: 'condición eliminada del árbol' });
    } catch (err) {
      throw new Error(`Falló al eliminar condición #${removed + 1}: ${err.message}`, { cause: err });
    }
    removed += 1;
    await sleep(80, signal);
  }

  if (countRemoveButtons() > 0) {
    throw new Error(`Quedaron ${countRemoveButtons()} condiciones tras ${maxIterations} iteraciones`);
  }
  return removed;
}

/**
 * Click en Save. Magento navega de vuelta al listing tras un guardado exitoso;
 * no esperamos esa navegación acá — el próximo tick del state machine se
 * dispara cuando el listing carga.
 */
export async function clickSave({ signal } = {}) {
  const btn = document.querySelector(SELECTORS.saveButton);
  if (!btn) throw new Error('Botón Save no encontrado');
  // blur del activo: cualquier input con focus podría tener un commit perezoso
  // pendiente que dispara un dirty-check espurio si no lo cerramos antes.
  try { document.activeElement?.blur?.(); } catch { /* no-op */ }
  clickEl(btn);
  await sleep(200, signal);
}

/**
 * Vuelve al listing sin guardar. Limpia `beforeunload` para evitar el confirm
 * "Changes have been made" típico cuando el form quedó dirty tras un error.
 */
export async function leaveEditPage({ signal } = {}) {
  try { window.onbeforeunload = null; } catch { /* no-op */ }
  const back = document.querySelector(SELECTORS.backButton);
  if (back) {
    clickEl(back);
    await sleep(200, signal);
    return;
  }
  history.back();
}
