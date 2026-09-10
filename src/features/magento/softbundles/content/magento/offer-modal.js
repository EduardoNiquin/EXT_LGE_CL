// Modal "Add New Offer": cada producto hijo del soft bundle.
//
// A diferencia del resto del apartado Magento, este paso NO navega: el modal
// guarda por AJAX (`packagerule/packageproductitem/save`) y refresca la grilla
// de ofertas de la misma pantalla. Por eso todos los hijos de un bundle se
// crean en una sola carga de la pantalla de edicion.
//
// El "Delete" de cada oferta NUNCA se toca.

import { isAbortError, toMessage } from '../../../../../shared/errors/index.js';
import { clickEl, setInputValue } from '../../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../../shared/dom/wait.js';
import { OFFER_FIELDS, SELECTORS, TEXTS, TIMEOUTS } from '../../constants.js';
import { sameSku } from '../../parse-input.js';
import { selectProduct } from './advanced-select.js';
import { field, fieldVisible, setSwitch, setText, waitFieldVisible } from './fields.js';

function visible(el) {
  return Boolean(el) && el.offsetParent !== null;
}

/** El aside del modal de oferta (el que trae el fieldset `packageruleitem`). */
export function findOfferModal() {
  return Array.from(document.querySelectorAll('aside[data-role="modal"]'))
    .find((aside) => visible(aside) && aside.querySelector(SELECTORS.offerFieldset)) || null;
}

/** Raiz de campos del modal. */
function modalRoot(modal) {
  return modal.querySelector(SELECTORS.offerFieldset) || modal;
}

/**
 * Abre "Add New Offer" con el formulario limpio.
 *
 * Si quedo uno abierto de un intento anterior (un error a mitad de camino), se
 * cierra primero: Magento reinicia el modal al abrirlo, pero reusar el que ya
 * estaba arrastraria el descuento y los switches del hijo anterior.
 */
export async function openOfferModal({ signal, reuse = false } = {}) {
  const existing = findOfferModal();
  if (existing) {
    if (reuse) return existing;
    await closeOfferModal(existing, signal);
  }

  const button = await waitForElement(SELECTORS.addOfferButton, {
    signal, timeout: TIMEOUTS.PAGE, description: 'boton "Add New Offer"',
  });
  clickEl(button);

  return waitFor(() => findOfferModal(), {
    signal, timeout: TIMEOUTS.MODAL, interval: 150, description: 'modal de oferta',
  });
}

/**
 * Tabla "Customer group / Normal price / Discount rate (%)": la llena Magento
 * al elegir el SKU (`packageproductitem/loaddatabysku`). Sin ella no hay donde
 * escribir el descuento.
 */
async function waitPriceRows(root, signal) {
  return waitFor(() => {
    const rows = Array.from(root.querySelectorAll(SELECTORS.priceRows))
      .filter((row) => row.querySelector(SELECTORS.discountRate));
    return rows.length ? rows : null;
  }, {
    signal,
    timeout: TIMEOUTS.PRICE_TABLE,
    interval: 200,
    description: 'tabla de precios por grupo de clientes',
  });
}

/**
 * Escribe el mismo descuento en todos los grupos de clientes que traiga la
 * tabla. Hoy el catalogo chileno solo muestra B2C, pero si aparece otro grupo
 * dejarlo en 0 crearia una oferta sin descuento para esos clientes.
 */
function setDiscountRate(rows, value) {
  const applied = [];
  rows.forEach((row) => {
    const input = row.querySelector(SELECTORS.discountRate);
    if (!input) return;
    setInputValue(input, String(value));
    applied.push(row.querySelector('td')?.textContent?.trim() || 'grupo');
  });
  return applied;
}

/** Errores de validacion que Magento pinta bajo los campos del modal. */
function readFieldErrors(modal) {
  return Array.from(modal.querySelectorAll('.admin__field-error, .mage-error'))
    .filter(visible)
    .map((el) => el.textContent.trim())
    .filter(Boolean);
}

function findSaveButton(modal) {
  return Array.from(modal.querySelectorAll(SELECTORS.offerSave))
    .find((button) => button.textContent.trim() === TEXTS.SAVE) || null;
}

/** SKU de las ofertas que ya figuran en la grilla de la pantalla de edicion. */
export function readOfferSkus() {
  return Array.from(document.querySelectorAll(SELECTORS.childSkuCell))
    .map((cell) => cell.textContent.trim())
    .filter(Boolean);
}

/**
 * Crea una oferta completa (abrir modal, llenar y guardar).
 *
 * @param {object} o
 * @param {{sku:string, discountRate:?string, mainDiscountRate:?string}} o.child
 * @param {object} o.config   configuracion global del run.
 * @param {boolean} o.dryRun  llena el modal y lo cierra sin guardar.
 * @returns {Promise<{ chosenSku: string, saved: boolean }>}
 */
export async function createOffer({ child, config, dryRun, signal, onStep, onInfo }) {
  onStep?.('open-offer');
  const modal = await openOfferModal({ signal });
  const root = modalRoot(modal);

  onStep?.('offer-product');
  const { chosen } = await selectProduct(field(root, OFFER_FIELDS.PRODUCT_SKU), child.sku, { signal, onInfo });

  onStep?.('offer-discount');
  const rows = await waitPriceRows(root, signal);
  const discountRate = child.discountRate ?? config.discountRate;
  setDiscountRate(rows, discountRate);

  onStep?.('offer-fields');
  setSwitch(root, OFFER_FIELDS.ACTIVE, config.childActive);
  setSwitch(root, OFFER_FIELDS.ZERO_PERCENT, config.showZeroPercent);
  setText(root, OFFER_FIELDS.LIMITED_QTY, config.limitedQty);
  setText(root, OFFER_FIELDS.PRIORITY, config.priority);

  // Los textos promocionales solo existen si su switch esta encendido.
  if (config.promotionText) {
    setSwitch(root, OFFER_FIELDS.SHOW_TEXT, true);
    await waitFieldVisible(root, OFFER_FIELDS.TEXT, { signal, timeout: 3000 }).catch(() => null);
    setText(root, OFFER_FIELDS.TEXT, config.promotionText);
  }
  if (config.promotionDesc) {
    setSwitch(root, OFFER_FIELDS.SHOW_DESC, true);
    await waitFieldVisible(root, OFFER_FIELDS.DESC, { signal, timeout: 3000 }).catch(() => null);
    setText(root, OFFER_FIELDS.DESC, config.promotionDesc);
  }

  // El % que se reparte al producto principal solo aparece con el split
  // encendido; el campo exige un valor entre 1 y 99.
  const mainDiscountRate = child.mainDiscountRate ?? config.mainDiscountRate;
  const wantsSplit = Boolean(config.split) && Boolean(mainDiscountRate);
  setSwitch(root, OFFER_FIELDS.SPLIT, wantsSplit);
  if (wantsSplit) {
    onStep?.('offer-split');
    await waitFieldVisible(root, OFFER_FIELDS.MAIN_DISCOUNT, { signal, timeout: 5000 });
    setText(root, OFFER_FIELDS.MAIN_DISCOUNT, mainDiscountRate);
  }

  if (dryRun) {
    onInfo?.(`Simulacion: ${chosen} quedo listo con ${discountRate}%${wantsSplit ? ` y ${mainDiscountRate}% al principal` : ''}, no se guarda.`);
    await closeOfferModal(modal, signal);
    return { chosenSku: chosen, saved: false };
  }

  onStep?.('offer-save');
  const save = findSaveButton(modal);
  if (!save) throw new Error('No se encontro el boton "Save" del modal de oferta.');
  document.activeElement?.blur?.();
  clickEl(save);

  await waitOfferSaved({ modal, sku: chosen, signal });
  return { chosenSku: chosen, saved: true };
}

/**
 * Espera el cierre del modal y la aparicion de la oferta en la grilla. El
 * mensaje de exito de Magento es AJAX y se pisa entre ofertas, asi que la
 * senal fiable es la fila nueva.
 */
async function waitOfferSaved({ modal, sku, signal }) {
  try {
    await waitFor(() => (!visible(modal) ? true : null), {
      signal, timeout: TIMEOUTS.SAVE, interval: 200, description: 'guardado de la oferta',
    });
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    const errors = readFieldErrors(modal);
    throw new Error(errors.length
      ? `El modal no se cerro al guardar: ${errors.join(' | ')}`
      : `El modal no se cerro al guardar (${toMessage(err)}). Revisa si algun campo obligatorio quedo vacio.`,
    { cause: err });
  }

  await waitFor(() => (readOfferSkus().some((value) => sameSku(value, sku)) ? true : null), {
    signal, timeout: TIMEOUTS.GRID, interval: 300, description: `oferta ${sku} en la grilla`,
  });
  await sleep(200, signal);
}

/** Cierra el modal sin guardar (simulacion o recuperacion de un error). */
export async function closeOfferModal(modal, signal) {
  const target = modal || findOfferModal();
  if (!target) return;
  const close = target.querySelector('button.action-close, [data-role="closeBtn"]');
  if (close) clickEl(close);
  await waitFor(() => (!visible(target) ? true : null), {
    signal, timeout: 5000, interval: 150, description: 'cierre del modal de oferta',
  }).catch(() => null);
}

/** True si el campo del % sobre el principal esta a la vista (para diagnostico). */
export function splitVisible() {
  const modal = findOfferModal();
  return modal ? fieldVisible(modalRoot(modal), OFFER_FIELDS.MAIN_DISCOUNT) : false;
}
