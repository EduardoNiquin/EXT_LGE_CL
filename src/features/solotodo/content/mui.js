// Helpers para interactuar con los widgets de Material UI (React) del backoffice
// de SoloTodo. Los ids (`_R_xxx_`) son dinámicos, así que se ubican los campos
// por el TEXTO de su label y por la estructura del DOM, nunca por id.
//
// Quirks de React/MUI (importantes):
//   - Inputs controlados por React: asignar `input.value = x` NO dispara el
//     onChange de React (React parcha el setter para trackear el value). Hay que
//     usar el setter NATIVO del prototype y luego despachar un `input` event, así
//     el tracker de React ve el cambio y corre su handler. Igual patrón que en
//     seller-center/accordion.js y starkoms/stock.js.
//   - El popup del Autocomplete se teletransporta al <body> (`.MuiAutocomplete-popper`).
//     El <ul role="listbox"> asociado tiene el id que apunta `input aria-controls`
//     cuando está abierto.
//   - Selección: click NATIVO en la <li role="option"> (MUI escucha el click real).

import { LABELS, SELECTORS } from '../constants.js';
import { sleep, waitFor } from '../../../shared/dom/wait.js';

const nativeInputValueSetter =
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

/** Normaliza texto: colapsa espacios y recorta. */
function norm(t) {
  return String(t ?? '').replace(/\s+/g, ' ').trim();
}
function lc(t) {
  return norm(t).toLowerCase();
}

/** Setea el value de un input controlado por React y dispara su onChange. */
export function setReactInputValue(input, value) {
  if (nativeInputValueSetter) nativeInputValueSetter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Ubica el <label> MUI cuyo texto coincide (exacto, normalizado). */
export function findLabel(labelText, root = document) {
  const target = lc(labelText);
  const labels = Array.from(root.querySelectorAll(SELECTORS.formLabel));
  return labels.find((l) => lc(l.textContent) === target) || null;
}

/**
 * Ubica un Autocomplete por el texto de su label. Devuelve { input, root, label }
 * o null. Resuelve el input por el `for`/id del label (dinámico pero válido en
 * runtime) y, de fallback, por el input dentro del mismo MuiFormControl.
 */
export function findAutocompleteByLabel(labelText, root = document) {
  const label = findLabel(labelText, root);
  if (!label) return null;
  const forId = label.getAttribute('for');
  let input = forId ? document.getElementById(forId) : null;
  const fc = label.closest('.MuiFormControl-root');
  if (!input && fc) input = fc.querySelector('input');
  if (!input) return null;
  return { input, root: input.closest(SELECTORS.autocompleteRoot) || fc, label };
}

/** Ubica el input de texto simple "Nombre de archivo". */
export function findFilenameInput(root = document) {
  return root.querySelector(SELECTORS.filenameInput);
}

/** Ubica el botón submit "Generar" por su texto. */
export function findGenerarButton(root = document) {
  const btns = Array.from(root.querySelectorAll(SELECTORS.submitButton));
  const wanted = lc(LABELS.GENERAR);
  return (
    btns.find((b) => lc(b.textContent) === wanted) ||
    btns.find((b) => lc(b.textContent).includes(wanted)) ||
    null
  );
}

/** Ubica el botón/enlace "Exportar" (abre el formulario de export) por su texto. */
export function findExportButton(root = document) {
  const els = Array.from(root.querySelectorAll(SELECTORS.buttonLike));
  const wanted = lc(LABELS.EXPORTAR);
  return (
    els.find((e) => lc(e.textContent) === wanted) ||
    els.find((e) => lc(e.textContent).includes(wanted)) ||
    null
  );
}

/** True si el formulario de export ya está visible (campo filename + Categoría). */
export function hasExportForm(root = document) {
  return Boolean(findFilenameInput(root) && findLabel(LABELS.CATEGORIA, root));
}

/**
 * Espera a que el listbox del Autocomplete `input` esté abierto y poblado.
 * Devuelve el <ul role="listbox">.
 */
function waitForListbox(input, { signal, timeout = 8000 } = {}) {
  return waitFor(
    () => {
      const id = input.getAttribute('aria-controls');
      let lb = id ? document.getElementById(id) : null;
      if (!lb) lb = document.querySelector(`${SELECTORS.popper} ${SELECTORS.listbox}`);
      if (lb && lb.querySelector(SELECTORS.option)) return lb;
      return null;
    },
    { timeout, interval: 80, signal, description: 'listbox de opciones' },
  );
}

/**
 * Selecciona una opción en un Autocomplete MUI: enfoca el input, escribe el
 * texto para filtrar, espera el listbox y clickea la opción que matchea EXACTO
 * (fallback: case-insensitive exacto, luego contains). Devuelve el texto de la
 * opción elegida.
 *
 * @param {HTMLInputElement} input
 * @param {string} optionText
 * @param {{ signal?: AbortSignal, timeout?: number }} [opts]
 */
export async function selectAutocompleteOption(input, optionText, { signal, timeout = 8000 } = {}) {
  input.focus();
  input.click(); // asegura apertura del popper
  setReactInputValue(input, optionText);

  const listbox = await waitForListbox(input, { signal, timeout });
  const opts = Array.from(listbox.querySelectorAll(SELECTORS.option));

  const match =
    opts.find((o) => norm(o.textContent) === norm(optionText)) ||
    opts.find((o) => lc(o.textContent) === lc(optionText)) ||
    opts.find((o) => lc(o.textContent).includes(lc(optionText)));

  if (!match) {
    const sample = opts.slice(0, 10).map((o) => norm(o.textContent)).filter(Boolean);
    throw new Error(
      `Opción "${optionText}" no encontrada. Disponibles (muestra): ${sample.join(' | ') || '—'}`,
    );
  }

  match.scrollIntoView({ block: 'nearest' });
  match.click();
  return norm(match.textContent);
}

/** Cierra el popper del Autocomplete (Escape) si quedó abierto. */
export function closePopper(input) {
  try {
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  } catch { /* no-op */ }
}

/** Devuelve el valor actual (texto) del input de un Autocomplete single. */
export function autocompleteValue(input) {
  return norm(input?.value);
}

export { norm as normalizeText, lc as lowerText, sleep };
