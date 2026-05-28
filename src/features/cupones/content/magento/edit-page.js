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
 * Cuenta cuántos botones de remove hay en el árbol de condiciones de Actions.
 */
function countRemoveButtons() {
  return document.querySelectorAll(SELECTORS.ruleRemoveButton).length;
}

/**
 * Elimina todas las condiciones del bloque Actions. Devuelve la cantidad
 * efectivamente eliminada.
 *
 * Diseño robusto contra el rule editor de Magento (VarienRulesForm / prototype.js):
 *
 *   1. Para activar el handler del `<a class="rule-param-remove">` usamos
 *      `target.click()` nativo, NO `dispatchEvent(MouseEvent('click'))`. El
 *      handler está bound al elemento por prototype.js — el dispatch sintético
 *      no siempre lo dispara (síntoma observado: la condición se ve eliminada
 *      en una primera prueba pero el listener no corre, y la siguiente vez no
 *      se elimina nada). `.click()` activa el comportamiento completo del
 *      navegador, incluyendo `onclick=` inline y listeners observados.
 *
 *   2. Para detectar que la eliminación efectivamente ocurrió, retenemos una
 *      referencia al `<li>` target ANTES de clickear y esperamos a que salga
 *      del DOM. Es más confiable que contar botones: el rule editor a veces
 *      re-renderiza el árbol completo y un conteo basado en `querySelectorAll`
 *      puede transitar por valores intermedios confusos.
 */
export async function removeAllConditions({ signal, maxIterations = 50 } = {}) {
  let removed = 0;
  let safety = maxIterations;

  while (safety-- > 0) {
    const target = document.querySelector(SELECTORS.ruleRemoveButton);
    if (!target) return removed;
    const targetLi = target.closest('li');
    const totalBefore = countRemoveButtons();

    try { target.click(); }
    catch { /* fallback al synthetic dispatch */ clickEl(target); }

    try {
      await waitFor(() => {
        // Caso A: el <li> específico salió del DOM (eliminación in-place).
        if (targetLi && !document.body.contains(targetLi)) return true;
        // Caso B (defensivo): el árbol se re-renderizó completo y el conteo
        // total bajó respecto del snapshot pre-click.
        if (countRemoveButtons() < totalBefore) return true;
        return null;
      }, { signal, timeout: 6000, interval: 120, description: 'condición eliminada del árbol' });
    } catch (err) {
      throw new Error(`Falló al eliminar condición #${removed + 1}: ${err.message}`, { cause: err });
    }
    removed += 1;
    await sleep(120, signal);
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
  // .click() nativo activa el onclick handler que la página atribuye al
  // botón Save (vía Knockout/jQuery). Más confiable que dispatchEvent para
  // botones legacy. clickEl como fallback ante navegadores raros.
  try { btn.click(); }
  catch { clickEl(btn); }
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
