// Firma de las peticiones a la API de SellerCenter (HMAC-SHA256, WebCrypto).
// Pura salvo por `crypto.subtle`: corre igual en el SW, el popup y Node 22.

import { API } from '../constants.js';

/** Timestamp ISO 8601 sin milisegundos y con offset explicito: 2026-10-08T19:52:20+00:00 */
export function timestampApi(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

/** Query ordenada por nombre y codificada como la espera la firma (RFC 3986). */
export function queryOrdenada(params) {
  return Object.keys(params)
    .filter((k) => params[k] != null && params[k] !== '')
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(params[k])}`)
    .join('&');
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export async function hmacSha256Hex(clave, mensaje) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(mensaje));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * URL firmada para una Action.
 * @param {{userId:string, apiKey:string}} cred
 * @param {string} action
 * @param {Record<string,string>} [filtros]
 * @param {Date} [ahora]
 */
export async function urlFirmada(cred, action, filtros = {}, ahora = new Date()) {
  const params = {
    Action: action,
    Format: API.FORMAT,
    Timestamp: timestampApi(ahora),
    UserID: cred.userId,
    Version: API.VERSION,
    ...filtros,
  };
  const qs = queryOrdenada(params);
  const firma = await hmacSha256Hex(cred.apiKey, qs);
  return `${API.BASE_URL}?${qs}&Signature=${firma}`;
}
