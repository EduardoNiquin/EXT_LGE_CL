// Leer y escribir campos del formulario de Complex Voucher (OA Framework).
//
// OAF engancha su PPR al `onchange`/blur de cada campo, asi que escribir es:
// setter nativo + input/change + blur REAL (el.blur(), no un Event sintetico,
// que no mueve el foco). Lo que dispara de verdad el PPR se confirma en el
// navegador real (docs/features/facturas-flujo-gevs.md, "Pendiente de verificar").

import { SELECTORS } from '../../constants.js';

export function el(selector, root = document) {
  return root.querySelector(selector);
}

export function requerir(selector) {
  const nodo = el(selector);
  if (!nodo) throw new Error(`No esta en pantalla: ${selector}`);
  return nodo;
}

/** Valor actual de un campo (input o select); '' si no existe. */
export function leerValor(selector) {
  const nodo = el(selector);
  return nodo ? String(nodo.value ?? '').trim() : '';
}

/**
 * Un monto como lo muestra OAF ("1.508.792", "-550", "8.634.097,36") a entero
 * en texto ("1508792"). Los decimales se descartan: en este voucher nunca hay.
 */
export function normalizarMonto(texto) {
  const limpio = String(texto ?? '').replace(/[^\d,-]/g, '');
  const [entero] = limpio.split(',');
  return entero.replace(/(?!^)-/g, '') || '';
}

export function mismoMonto(a, b) {
  return normalizarMonto(a) === normalizarMonto(b);
}

export function escribir(selector, valor) {
  const nodo = requerir(selector);
  const prototipo = nodo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototipo, 'value')?.set;
  nodo.focus();
  if (setter) setter.call(nodo, String(valor));
  else nodo.value = String(valor);
  nodo.dispatchEvent(new Event('input', { bubbles: true }));
  nodo.dispatchEvent(new Event('change', { bubbles: true }));
  nodo.blur();
  return nodo;
}

export function elegir(selector, value) {
  const nodo = requerir(selector);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  nodo.focus();
  if (setter) setter.call(nodo, String(value));
  else nodo.value = String(value);
  nodo.dispatchEvent(new Event('change', { bubbles: true }));
  nodo.blur();
  return nodo;
}

/** Clic nativo: los botones de OAF llevan su `onclick="submitForm(...)"`. */
export function clic(selector) {
  const nodo = requerir(selector);
  nodo.click();
  return nodo;
}

/** El icono de lupa (LOV) que acompana a un campo; abre la ventana "Search and Select". */
export function lupaDe(selector) {
  const nodo = requerir(selector);
  const lupa = nodo.closest('td')?.querySelector('a');
  if (!lupa) throw new Error(`El campo ${selector} no tiene icono de LOV`);
  return lupa;
}

export function contarFilasDebit() {
  return document.querySelectorAll(SELECTORS.debito.amounts).length;
}

/** Texto del cuadro de mensajes de OAF ("Saved Successfully...", errores), '' si no hay. */
export function mensajes() {
  return (el(SELECTORS.mensajes)?.textContent || '').replace(/\s+/g, ' ').trim();
}

// Lo que GEVS dice cuando rechaza algo. Medido: "Please check and re-enter the
// invoice no. Invoice No Duplication with EVS Invoice. (Duplicate Voucher:...)".
// Los avisos operativos ("Saved Successfully", "Please click the reset button
// of approval info") no cuentan como error.
const ERROR_GEVS_RE = /\berror\b|duplicat|re-enter|invalid|not valid|cannot|no puede/i;

/** El mensaje de rechazo de GEVS en pantalla, o '' si no hay ninguno. */
export function mensajeDeError() {
  const texto = mensajes();
  return ERROR_GEVS_RE.test(texto) ? texto : '';
}
