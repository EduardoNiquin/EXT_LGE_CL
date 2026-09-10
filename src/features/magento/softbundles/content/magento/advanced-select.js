// Driver del "multiselect avanzado" de Magento con el que se eligen los
// productos: el de "Main Product" en el formulario del padre y el de "Related
// Product SKU" dentro del modal de oferta.
//
// No es un <select>: es un widget Knockout que pide las opciones al servidor
// (`searchmainproductsbystore` / `searchrelatedproducts`) a medida que se
// escribe en su buscador. Por eso hay que abrirlo, teclear y ESPERAR a que
// aparezca la opcion; leerlo antes devuelve la lista de la busqueda anterior.

import { ExtError, isAbortError } from '../../../../../shared/errors/index.js';
import { clickEl } from '../../../../../shared/dom/events.js';
import { sleep, waitFor } from '../../../../../shared/dom/wait.js';
import { normalizeSku, sameSku } from '../../parse-input.js';
import { SELECTORS, TIMEOUTS } from '../../constants.js';

/** El buscador de Magento no devolvio el producto: no existe o no tiene stock. */
export class SkuNotFoundError extends ExtError {
  constructor(sku, sample) {
    super(`El buscador de Magento no encontro el SKU ${sku}: el producto no esta creado o no tiene stock.`, {
      code: 'sku-not-found',
      context: { sku, sample },
    });
    this.name = 'SkuNotFoundError';
    this.sku = sku;
    this.sample = sample;
  }
}

/** Varias opciones contienen el texto buscado y ninguna coincide exactamente. */
export class AmbiguousSkuError extends ExtError {
  constructor(sku, sample) {
    super(`"${sku}" coincide con ${sample.length} productos y ninguno es exacto: ${sample.slice(0, 5).join(', ')}`, {
      code: 'sku-ambiguous',
      context: { sku, sample },
    });
    this.name = 'AmbiguousSkuError';
    this.sku = sku;
    this.sample = sample;
  }
}

function wrapOf(field) {
  return field?.querySelector(SELECTORS.advancedWrap) || field?.closest(SELECTORS.advancedWrap) || null;
}

function selectedText(wrap) {
  return wrap?.querySelector(SELECTORS.advancedSelected)?.textContent?.trim() || '';
}

function optionElements(wrap) {
  return Array.from(wrap.querySelectorAll(SELECTORS.advancedOption))
    .map((label) => ({ label, text: label.textContent.trim() }))
    .filter((option) => option.text);
}

/**
 * Teclea en el buscador del widget. Knockout lo bindea con
 * `valueUpdate: 'afterkeydown'`, asi que el valor tiene que estar puesto ANTES
 * del keydown; ademas escucha `keydown` para disparar la busqueda.
 */
function typeSearch(input, text) {
  input.focus();
  input.value = text;
  const key = text.slice(-1) || 'Unidentified';
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function openMenu(wrap, signal) {
  if (wrap.classList.contains('_active')) return;
  const toggle = wrap.querySelector(SELECTORS.advancedToggle)
    || wrap.querySelector(SELECTORS.advancedSelected);
  if (toggle) {
    clickEl(toggle);
    await sleep(200, signal);
  }
}

async function closeMenu(wrap, signal) {
  if (!wrap.classList.contains('_active')) return;
  const toggle = wrap.querySelector(SELECTORS.advancedToggle);
  if (toggle) {
    clickEl(toggle);
    await sleep(150, signal);
  }
  // El widget cierra tambien con outerClick; si el toggle no lo cerro, un click
  // fuera lo hace sin tocar ningun campo del formulario.
  if (wrap.classList.contains('_active')) {
    clickEl(document.body);
    await sleep(150, signal);
  }
}

/**
 * Elige un producto en el widget.
 *
 * El usuario pega el SKU como lo tiene en su planilla ("RNC7", "86MRGB95BSA.AWH")
 * y Magento devuelve el del catalogo ("CL.RNC7.DCHLLLK"): por eso se acepta la
 * coincidencia exacta sin el prefijo `CL.` y, si no la hay, una unica opcion.
 * Con varias candidatas se falla en vez de adivinar.
 *
 * @returns {Promise<{ chosen: string, exact: boolean }>}
 */
export async function selectProduct(field, sku, { signal, onInfo } = {}) {
  const wrap = wrapOf(field);
  if (!wrap) throw new Error('No se encontro el buscador de productos en el formulario.');

  // Ya elegido (reintento sobre el mismo formulario): no se vuelve a tocar.
  if (sameSku(selectedText(wrap), sku)) {
    return { chosen: selectedText(wrap), exact: true };
  }

  await openMenu(wrap, signal);

  const input = wrap.querySelector(SELECTORS.advancedSearch);
  if (!input) throw new Error('No se encontro el campo de busqueda del selector de productos.');

  const query = normalizeSku(sku);
  typeSearch(input, query);

  let candidates = [];
  try {
    await waitFor(() => {
      candidates = optionElements(wrap);
      const exact = candidates.find((option) => sameSku(option.text, sku));
      if (exact) return exact;
      // "0 options" sostenido es la respuesta del servidor, no un estado
      // intermedio: cortar ahi ahorra el timeout completo por cada SKU que no
      // existe, que es el caso que mas se repite en una carga masiva.
      return null;
    }, {
      signal,
      timeout: TIMEOUTS.SKU_SEARCH,
      interval: 200,
      description: `producto ${sku} en el buscador de Magento`,
    });
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    candidates = optionElements(wrap);
  }

  // Sin coincidencia exacta: una sola candidata se acepta (es el caso de pegar
  // el codigo corto), varias no.
  let target = candidates.find((option) => sameSku(option.text, sku));
  let exact = Boolean(target);
  if (!target) {
    const partial = candidates.filter((option) => normalizeSku(option.text).includes(query));
    if (partial.length === 1) {
      [target] = partial;
      onInfo?.(`"${sku}" se resolvio como ${partial[0].text} (unica coincidencia del buscador).`);
    } else if (partial.length > 1) {
      await closeMenu(wrap, signal);
      throw new AmbiguousSkuError(sku, partial.map((option) => option.text));
    } else {
      await closeMenu(wrap, signal);
      throw new SkuNotFoundError(sku, candidates.slice(0, 5).map((option) => option.text));
    }
  }

  const chosen = target.text;
  clickEl(target.label.querySelector('span') || target.label);
  try {
    await waitFor(() => sameSku(selectedText(wrap), chosen) || null, {
      signal, timeout: 5000, interval: 100, description: `seleccion de ${chosen}`,
    });
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    // Algunos temas cuelgan el handler del contenedor de la fila, no del label.
    clickEl(target.label.closest('.action-menu-item') || target.label);
    await waitFor(() => sameSku(selectedText(wrap), chosen) || null, {
      signal, timeout: 5000, interval: 100, description: `seleccion de ${chosen} (reintento)`,
    });
  }

  await closeMenu(wrap, signal);
  return { chosen, exact };
}

/** SKU que el widget muestra como elegido (vacio si sigue en "Select..."). */
export function readSelectedProduct(field) {
  const text = selectedText(wrapOf(field));
  return /^select\.\.\.?$/i.test(text) ? '' : text;
}
