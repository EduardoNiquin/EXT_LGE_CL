// Driver del "multiselect avanzado" de Magento con el que se eligen los
// productos: el de "Main Product" en el formulario del padre y el de "Related
// Product SKU" dentro del modal de oferta.
//
// Se parecen pero se comportan AL REVES, y confundirlos es donde mas se atasca
// la automatizacion (medido contra el admin real, 2026-09-14):
//
//   | | Main Product (padre)        | Related Product SKU (hijo) |
//   |-|-----------------------------|----------------------------|
//   | Origen  | ~100 opciones precargadas | consulta al servidor en cada tecla |
//   | Buscar  | filtra SOLO lo ya cargado | POST searchrelatedproducts         |
//   | Oculta SKU ya usados | SI          | no                                 |
//
// Consecuencia para el padre: teclear un SKU que no vino en el lote inicial no
// lo trae nunca — no hay peticion que esperar. Por eso `force: true` cae al
// bridge del mundo MAIN, que inyecta la opcion en el componente Knockout
// (ver features/magento/content/bridge.js). El backend valida contra el
// catalogo, no contra el desplegable, asi que acepta el valor inyectado.

import { ExtError, isAbortError } from '../../../../../shared/errors/index.js';
import { clickEl } from '../../../../../shared/dom/events.js';
import { sleep, waitFor } from '../../../../../shared/dom/wait.js';
import { normalizeSku, sameSku } from '../../parse-input.js';
import { SELECTORS, TIMEOUTS } from '../../constants.js';
import { BRIDGE } from '../../../constants.js';
import { askBridge } from '../../../content/bridge-client.js';

/** El buscador de Magento no devolvio el producto: no existe o no tiene stock. */
export class SkuNotFoundError extends ExtError {
  constructor(sku, sample, detail = 'el producto no esta creado o no tiene stock') {
    super(`El buscador de Magento no encontro el SKU ${sku}: ${detail}.`, {
      code: 'sku-not-found',
      context: { sku, sample, detail },
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
 * Pide al bridge del mundo MAIN que inyecte el SKU en el componente Knockout.
 * El elemento se marca en el DOM (unico terreno comun entre los dos mundos) en
 * vez de mandar un selector: en la pantalla de edicion hay DOS `product_sku`
 * (el del padre y el del modal de oferta) y un selector los confundiria.
 *
 * Nunca lanza: si el bridge no esta, devuelve `{ applied: false }` y el que
 * llama reporta el error de SKU no encontrado de siempre.
 */
async function forceProduct(wrap, sku, { signal } = {}) {
  wrap.setAttribute(BRIDGE.TARGET_ATTR, '1');
  try {
    const answer = await askBridge(BRIDGE.OPS.FORCE_PRODUCT, { sku }, { signal });
    if (!answer.ok) return { applied: false, reason: answer.reason };
    return answer.result || { applied: false, reason: 'el bridge no devolvio resultado' };
  } finally {
    wrap.removeAttribute(BRIDGE.TARGET_ATTR);
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
 * @param {object}  [opts]
 * @param {boolean} [opts.force]  fallback por bridge cuando el filtro no lo
 *   trae. Solo para "Main Product": el del hijo si consulta al servidor, y ahi
 *   "no aparece" significa de verdad que no existe.
 * @param {boolean} [opts.remote] true = el widget consulta al servidor (hijo).
 * @returns {Promise<{ chosen: string, exact: boolean, forced: boolean }>}
 */
export async function selectProduct(field, sku, { signal, onInfo, force = false, remote = true } = {}) {
  const wrap = wrapOf(field);
  if (!wrap) throw new Error('No se encontro el buscador de productos en el formulario.');

  // Ya elegido (reintento sobre el mismo formulario): no se vuelve a tocar.
  if (sameSku(selectedText(wrap), sku)) {
    return { chosen: selectedText(wrap), exact: true, forced: false };
  }

  await openMenu(wrap, signal);

  const input = wrap.querySelector(SELECTORS.advancedSearch);
  if (!input) throw new Error('No se encontro el campo de busqueda del selector de productos.');

  const query = normalizeSku(sku);
  typeSearch(input, query);

  // El widget del hijo tiene que ir y volver del servidor en cada tecla; el del
  // padre solo filtra en memoria, asi que esperar los 15s completos por un SKU
  // que no esta cargado es tiempo tirado en cada linea de la carga masiva.
  const timeout = remote ? TIMEOUTS.SKU_SEARCH : TIMEOUTS.SKU_FILTER;

  let candidates = [];
  try {
    await waitFor(() => {
      candidates = optionElements(wrap);
      return candidates.find((option) => sameSku(option.text, sku)) || null;
    }, {
      signal,
      timeout,
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
    }
  }

  // Nada en la lista. Para el padre eso no prueba que el SKU no exista: puede
  // estar fuera del lote cargado, o escondido por tener ya un package rule.
  if (!target) {
    if (force) {
      const forced = await forceProduct(wrap, sku, { signal });
      if (forced.applied) {
        await closeMenu(wrap, signal);
        onInfo?.(`"${sku}" no figuraba en el desplegable y se inyecto directamente (Magento lo valida al guardar).`);
        // El componente marca su propio error de validacion; con el puesto, el
        // formulario no guarda y conviene verlo ahora y no al final.
        if (forced.error) onInfo?.(`Aviso: el campo "Main Product" quedo con el error "${forced.error}".`);
        return { chosen: forced.value || sku, exact: false, forced: true };
      }
      await closeMenu(wrap, signal);
      throw new SkuNotFoundError(
        sku,
        candidates.slice(0, 5).map((option) => option.text),
        `el desplegable no lo lista y tampoco se pudo inyectar (${forced.reason || 'el bridge no respondio'}). `
        + 'Ese selector solo ofrece productos sin package rule y filtra sobre lo que ya tiene cargado',
      );
    }
    await closeMenu(wrap, signal);
    throw new SkuNotFoundError(sku, candidates.slice(0, 5).map((option) => option.text));
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
  return { chosen, exact, forced: false };
}

/**
 * True si el widget ya tiene opciones que ofrecer. "Main Product" queda inerte
 * hasta que se elige el store view en "Apply To": el formulario pide su lote de
 * productos recien entonces, y teclear antes no devuelve nada nunca.
 */
export function hasLoadedOptions(field) {
  const wrap = wrapOf(field);
  return Boolean(wrap) && optionElements(wrap).length > 0;
}

/** Abre el desplegable (se usa para forzar la carga inicial de opciones). */
export async function primeOptions(field, { signal } = {}) {
  const wrap = wrapOf(field);
  if (!wrap) return false;
  await openMenu(wrap, signal);
  return true;
}

/** SKU que el widget muestra como elegido (vacio si sigue en "Select..."). */
export function readSelectedProduct(field) {
  const text = selectedText(wrapOf(field));
  return /^select\.\.\.?$/i.test(text) ? '' : text;
}
