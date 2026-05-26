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
  el.dispatchEvent(new Event('keyup',  { bubbles: true }));
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

/** Marca/desmarca un checkbox respetando el estado deseado. Solo dispara el cambio si hace falta. */
export function setChecked(el, checked) {
  if (!el) throw new Error('setChecked: elemento nulo');
  if (el.checked === checked) return el;
  el.checked = checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  // Algunos widgets escuchan click en vez de change; mejor disparamos ambos.
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  // Si el click toggle-ó algo distinto a lo deseado, forzar al estado pedido.
  if (el.checked !== checked) {
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
