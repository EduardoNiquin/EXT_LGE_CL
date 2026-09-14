// Modal "Add New Offer": cada producto hijo del soft bundle.
//
// A diferencia del resto del apartado Magento, este paso NO navega: el modal
// guarda por AJAX (`packagerule/packageproductitem/save`) y refresca la grilla
// de ofertas de la misma pantalla. Por eso todos los hijos de un bundle se
// crean en una sola carga de la pantalla de edicion.
//
// Es el punto donde mas falla la automatizacion, y por cuatro motivos que no se
// ven a simple vista (medidos contra el admin real):
//
//   1. Hay SEIS modales en el DOM desde que carga la pantalla, dentro de
//      `div.modals-wrapper`. NO se crean al pulsar el boton. Dos son de Page
//      Builder y uno se titula "Edit", asi que cualquier selector generico
//      (`.modal-slide`, `[data-role="modal"]`) engancha el que no es.
//   2. El contenido existe aunque el modal este cerrado: el ui-select del SKU,
//      el boton Save y todos los campos ya estan ahi. Esperar a que "exista el
//      formulario" es un falso positivo — se rellena un modal cerrado y no pasa
//      absolutamente nada.
//   3. `offsetParent` y la altura MIENTEN. El modal es `position: fixed`, asi
//      que `offsetParent === null` incluso abierto, y la altura da ~1305px
//      incluso cerrado. Ninguna comprobacion de visibilidad al uso sirve: la
//      unica senal fiable es la clase `show`.
//   4. El input del descuento tiene el MISMO `name` en los dos modales. Buscar
//      por `name` a nivel de documento devuelve el del modal equivocado.
//
// De ahi la regla de oro de este archivo: **todo se acota al elemento del
// modal** (`modal.querySelector(...)`), nunca a `document`.
//
// El "Delete" de cada oferta NUNCA se toca.

import { isAbortError, toMessage } from '../../../../../shared/errors/index.js';
import { clickEl, setInputValue } from '../../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../../shared/dom/wait.js';
import {
  BODY_MODAL_CLASS,
  MODAL_OPEN_CLASS,
  OFFER_FIELDS,
  OFFER_MODAL_CLASS,
  OFFER_MODAL_HINT,
  SELECTORS,
  TEXTS,
  TIMEOUTS,
} from '../../constants.js';
import { sameSku } from '../../parse-input.js';
import { selectProduct } from './advanced-select.js';
import { field, fieldVisible, readSwitch, setSwitch, setText, waitFieldVisible } from './fields.js';

/**
 * Clase comparable: sin guiones bajos ni medios y en minusculas. Magento arma
 * el nombre del modal concatenando la ruta del componente, y el separador
 * cambia segun la version; lo que no cambia es la secuencia de palabras.
 */
export function normalizeModalClass(value) {
  return String(value ?? '').toLowerCase().replace(/[_\-\s]+/g, '');
}

/**
 * True si `className` corresponde al modal pedido ('new' | 'edit').
 * Puro y con tests: es la pieza de la que depende todo lo demas.
 */
export function matchesModalKind(className, kind = 'new') {
  const normalized = normalizeModalClass(className);
  if (!normalized) return false;
  const key = kind === 'edit' ? 'EDIT' : 'NEW';
  const other = kind === 'edit' ? 'NEW' : 'EDIT';
  if (normalized.includes(OFFER_MODAL_CLASS[key])) return true;
  // Respaldo por si Magento reordena la clase larga: lo distintivo de cada uno,
  // exigiendo que no sea el otro modal (el de editar tambien dice "modal").
  return normalized.includes(OFFER_MODAL_HINT[key])
    && !normalized.includes(OFFER_MODAL_HINT[other]);
}

/**
 * La UNICA comprobacion valida de "modal abierto" (ver el motivo 3 de arriba).
 *
 * Se ignora el guion bajo con el que el admin prefija sus clases de estado, asi
 * que vale tanto `_show` como `show`. No es adorno: si esta comprobacion da
 * negativo, el modal parece no abrirse jamas y todo el paso muere esperando.
 */
export function isModalOpen(el) {
  if (!el?.classList) return false;
  return Array.from(el.classList).some((name) => name.replace(/^_+/, '') === MODAL_OPEN_CLASS);
}

/** Respaldo global: el admin marca el <body> mientras haya un modal abierto. */
export function anyModalOpen() {
  return Array.from(document.body?.classList || [])
    .some((name) => name.replace(/^_+/, '') === BODY_MODAL_CLASS);
}

/** Todos los modales montados, esten abiertos o no. */
function allModals() {
  const wrapper = document.querySelector(SELECTORS.modalsWrapper);
  return Array.from((wrapper || document).querySelectorAll(SELECTORS.anyModal));
}

/**
 * El modal de oferta, abierto o no. `openOnly` es lo que hay que pedir para
 * decidir si se puede operar sobre el.
 */
export function findOfferModal({ kind = 'new', openOnly = true } = {}) {
  const candidates = allModals().filter((modal) => matchesModalKind(modal.className, kind));
  const target = candidates.find((modal) => (openOnly ? isModalOpen(modal) : true));
  if (target) return target;

  // Ultimo recurso: un modal abierto que traiga el fieldset de la oferta. No se
  // usa como via principal porque los seis modales conviven en el DOM.
  return allModals().find((modal) => isModalOpen(modal) && modal.querySelector(SELECTORS.offerFieldset)) || null;
}

/**
 * Raiz de campos. Se prefiere el fieldset, pero el modal entero sirve igual: lo
 * que importa es no salir de el.
 */
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

  // El modal ya existe en el DOM: lo que se espera es que le pongan la clase de
  // estado (medido: ~23 ms para el de alta).
  try {
    return await waitFor(() => findOfferModal(), {
      signal,
      timeout: TIMEOUTS.MODAL,
      interval: 100,
      description: 'modal "New Package Offer" abierto',
    });
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    // El fallo mas probable aca no es que el modal no exista —existe desde que
    // carga la pantalla— sino que no se reconocio cual de los seis es, o que el
    // clic no lo abrio. Decirlo ahorra la ronda de preguntas.
    const montados = describeModals();
    const nuestro = montados.filter((modal) => modal.kind === 'nuevo').length;
    throw new Error(
      `El modal de oferta no se abrio. Hay ${montados.length} modal(es) montados, ${nuestro} reconocido(s) como "New Package Offer"`
      + `${anyModalOpen() ? ', y el <body> dice que SI hay un modal abierto (se abrio otro)' : ' y ninguno quedo abierto'}.`
      + ' Revisa `__extLgeCl.magentoSoftbundles.modals()`.',
      { cause: err },
    );
  }
}

/** Cierra el modal sin guardar (simulacion o recuperacion de un error). */
export async function closeOfferModal(modal, signal) {
  const target = modal || findOfferModal();
  if (!target || !isModalOpen(target)) return;
  const close = target.querySelector(SELECTORS.modalClose);
  if (close) clickEl(close);
  await waitFor(() => (!isModalOpen(target) ? true : null), {
    signal, timeout: 5000, interval: 100, description: 'cierre del modal de oferta',
  }).catch(() => null);
}

/**
 * Tabla "Customer group / Normal price / Discount rate (%)": la llena Magento
 * al elegir el SKU (`packageproductitem/loaddatabysku`, 3-4 s). Sin SKU elegido
 * NO existe ningun input de tasa dentro del modal, y por eso su aparicion es la
 * senal de que la carga del hijo termino.
 *
 * Acotado al modal, siempre: el mismo selector sobre `document` engancha
 * ademas `total-package-discount-rate-1`, que es "Discount on total package" y
 * esta fuera de los modales.
 */
async function waitPriceInputs(modal, signal) {
  return waitFor(() => {
    const inputs = Array.from(modal.querySelectorAll(SELECTORS.discountRate));
    return inputs.length ? inputs : null;
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
function setDiscountRate(inputs, value) {
  inputs.forEach((input) => setInputValue(input, String(value)));
  return inputs.length;
}

/** Errores de validacion que Magento pinta bajo los campos del modal. */
function readFieldErrors(modal) {
  return Array.from(modal.querySelectorAll('.admin__field-error, .mage-error'))
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => el.textContent.trim())
    .filter(Boolean);
}

/** El "Save" del modal, por texto: el "Add" de la tabla de marketing text no vale. */
function findSaveButton(modal) {
  const buttons = Array.from(modal.querySelectorAll(SELECTORS.modalSave));
  return buttons.find((button) => button.textContent.trim() === TEXTS.SAVE)
    || buttons.find((button) => /guardar|save/i.test(button.textContent.trim()))
    || null;
}

/** Valor numerico de un campo de texto del modal (NaN si esta vacio o no existe). */
function readNumber(root, index) {
  const input = field(root, index)?.querySelector('input');
  return Number(input?.value);
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
  const priceInputs = await waitPriceInputs(modal, signal);
  const discountRate = child.discountRate ?? config.discountRate;
  const groups = setDiscountRate(priceInputs, discountRate);

  onStep?.('offer-fields');
  setSwitch(root, OFFER_FIELDS.ACTIVE, config.childActive);
  setText(root, OFFER_FIELDS.LIMITED_QTY, config.limitedQty);
  setText(root, OFFER_FIELDS.PRIORITY, config.priority);

  // "Display discount rate of 0%" figura en No en el modal vacio pero Magento
  // lo enciende SOLO al terminar `loaddatabysku`. Por eso se escribe DESPUES de
  // la tabla de precios y se vuelve a verificar: una oferta creada sin tocarlo
  // quedo en Yes y hubo que editarla a mano.
  setSwitch(root, OFFER_FIELDS.ZERO_PERCENT, config.showZeroPercent);
  await sleep(150, signal);
  if (readSwitch(root, OFFER_FIELDS.ZERO_PERCENT) !== Boolean(config.showZeroPercent)) {
    setSwitch(root, OFFER_FIELDS.ZERO_PERCENT, config.showZeroPercent);
    if (readSwitch(root, OFFER_FIELDS.ZERO_PERCENT) !== Boolean(config.showZeroPercent)) {
      onInfo?.(`Aviso: no se pudo dejar "Display discount rate of 0%" en ${config.showZeroPercent ? 'Yes' : 'No'} para ${chosen}.`);
    }
  }

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

    // `main_discount_rate` y `discount_related` son el reparto del importe del
    // descuento entre padre e hijo, y tienen que sumar 100. Magento recalcula
    // el segundo solo, pero el recalculo llega tarde: en una captura del alta
    // manual viajo main=50 con discount_related=99. El servidor manda sobre
    // main, asi que esto es cinturon y tirantes — y sale gratis.
    await sleep(200, signal);
    const rest = 100 - Number(mainDiscountRate);
    if (Number.isFinite(rest) && readNumber(root, OFFER_FIELDS.DISCOUNT_RELATED) !== rest) {
      setText(root, OFFER_FIELDS.DISCOUNT_RELATED, String(rest));
    }
  }

  if (dryRun) {
    onInfo?.(`Simulacion: ${chosen} quedo listo con ${discountRate}% en ${groups} grupo(s)${wantsSplit ? ` y ${mainDiscountRate}% al principal` : ''}, no se guarda.`);
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
 * Espera a que el modal se cierre (pierde la clase `show`) y a que la oferta
 * aparezca en la grilla. El mensaje de exito de Magento es AJAX y se pisa entre
 * ofertas, asi que la senal fiable es la fila nueva.
 */
async function waitOfferSaved({ modal, sku, signal }) {
  try {
    await waitFor(() => (!isModalOpen(modal) ? true : null), {
      signal, timeout: TIMEOUTS.SAVE, interval: 150, description: 'guardado de la oferta',
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

/** True si el campo del % sobre el principal esta a la vista (para diagnostico). */
export function splitVisible() {
  const modal = findOfferModal();
  return modal ? fieldVisible(modalRoot(modal), OFFER_FIELDS.MAIN_DISCOUNT) : false;
}

/** Radiografia de los modales montados: que hay, cual es cual y cual esta abierto. */
export function describeModals() {
  return allModals().map((modal) => ({
    open: isModalOpen(modal),
    kind: matchesModalKind(modal.className, 'new') ? 'nuevo'
      : (matchesModalKind(modal.className, 'edit') ? 'editar' : 'ajeno'),
    title: modal.querySelector('.modal-title')?.textContent?.trim() || '',
    hasOfferFieldset: Boolean(modal.querySelector(SELECTORS.offerFieldset)),
    discountInputs: modal.querySelectorAll(SELECTORS.discountRate).length,
    className: modal.className,
  }));
}
