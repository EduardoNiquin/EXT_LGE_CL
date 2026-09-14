// Formulario del package rule (pantalla "New Package" y la de edicion).
//
// Solo se tocan los campos que la configuracion del popup define; el resto
// queda como lo deja Magento. Los unicos botones que se pulsan aca son
// "Save and Continue Edit" y "Save": "Delete" NUNCA.

import { isAbortError } from '../../../../../shared/errors/index.js';
import { sleep, waitFor, waitForElement } from '../../../../../shared/dom/wait.js';
import { PARENT_FIELDS, SELECTORS, TIMEOUTS } from '../../constants.js';
import { hasLoadedOptions, primeOptions, selectProduct } from './advanced-select.js';
import {
  field,
  optionLabels,
  selectOptionByLabel,
  setDateTime,
  setSwitch,
  setText,
} from './fields.js';

/** Raiz del formulario del padre; se usa como scope de todos los `data-index`. */
export function formRoot() {
  return document.querySelector(SELECTORS.storeSelect)?.closest('.admin__fieldset')
    || document.querySelector('[data-index="general"]')
    || document;
}

export function waitForParentForm({ signal } = {}) {
  return waitForElement(SELECTORS.storeSelect, {
    signal, timeout: TIMEOUTS.PAGE, description: 'formulario del package rule',
  });
}

/**
 * Completa el formulario del padre.
 * @returns {Promise<{ chosenSku: string }>}
 */
export async function fillParentForm({ parentSku, config, signal, onStep, onInfo }) {
  await waitForParentForm({ signal });
  const root = formRoot();

  // "Apply To": store view. Es campo obligatorio y sin el, Magento rechaza el
  // guardado con "This is a required field".
  onStep?.('store-view');
  const select = document.querySelector(SELECTORS.storeSelect);
  const storeView = config.storeView || '';
  if (!selectOptionByLabel(select, storeView)) {
    throw new Error(`No se encontro el store view "${storeView}" en "Apply To" (opciones: ${optionLabels(select).join(', ') || 'ninguna'}).`);
  }

  // "Main Product" no trae nada hasta que el formulario pide su lote de
  // productos para el store view recien elegido. Teclear antes de eso devuelve
  // una lista vacia, y como el filtro es local no hay peticion que esperar
  // despues: el SKU simplemente "no existe".
  onStep?.('store-ready');
  const productField = field(root, PARENT_FIELDS.PRODUCT_SKU);
  await waitForProductOptions(productField, { signal, onInfo });

  onStep?.('main-product');
  const { chosen, forced } = await selectProduct(productField, parentSku, {
    signal,
    onInfo,
    // El selector del padre filtra en memoria y esconde los productos que ya
    // tienen regla: que no aparezca no prueba nada, hay que poder inyectarlo.
    force: true,
    remote: false,
  });

  onStep?.('parent-fields');
  setText(root, PARENT_FIELDS.DESCRIPTIONS, config.descriptions);
  setSwitch(root, PARENT_FIELDS.ACTIVE, config.active);
  setSwitch(root, PARENT_FIELDS.COMBINABLE, config.combinable);
  setSwitch(root, PARENT_FIELDS.OUT_OF_STOCK, config.showOutOfStock);
  setText(root, PARENT_FIELDS.MAX_RELATED, config.maxRelated);

  // Las fechas van al final: el datepicker se abre al enfocar y taparia los
  // campos de arriba mientras se llenan. "Active From" es obligatorio; "Active
  // To" vacio significa sin fecha de fin.
  onStep?.('dates');
  const from = await setDateTime(root, {
    dateIndex: PARENT_FIELDS.FROM_DATE,
    timeIndex: PARENT_FIELDS.FROM_TIME,
    date: config.fromDate,
    time: config.fromTime,
  }, { signal });
  if (config.fromDate && !from.date) {
    throw new Error('No se encontro el campo "Active From" del package rule (es obligatorio).');
  }
  await setDateTime(root, {
    dateIndex: PARENT_FIELDS.TO_DATE,
    timeIndex: PARENT_FIELDS.TO_TIME,
    date: config.toDate,
    time: config.toTime,
  }, { signal });

  return { chosenSku: chosen, forced };
}

/**
 * Espera a que el desplegable de "Main Product" tenga opciones. Se le da un
 * empujon abriendolo (el widget pide su lote al desplegarse) y se sigue
 * adelante si igual no llegan: un SKU forzado no las necesita.
 */
async function waitForProductOptions(productField, { signal, onInfo } = {}) {
  if (!productField || hasLoadedOptions(productField)) return true;
  await sleep(300, signal);
  await primeOptions(productField, { signal });
  try {
    await waitFor(() => (hasLoadedOptions(productField) ? true : null), {
      signal,
      timeout: TIMEOUTS.STORE_READY,
      interval: 250,
      description: 'catalogo de "Main Product"',
    });
    return true;
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    onInfo?.('"Main Product" no llego a cargar su lista de productos; se intenta con el SKU tal cual.');
    return false;
  }
}

/** Pulsa "Save and Continue Edit" (Magento navega a la pantalla de edicion). */
export function clickSaveAndContinue() {
  const button = document.querySelector(SELECTORS.saveAndContinue);
  if (!button) throw new Error('No se encontro el boton "Save and Continue Edit".');
  clearBeforeUnload();
  button.click();
  return true;
}

/** Pulsa "Save" (Magento vuelve al listado). */
export function clickSave() {
  const button = document.querySelector(SELECTORS.save);
  if (!button) throw new Error('No se encontro el boton "Save" del package rule.');
  clearBeforeUnload();
  document.activeElement?.blur?.();
  button.click();
  return true;
}

/**
 * El formulario cuelga un `onbeforeunload`; con el puesto, el guardado abre un
 * confirm del navegador y el proceso se queda esperando una navegacion que
 * nunca llega (mismo cuidado que en lead-times y global shipping rules).
 */
function clearBeforeUnload() {
  try { window.onbeforeunload = null; } catch { /* no-op */ }
}
