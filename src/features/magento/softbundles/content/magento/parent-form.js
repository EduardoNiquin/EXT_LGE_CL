// Formulario del package rule (pantalla "New Package" y la de edicion).
//
// Solo se tocan los campos que la configuracion del popup define; el resto
// queda como lo deja Magento. Los unicos botones que se pulsan aca son
// "Save and Continue Edit" y "Save": "Delete" NUNCA.

import { waitForElement } from '../../../../../shared/dom/wait.js';
import { PARENT_FIELDS, SELECTORS, TIMEOUTS } from '../../constants.js';
import { selectProduct } from './advanced-select.js';
import {
  field,
  optionLabels,
  selectOptionByLabel,
  setDate,
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

  onStep?.('main-product');
  const { chosen } = await selectProduct(field(root, PARENT_FIELDS.PRODUCT_SKU), parentSku, { signal, onInfo });

  onStep?.('parent-fields');
  setText(root, PARENT_FIELDS.DESCRIPTIONS, config.descriptions);
  setSwitch(root, PARENT_FIELDS.ACTIVE, config.active);
  setSwitch(root, PARENT_FIELDS.COMBINABLE, config.combinable);
  setSwitch(root, PARENT_FIELDS.OUT_OF_STOCK, config.showOutOfStock);
  setText(root, PARENT_FIELDS.MAX_RELATED, config.maxRelated);

  // Las fechas van al final: el datepicker se abre al enfocar y taparia los
  // campos de arriba mientras se llenan.
  onStep?.('dates');
  await setDate(root, PARENT_FIELDS.FROM_DATE, config.fromDate, { signal });
  setText(root, PARENT_FIELDS.FROM_TIME, config.fromTime);
  await setDate(root, PARENT_FIELDS.TO_DATE, config.toDate, { signal });
  setText(root, PARENT_FIELDS.TO_TIME, config.toTime);

  return { chosenSku: chosen };
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
