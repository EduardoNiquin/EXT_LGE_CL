// Helpers para los campos de los formularios Knockout del admin (pantalla del
// package rule y modal de oferta). Todo se ubica por `data-index`: los `id` los
// genera Magento en cada carga (`#WP865RB`, `#F2ACX5T`...) y no sirven.

import { setChecked, setInputValue } from '../../../../../shared/dom/events.js';
import { sleep, waitFor } from '../../../../../shared/dom/wait.js';
import { SELECTORS } from '../../constants.js';

/** Contenedor del campo `data-index` dentro de `root`. */
export function field(root, index) {
  return root?.querySelector(SELECTORS.fieldByIndex(index)) || null;
}

/** True si el campo existe y no esta oculto por Magento (`style="display:none"`). */
export function fieldVisible(root, index) {
  const el = field(root, index);
  return Boolean(el) && el.offsetParent !== null;
}

function inputOf(root, index, selector = 'input, textarea, select') {
  return field(root, index)?.querySelector(selector) || null;
}

/**
 * Escribe en un campo de texto. `null`/`undefined` no toca nada (deja el valor
 * que trae Magento); cadena vacia SI limpia el campo.
 */
export function setText(root, index, value) {
  if (value == null) return false;
  const input = inputOf(root, index, 'input[type="text"], input[type="number"], textarea');
  if (!input) return false;
  setInputValue(input, String(value));
  return true;
}

/** Marca/desmarca un switch (los "Yes/No" del admin son checkbox ocultos). */
export function setSwitch(root, index, checked) {
  if (checked == null) return false;
  const input = inputOf(root, index, 'input[type="checkbox"]');
  if (!input) return false;
  setChecked(input, Boolean(checked));
  if (input.checked !== Boolean(checked)) {
    // El input mide 1px y esta tapado por su label: si el click nativo no
    // prendio, se clickea el label, que es lo que toca un usuario.
    field(root, index)?.querySelector('label.admin__actions-switch-label')?.click();
  }
  return input.checked === Boolean(checked);
}

/** Lee el estado de un switch. */
export function readSwitch(root, index) {
  return Boolean(inputOf(root, index, 'input[type="checkbox"]')?.checked);
}

/**
 * Escribe una fecha en un campo con datepicker de jQuery UI. El calendario se
 * abre al enfocar el input y queda flotando sobre el resto del formulario, asi
 * que se cierra despues de escribir.
 */
export async function setDate(root, index, value, { signal } = {}) {
  if (value == null) return false;
  const input = inputOf(root, index, 'input');
  if (!input) return false;
  setInputValue(input, String(value));
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  const panel = document.querySelector(SELECTORS.datepickerPanel);
  if (panel && panel.offsetParent !== null) {
    try { panel.style.display = 'none'; } catch { /* el widget lo vuelve a manejar */ }
  }
  await sleep(80, signal);
  return true;
}

/**
 * Selecciona una opcion de un `<select multiple>` por el texto visible. El
 * binding de Knockout es `selectedOptions`, que se actualiza con `change`.
 */
export function selectOptionByLabel(select, label) {
  if (!select) return null;
  const wanted = String(label).trim().toLowerCase();
  const option = Array.from(select.options)
    .find((candidate) => candidate.textContent.trim().toLowerCase() === wanted);
  if (!option) return null;
  if (select.multiple) {
    Array.from(select.options).forEach((candidate) => { candidate.selected = candidate === option; });
  } else {
    select.value = option.value;
  }
  select.dispatchEvent(new Event('change', { bubbles: true }));
  select.dispatchEvent(new Event('blur', { bubbles: true }));
  return option;
}

/** Opciones visibles de un `<select>` (para reportar cuando no encaja ninguna). */
export function optionLabels(select) {
  return Array.from(select?.options || []).map((option) => option.textContent.trim()).filter(Boolean);
}

/** Espera a que un campo oculto por Magento se haga visible (ej. `main_discount_rate`). */
export function waitFieldVisible(root, index, { signal, timeout = 5000 } = {}) {
  return waitFor(() => (fieldVisible(root, index) ? field(root, index) : null), {
    signal, timeout, interval: 100, description: `campo ${index} visible`,
  });
}
