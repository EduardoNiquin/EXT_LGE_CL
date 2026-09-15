// Normaliza el pago de una orden a un modelo unico, cualquiera sea la pasarela.
// Puro: recibe el item del grid y devuelve campos planos para el CSV.
//
// Regla de oro (docs/intrucciones.md seccion 6): clasificar por `payment_method`.
// `payment_method_type` NO sirve — Webpay dice "BankTransfer" siendo tarjeta de
// credito.
//
// Las variaciones que rompen parsers y que estan contempladas aca:
//   - MercadoPago con saldo (`account_money`) manda `card` como ARRAY VACIO.
//   - `marketplace_payment` no trae ningun campo de pago: los datos utiles son
//     las columnas de marketplace del propio grid.
//   - `additional_information` es un string JSON, y adentro hay mas JSON.
//   - Un metodo desconocido devuelve el modelo vacio, nunca una excepcion.

import { GATEWAY, GATEWAY_LABEL, PAYMENT_METHOD, TRANSBANK_PAYMENT_TYPE } from './constants.js';
import { parseJsonField, stripHtml } from './grid-parse.js';

const EMPTY = {
  gateway: GATEWAY.UNKNOWN,
  gatewayLabel: GATEWAY_LABEL[GATEWAY.UNKNOWN],
  methodTitle: '',
  txId: '',
  authCode: '',
  brand: '',
  last4: '',
  installments: '',
  paymentTypeLabel: '',
  pgStatus: '',
  pgStatusDetail: '',
  amount: '',
  fee: '',
  netAmount: '',
  threeDs: '',
  reference: '',
};

/**
 * @param {object} item  una orden tal como la devuelve el grid
 * @returns {typeof EMPTY}
 */
export function normalizePayment(item) {
  const order = item || {};
  const info = parseJsonField(order.additional_information) || {};
  const method = stripHtml(order.payment_method || order.method || '');
  const base = { ...EMPTY, methodTitle: text(info.method_title) };

  if (method === PAYMENT_METHOD.WEBPAY) return webpay(base, info);
  if (method === PAYMENT_METHOD.MP_BASIC || method === PAYMENT_METHOD.MP_GLOBAL) {
    return mercadopago(base, info);
  }
  if (method === PAYMENT_METHOD.MARKETPLACE) return marketplace(base, info, order);

  // Metodo no mapeado: se rescata lo que se pueda sin inventar nada.
  const response = asObject(info.paymentResponse);
  if (response) return mercadopago(base, info);
  return { ...base, pgStatus: text(info.status), pgStatusDetail: text(info.status_detail) };
}

// -----------------------------------------------------------------------------
// Transbank / Webpay
// -----------------------------------------------------------------------------

function webpay(base, info) {
  const raw = asObject(info.raw_details_info) || {};
  const card = asObject(raw.cardDetail) || {};
  const typeCode = text(raw.paymentTypeCode);
  return {
    ...base,
    gateway: GATEWAY.WEBPAY,
    gatewayLabel: GATEWAY_LABEL[GATEWAY.WEBPAY],
    // Webpay no da un id de pago: lo que identifica la transaccion es la sesion.
    txId: text(raw.sessionId),
    authCode: text(raw.authorizationCode),
    last4: text(raw.cardNumber || card.card_number),
    installments: number(raw.installmentsNumber),
    paymentTypeLabel: typeCode ? (TRANSBANK_PAYMENT_TYPE[typeCode] || typeCode) : '',
    pgStatus: text(raw.status),
    pgStatusDetail: raw.responseCode === undefined || raw.responseCode === null
      ? ''
      : `responseCode ${raw.responseCode}`,
    amount: number(raw.amount),
    // `vci` es el resultado de la autenticacion 3DS.
    threeDs: text(raw.vci),
    reference: text(raw.buyOrder),
  };
}

// -----------------------------------------------------------------------------
// MercadoPago (pasarela y tarjeta incrustada comparten la forma de la respuesta)
// -----------------------------------------------------------------------------

function mercadopago(base, info) {
  const response = asObject(info.paymentResponse) || {};
  // Con `account_money` esto llega como array vacio en vez de objeto.
  const card = asObject(response.card) || {};
  const holderMethod = asObject(response.payment_method) || {};
  const details = asObject(response.transaction_details) || {};

  return {
    ...base,
    gateway: GATEWAY.MERCADOPAGO,
    gatewayLabel: GATEWAY_LABEL[GATEWAY.MERCADOPAGO],
    txId: text(response.id ?? info.payment_id ?? info.id),
    authCode: text(response.authorization_code),
    brand: text(response.payment_method_id || info.payment_method),
    last4: text(card.last_four_digits),
    installments: number(response.installments ?? info.installments),
    paymentTypeLabel: text(response.payment_type_id),
    pgStatus: text(response.status ?? info.status ?? info.pg_status),
    pgStatusDetail: text(response.status_detail ?? info.status_detail),
    amount: number(response.transaction_amount),
    fee: sumFees(response.fee_details),
    netAmount: number(details.net_received_amount),
    threeDs: text(asObject(holderMethod.data)?.threeds ?? info.three_ds_verification),
    reference: text(response.external_reference),
  };
}

/** Las comisiones vienen como lista; al CSV va el total. */
function sumFees(feeDetails) {
  if (!Array.isArray(feeDetails) || !feeDetails.length) return '';
  const total = feeDetails.reduce((acc, fee) => {
    const amount = Number(asObject(fee)?.amount);
    return Number.isFinite(amount) ? acc + amount : acc;
  }, 0);
  return total ? String(total) : '';
}

// -----------------------------------------------------------------------------
// Marketplace (LG no procesa el pago)
// -----------------------------------------------------------------------------

function marketplace(base, info, order) {
  return {
    ...base,
    gateway: GATEWAY.MARKETPLACE,
    gatewayLabel: GATEWAY_LABEL[GATEWAY.MARKETPLACE],
    methodTitle: base.methodTitle || text(info.payment_name),
    brand: stripHtml(order.marketplace_name),
    // El unico identificador util es el numero de orden del marketplace.
    reference: stripHtml(order.marketplace_order_id) || text(info.reference_code),
    txId: text(info.reference_code),
  };
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Objeto de verdad: descarta null, primitivos y el array vacio de MercadoPago. */
function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function text(value) {
  if (value === null || value === undefined || typeof value === 'object') return '';
  return String(value).trim();
}

function number(value) {
  if (value === null || value === undefined || value === '') return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : '';
}

export const __test = { asObject, sumFees };
