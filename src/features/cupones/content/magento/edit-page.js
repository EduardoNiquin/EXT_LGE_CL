// Driver de la pantalla "Edit Cart Price Rule":
//   - Abrir el colapsable "Actions" (donde viven las conditions de la regla).
//   - Eliminar todas las conditions clickeando los botones X (rule-param-remove).
//   - Guardar con #save (Magento navega solo al listing).
//   - leaveEditPage() como salida de emergencia ante errores.

import { SELECTORS } from '../../constants.js';
import { clickEl, setInputValue, setSelectValue } from '../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../shared/dom/wait.js';
import { toMessage } from '../../../../shared/errors/index.js';

/** Error específico: la opción de condición pedida no existe en el <select>. */
export class ConditionOptionNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConditionOptionNotFoundError';
  }
}

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
      throw new Error(`Falló al eliminar condición #${removed + 1}: ${toMessage(err)}`, { cause: err });
    }
    removed += 1;
    await sleep(120, signal);
  }

  if (countRemoveButtons() > 0) {
    throw new Error(`Quedaron ${countRemoveButtons()} condiciones tras ${maxIterations} iteraciones`);
  }
  return removed;
}

// -----------------------------------------------------------------------------
// Agregar condición (Agregar Regla de Cupón)
// -----------------------------------------------------------------------------

/** Texto normalizado para matchear opciones por su label visible. */
function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

/**
 * Busca en un <select> la <option> cuyo texto visible matchea `label`:
 * primero exacto (case-insensitive), luego "contains" como fallback. Devuelve
 * la <option> o null.
 */
function findOptionByText(select, label) {
  const opts = Array.from(select.options);
  const target = norm(label);
  let opt = opts.find((o) => norm(o.textContent) === target);
  if (opt) return opt;
  opt = opts.find((o) => norm(o.textContent).includes(target) && target.length > 0);
  return opt || null;
}

/** Cuenta las condiciones existentes (cada una tiene su <select> de operador). */
function countConditions() {
  return document.querySelectorAll(SELECTORS.ruleOperatorSelect).length;
}

/**
 * Agrega UNA condición al bloque Actions:
 *   1. Click en el "+" para mostrar el <select> new_child.
 *   2. Elegir la opción cuyo texto matchea `attributeLabel` → VarienRulesForm
 *      dispara un AJAX que inserta el nuevo <li> de condición.
 *   3. Setear el operador (is / contains / ...) por su <value>.
 *   4. Escribir el valor de texto y hacer blur para que se commitee.
 *
 * Quirks del rule editor de Magento (VarienRulesForm / prototype.js):
 *   - El form tiene handlers `change`/`click` delegados. Disparar `change` que
 *     burbujee sobre el new_child select activa `addRuleNewChild()` (AJAX).
 *   - Para revelar el input/select de un parámetro, el usuario clickea el
 *     `<a class="label">`; usamos click nativo (handler delegado al form).
 *   - El nuevo <li> aparece async (AJAX) → esperamos a que aumente el conteo
 *     de selects de operador.
 *
 * Devuelve un resumen `{ attribute, operator, value }`.
 */
export async function addCondition({ attributeLabel, operator, value }, { signal, timeout = 12000 } = {}) {
  const select = await waitForElement(SELECTORS.ruleNewChildSelect, {
    signal, timeout: 8000, description: 'selector "Please choose a condition to add"',
  });

  const option = findOptionByText(select, attributeLabel);
  if (!option) {
    const sample = Array.from(select.options)
      .map((o) => o.textContent.trim())
      .filter((t) => t && !/please choose/i.test(t))
      .slice(0, 8)
      .join(', ');
    throw new ConditionOptionNotFoundError(
      `No existe la condición "${attributeLabel}". Opciones disponibles (muestra): ${sample}`,
    );
  }

  // Readiness: en el run automatizado el tick puede correr ANTES de que
  // VarienRulesForm (main world) termine de bindear su handler de `change`
  // sobre el form. Sin él, el `change` del new_child no dispara el AJAX que
  // inserta la condición (síntoma: timeout "esperando nueva condición"). Le
  // damos un respiro antes del primer intento.
  await sleep(400, signal);

  // Insertar la condición con reintentos: reseteamos el <select> a '' para que
  // re-elegir el mismo value vuelva a emitir `change`, hasta que aparezca el
  // nuevo <li> (sube el conteo de selects de operador). Esto cubre la carrera
  // de inicialización del rule editor; el alta la dispara el handler delegado
  // de `element-value-changer`, no hace falta clickear el "+".
  const before = countConditions();
  const maxAttempts = 4;
  let inserted = false;
  for (let attempt = 1; attempt <= maxAttempts && !inserted; attempt++) {
    if (select.value !== '') setSelectValue(select, '');
    setSelectValue(select, option.value);
    try {
      await waitFor(() => (countConditions() > before ? true : null), {
        signal, timeout: Math.max(2500, Math.round(timeout / maxAttempts)), interval: 150,
        description: 'nueva condición insertada en el árbol',
      });
      inserted = true;
    } catch (err) {
      if (attempt === maxAttempts) {
        throw new Error(
          `La condición no se insertó tras ${maxAttempts} intentos (el rule editor podría no haber terminado de inicializar)`,
          { cause: err },
        );
      }
      await sleep(500, signal);
    }
  }
  await sleep(200, signal);

  // El operador / valor de la condición recién creada son los últimos del árbol.
  const operatorSelects = document.querySelectorAll(SELECTORS.ruleOperatorSelect);
  const operatorSelect = operatorSelects[operatorSelects.length - 1] || null;
  if (!operatorSelect) throw new Error('No se encontró el <select> de operador de la nueva condición');

  // Setear operador. Revelamos el control clickeando su label (algunos handlers
  // sólo commitean el label visible tras el showParamInputField).
  const opParam = operatorSelect.closest('.rule-param');
  const opLabel = opParam?.querySelector('a.label');
  if (opLabel) { try { opLabel.click(); } catch { clickEl(opLabel); } await sleep(80, signal); }
  setSelectValue(operatorSelect, operator);
  await sleep(120, signal);

  // El input de valor pertenece al mismo <li> de la condición.
  const conditionLi = operatorSelect.closest('li');
  const valueInput = conditionLi?.querySelector('input[id$="__value"]');
  if (!valueInput) throw new Error('No se encontró el input de valor de la nueva condición');

  const valParam = valueInput.closest('.rule-param');
  const valLabel = valParam?.querySelector('a.label');
  if (valLabel) { try { valLabel.click(); } catch { clickEl(valLabel); } await sleep(80, signal); }
  setInputValue(valueInput, String(value ?? ''));
  // Commit del valor: el rule editor actualiza el label "..." al perder foco.
  try { valueInput.blur(); } catch { /* no-op */ }
  await sleep(150, signal);

  return {
    attribute: option.textContent.trim(),
    operator,
    value: String(value ?? ''),
  };
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
