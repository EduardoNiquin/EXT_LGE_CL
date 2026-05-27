// Helpers para simular interacción con widgets que escuchan eventos específicos.
// La librería L-* (GP1) usa input/change/blur según el control. Disparar los tres
// es la opción más robusta para inputs de texto.

/**
 * Setea el value de un <input>/<textarea> y dispara los eventos que la mayoría
 * de frameworks (jQuery, L-*, React) escuchan. Devuelve el elemento.
 */
export function setInputValue(el, value) {
  if (!el) throw new Error('setInputValue: elemento nulo');
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  // keyup tiene que ser KeyboardEvent con `key` definido: GP1 escucha keyup en
  // los <input> de comboboxes (ComboboxAutocomplete.onComboboxKeyUp) y hace
  // `event.key.length`. Un Event genérico tiene `key === undefined` y crashea,
  // lo cual a su vez deja al <select> de Type del Product Tag a medio popular
  // (sólo "Line" + pointer-events:none → "No changes were made").
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
  el.dispatchEvent(new Event('blur',   { bubbles: true }));
  return el;
}

/** Setea el value de un <select>. */
export function setSelectValue(el, value) {
  if (!el) throw new Error('setSelectValue: elemento nulo');
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el;
}

/**
 * Marca/desmarca un checkbox respetando el estado deseado. Solo dispara el
 * cambio si hace falta.
 *
 * Usamos `el.click()` nativo (no `dispatchEvent`) porque en checkboxes el
 * navegador es quien toggle-a el state y dispara los eventos en el orden
 * real: `click` → `input` → `change`. Es la única forma de que jQuery
 * handlers y el dirty-tracking de GP1 vean la secuencia "como si un usuario
 * hubiera hecho click". `dispatchEvent(new MouseEvent('click'))` no toggle-a
 * el state ni dispara `change` y deja a GP1 con un dirty-flag inconsistente
 * (síntoma: el modal queda visualmente con los valores correctos pero
 * `formSubmit()` reporta "No changes were made.").
 */
export function setChecked(el, checked) {
  if (!el) throw new Error('setChecked: elemento nulo');
  if (el.checked === checked) return el;
  el.focus();
  el.click();
  if (el.checked !== checked) {
    // Algún handler hizo preventDefault o el click no toggle-ó (browser quirk).
    // Forzamos el estado y disparamos change para que al menos los listeners corran.
    el.checked = checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return el;
}

/** Click robusto: dispara mousedown/mouseup/click para widgets stubborn. */
export function clickEl(el) {
  if (!el) throw new Error('clickEl: elemento nulo');
  const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
  return el;
}

/** Busca dentro de `root` un elemento cuyo textContent exacto (trim) matchea `text`. */
export function findByText(root, selector, text) {
  const candidates = Array.from(root.querySelectorAll(selector));
  return candidates.find((el) => el.textContent.trim() === text) || null;
}

/** Igual que findByText, pero case-insensitive y contains. */
export function findByTextContains(root, selector, text) {
  const t = text.toLowerCase();
  const candidates = Array.from(root.querySelectorAll(selector));
  return candidates.find((el) => el.textContent.toLowerCase().includes(t)) || null;
}
