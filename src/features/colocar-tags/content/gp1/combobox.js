import { waitForElement } from '../../../../shared/dom/wait.js';
import { clickEl, setInputValue, findByText } from '../../../../shared/dom/events.js';

/**
 * Selecciona una opción en un combobox L-* (input + button + ul listbox).
 * Estos combos usan <li> dentro de un <ul role="listbox" style="display: none">.
 * Para "abrirlo" se hace click en el botón asociado. El widget mueve display:none.
 *
 * Estrategia robusta:
 *   1. Foco al input asociado y setear su value (algunos handlers escuchan el input).
 *   2. Click en el botón para asegurar que el listbox quede activo.
 *   3. Click en el <li> cuyo textContent matchea `label`.
 *   4. Si no aparece, fallback: setear input.value y disparar change/blur.
 *
 * @param {object} args
 * @param {string} args.inputSelector   Input del combobox (ej. "#deliveryTag")
 * @param {string} args.buttonSelector  Botón que abre el listbox (ej. "#cb2-button")
 * @param {string} args.listboxSelector ID del listbox (ej. "#cb2-listbox")
 * @param {string} args.label           Texto exacto del <li> a seleccionar
 */
export async function selectComboboxOption({ inputSelector, buttonSelector, listboxSelector, label, signal } = {}) {
  const input = document.querySelector(inputSelector);
  const button = document.querySelector(buttonSelector);
  const listbox = document.querySelector(listboxSelector);
  if (!input || !button || !listbox) {
    throw new Error(`Combobox incompleto (input=${!!input}, button=${!!button}, listbox=${!!listbox})`);
  }

  // 1. Abrir el listbox
  clickEl(button);

  // 2. Esperar a que aparezca el <li> con el label
  await waitForElement(`${listboxSelector} li`, { timeout: 3000, signal, description: `opciones de ${listboxSelector}` });
  const option = findByText(listbox, 'li', label);
  if (!option) {
    // fallback: setear el input y emitir change
    setInputValue(input, label);
    return { input, listbox, option: null, fallback: true };
  }

  // 3. Click + reflejar en el input
  clickEl(option);
  if (input.value !== label) setInputValue(input, label);

  return { input, listbox, option, fallback: false };
}
