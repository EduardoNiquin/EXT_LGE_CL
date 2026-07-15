// Cliente HTTP de la API de Devoluciones SellerCenter.
//
// Todas las llamadas menos `ping` van con la cabecera X-Pairing-Token. Sin
// cookies ni CSRF; CORS abierto (host_permissions cubre 147.93.176.66). No
// pongas Content-Type en las subidas multipart: lo pone el navegador con su
// boundary.
//
// Cada función devuelve una forma uniforme { ok, status, data, error } salvo
// getFile, que devuelve la Response cruda (el binario se lee como blob).

import { TOKEN_HEADER } from './constants.js';
import { toMessage } from '../../../shared/errors/index.js';

function authHeaders(token) {
  return token ? { [TOKEN_HEADER]: token } : {};
}

/** Codifica una ruta con subcarpetas conservando las barras. */
function encodePath(path) {
  return String(path || '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

async function parseBody(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { return await res.json(); } catch { return null; }
  }
  try { return await res.text(); } catch { return null; }
}

/** Extrae un mensaje legible del cuerpo de error del servidor (JSON en español). */
function errorMessage(data, res) {
  if (data && typeof data === 'object') {
    return data.mensaje || data.message || data.error || `HTTP ${res.status}`;
  }
  if (typeof data === 'string' && data.trim()) return data.trim();
  return `HTTP ${res.status} ${res.statusText || ''}`.trim();
}

async function request(base, path, { method = 'GET', token, body, json, headers, signal } = {}) {
  const finalHeaders = { ...authHeaders(token), ...(headers || {}) };
  let finalBody = body;
  if (json !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(json);
  }
  let res;
  try {
    res = await fetch(`${base}${path}`, { method, headers: finalHeaders, body: finalBody, signal });
  } catch (err) {
    // Típico: certificado autofirmado no aceptado aún, o red caída.
    return { ok: false, status: 0, data: null, error: toMessage(err) };
  }
  const data = await parseBody(res);
  return {
    ok: res.ok,
    status: res.status,
    data,
    error: res.ok ? null : errorMessage(data, res),
  };
}

/**
 * Base64 de un Blob SIN reventar la pila. No uses
 * `btoa(String.fromCharCode(...new Uint8Array(buf)))` con trozos grandes
 * (§9): FileReader.readAsDataURL codifica en streaming y devolvemos lo que va
 * detrás de la coma del data URL.
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    fr.onerror = () => reject(fr.error || new Error('No se pudo leer el archivo'));
    fr.readAsDataURL(blob);
  });
}

/**
 * Prueba A de conectividad (§7) — subida clásica multipart. No necesita token y
 * no guarda nada: lo que llegue se descarta. Mira el campo `via` de la respuesta
 * (multipart / base64 / null) para decidir la vía de subida.
 */
export function ping(base, file = null) {
  let body;
  if (file) {
    body = new FormData();
    body.append('archivo', file, file.name);
  }
  return request(base, '/ping', { method: 'POST', body });
}

/** Prueba B de conectividad (§7) — el archivo como texto base64 en un JSON. */
export function pingBase64(base, { nombre, contenido }) {
  return request(base, '/ping', { method: 'POST', json: { nombre, contenido } });
}

/** Estado de emparejamiento + límites + órdenes en curso. */
export function getSession(base, token, signal) {
  return request(base, '/session', { token, signal });
}

/** Sube UN archivo del batch. `file.name` (sin extensión) = número de orden. */
export function uploadFile(base, token, batch, file, signal) {
  const body = new FormData();
  body.append('batch', batch);
  body.append('archivos[]', file, file.name);
  return request(base, '/batches', { method: 'POST', token, body, signal });
}

/** Lista todas las órdenes de la sesión. */
export function getOrders(base, token, signal) {
  return request(base, '/orders', { token, signal });
}

/** Manifiesto de guardado de una orden (409 si aún no está lista). */
export function getManifest(base, token, id, signal) {
  return request(base, `/orders/${id}/manifest`, { token, signal });
}

/** Descarga un archivo del manifiesto. Devuelve la Response cruda (blob). */
export function getFile(base, token, id, path, signal) {
  return fetch(`${base}/orders/${id}/files/${encodePath(path)}`, {
    headers: authHeaders(token),
    signal,
  });
}

/** Cierra la orden: el servidor BORRA sus archivos. Llamar sólo tras guardar. */
export function markSaved(base, token, id, signal) {
  return request(base, `/orders/${id}/saved`, { method: 'POST', token, signal });
}

/** Cancela una orden con motivo/mensaje (opcionales). */
export function cancelOrder(base, token, id, { motivo, mensaje } = {}, signal) {
  const body = new FormData();
  if (motivo) body.append('motivo', motivo);
  if (mensaje) body.append('mensaje', mensaje);
  return request(base, `/orders/${id}/cancel`, { method: 'POST', token, body, signal });
}

// -----------------------------------------------------------------------------
// Plan B (§9): subida troceada en base64. Mismos bytes que multipart, pero para
// el navegador es un JSON, no una subida de archivo. Más lenta; usar sólo si la
// Prueba A falla y la B pasa.
// -----------------------------------------------------------------------------

/** Abre una subida troceada. Devuelve { id, nombre, batch, recibidos, max_chunk_bytes }. */
export function openUpload(base, token, { nombre, batch }, signal) {
  return request(base, '/uploads', { method: 'POST', token, json: { nombre, batch }, signal });
}

/** Envía un trozo base64. `indice` empieza en 0 y va EN ORDEN (fuera de orden → 409). */
export function uploadChunk(base, token, id, { indice, contenido }, signal) {
  return request(base, `/uploads/${id}/chunk`, { method: 'POST', token, json: { indice, contenido }, signal });
}

/** Cierra la subida: concatena los trozos y crea la orden. Devuelve { orden }. */
export function completeUpload(base, token, id, signal) {
  return request(base, `/uploads/${id}/complete`, { method: 'POST', token, signal });
}

/** Aborta una subida a medias (el servidor libera el temporal). */
export function abortUpload(base, token, id, signal) {
  return request(base, `/uploads/${id}/abort`, { method: 'POST', token, signal });
}
