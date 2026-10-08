// Cliente de la API de SellerCenter: firma, reintentos y normalizacion de las
// respuestas (que a veces traen un objeto donde se espera una lista).

import { API } from '../constants.js';
import { urlFirmada } from './firma.js';
import { ExtError, isAbortError, toMessage } from '../../../shared/errors/index.js';
import { sleep } from '../../../shared/dom/wait.js';

// Codigos que no se arreglan reintentando. E007 = la API Key no es la de ese
// UserID (parece un fallo de firma, pero son credenciales cruzadas); E009 = sin
// acceso; E008 = Action invalida.
const ERRORES_FATALES = new Set(['7', '8', '9']);

export class ApiError extends ExtError {
  constructor(message, { fatal = false, ...opts } = {}) {
    super(message, opts);
    this.name = 'ApiError';
    this.fatal = fatal;
  }
}

function textoError(head) {
  const code = String(head?.ErrorCode ?? '');
  const msg = String(head?.ErrorMessage ?? 'Error de la API');
  if (code === '7') return `${msg}. Revisa que la API Key sea la de ese UserID (no la contrasena del portal).`;
  return msg;
}

/** Normaliza "uno o varios": undefined → [], objeto → [objeto]. */
export function comoLista(value) {
  if (value == null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Una peticion firmada con reintentos (se firma de nuevo en cada intento: el
 * Timestamp caduca). Devuelve `SuccessResponse`.
 */
export async function llamar(cred, action, filtros = {}, { signal } = {}) {
  if (!cred?.userId || !cred?.apiKey) {
    throw new ApiError('Faltan las credenciales de la API (UserID y API Key).', { code: 'sin-credenciales' });
  }
  let ultimo = null;
  for (let intento = 1; intento <= API.REINTENTOS; intento++) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    try {
      const url = await urlFirmada(cred, action, filtros);
      const timeout = AbortSignal.timeout(API.TIMEOUT_MS);
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const texto = await res.text();
      let json = null;
      try { json = JSON.parse(texto); } catch { /* no es JSON */ }

      if (json?.ErrorResponse) {
        const head = json.ErrorResponse.Head || {};
        const code = String(head.ErrorCode ?? '');
        ultimo = new ApiError(textoError(head), { code: `E${code}`, context: { action }, fatal: ERRORES_FATALES.has(code) });
      } else if (!res.ok) {
        const fatal = res.status >= 400 && res.status < 500 && res.status !== 429;
        ultimo = new ApiError(`La API respondio ${res.status}`, { code: `HTTP${res.status}`, context: { action }, fatal });
      } else if (json?.SuccessResponse) {
        return json.SuccessResponse;
      } else {
        ultimo = new ApiError('Respuesta inesperada de la API', { code: 'respuesta', context: { action } });
      }
    } catch (err) {
      if (signal?.aborted && isAbortError(err, signal)) throw err;
      ultimo = new ApiError(`Sin respuesta de la API: ${toMessage(err)}`, { code: 'red', cause: err });
    }
    if (ultimo?.fatal) throw ultimo;
    if (intento < API.REINTENTOS) await sleep(1000 * 2 ** (intento - 1), signal);
  }
  throw ultimo;
}

/**
 * Una pagina de GetOrders, ordenada por fecha de creacion (asi la paginacion no
 * se reordena cuando una orden se actualiza).
 * @returns {Promise<{total:number, orders:object[]}>}
 */
export async function getOrdersPage(cred, { createdAfter, createdBefore, offset = 0, limit = API.PAGE_SIZE }, opts) {
  const ok = await llamar(cred, 'GetOrders', {
    CreatedAfter: createdAfter,
    CreatedBefore: createdBefore,
    Limit: String(limit),
    Offset: String(offset),
    SortBy: 'created_at',
    SortDirection: 'ASC',
  }, opts);
  const total = Number(ok.Head?.TotalCount) || 0;
  const orders = comoLista(ok.Body?.Orders).map((x) => x?.Order ?? x).filter(Boolean);
  return { total, orders };
}

/**
 * Items de varias ordenes (hasta 200). Devuelve Map<OrderId, items[]>.
 * @param {Array<string|number>} orderIds  OrderId interno (no el OrderNumber).
 */
export async function getMultipleOrderItems(cred, orderIds, opts) {
  const ok = await llamar(cred, 'GetMultipleOrderItems', {
    OrderIdList: `[${orderIds.join(',')}]`,
  }, opts);
  const mapa = new Map();
  for (const o of comoLista(ok.Body?.Orders?.Order)) {
    mapa.set(String(o.OrderId), comoLista(o.OrderItems?.OrderItem));
  }
  return mapa;
}
