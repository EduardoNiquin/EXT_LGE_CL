// Comparacion entre lo que el usuario busca y lo que trae cada transaccion.
// Puro y testeable: el flow solo le pasa las transacciones ya parseadas.

import { GATEWAY, SEARCH_FIELDS } from './constants.js';
import { normalizeKey, readField } from './transactions.js';

/**
 * Config del popup → criterios efectivos.
 * Una pasarela marcada sin ningun campo lleno significa "todas las de esa
 * pasarela"; ninguna pasarela marcada significa "capturar todo" (el modo util
 * para llevarse el CSV completo de transacciones del rango).
 */
export function buildCriteria(config = {}) {
  const gateways = Array.isArray(config.gateways) ? config.gateways : [];
  return gateways
    .filter((gateway) => SEARCH_FIELDS[gateway])
    .map((gateway) => {
      const raw = config.fields?.[gateway] || {};
      const fields = SEARCH_FIELDS[gateway]
        .map((field) => ({ ...field, value: String(raw[field.key] ?? '').trim() }))
        .filter((field) => field.value !== '');
      return { gateway, fields };
    });
}

/** Resumen legible de lo que se esta buscando (para la UI y el registro). */
export function describeCriteria(criteria = []) {
  if (!criteria.length) return 'Sin filtros: se capturan todas las transacciones del rango.';
  return criteria
    .map(({ gateway, fields }) => {
      const label = gateway === GATEWAY.WEBPAY ? 'WebPay' : 'MercadoPago';
      if (!fields.length) return `${label}: cualquier transaccion`;
      return `${label}: ${fields.map((field) => `${field.label}=${field.value}`).join(', ')}`;
    })
    .join(' | ');
}

/** Solo los digitos, para comparar montos e IDs escritos con puntos o simbolos. */
export function digitsOf(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

/**
 * Compara lo tecleado contra lo que dice la nota. Es tolerante a proposito: el
 * usuario copia el dato de una planilla, con puntos de miles o espacios de mas.
 * Exacto primero; si ambos lados son numericos se comparan solo los digitos
 * (con ceros a la izquierda ignorados, que es como se pega un "002187"); y como
 * ultima salida, que el valor de la nota contenga lo buscado.
 */
export function valueMatches(needle, hayValue, { numeric = false } = {}) {
  const wanted = normalizeKey(needle);
  const found = normalizeKey(hayValue);
  if (!wanted) return true;
  if (!found) return false;
  if (wanted === found) return true;

  const wantedDigits = digitsOf(wanted);
  const foundDigits = digitsOf(found);
  const bothNumeric = wantedDigits && foundDigits
    && (numeric || (/^\d[\d.,\s$]*$/.test(wanted) && /^\d[\d.,\s$]*$/.test(found)));
  if (bothNumeric && stripLeadingZeros(wantedDigits) === stripLeadingZeros(foundDigits)) return true;

  return found.includes(wanted);
}

/** ¿Esta transaccion cumple TODOS los campos pedidos para su pasarela? */
export function transactionMatches(transaction, criteria = []) {
  if (!criteria.length) return true;
  const criterion = criteria.find((item) => item.gateway === transaction?.gateway);
  if (!criterion) return false;
  return criterion.fields.every((field) =>
    valueMatches(field.value, readField(transaction, field.noteKeys), { numeric: field.numeric }));
}

/**
 * Evalua una orden completa. Devuelve los indices de las transacciones que
 * coincidieron para poder marcarlas en el CSV, no solo un booleano.
 */
export function evaluateOrder(transactions = [], criteria = []) {
  const matchedIndexes = transactions
    .map((transaction, index) => (transactionMatches(transaction, criteria) ? index : -1))
    .filter((index) => index !== -1);
  return { matched: matchedIndexes.length > 0, matchedIndexes };
}

function stripLeadingZeros(value) {
  return String(value).replace(/^0+(?=\d)/, '');
}
