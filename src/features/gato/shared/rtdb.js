// Cliente minimo de Firebase Realtime Database via su API REST.
//
// No usamos el SDK de Firebase: el CSP estricto de la extension
// (`script-src 'self'`) impediria cargarlo y ademas inflaria el bundle. Las
// reglas de la base son abiertas (read/write true en presence/matchmaking/
// games), asi que no hace falta token de auth: basta apuntar a `<path>.json`.
//
// Operaciones: get (GET), set (PUT), update (PATCH), push (POST), remove
// (DELETE). Todo devuelve el JSON parseado (o null). Los errores se propagan
// como Error con el status para que el caller decida.

import { RTDB_BASE } from '../constants.js';

function urlFor(path) {
  const clean = String(path || '').replace(/^\/+|\/+$/g, '');
  return `${RTDB_BASE}/${clean}.json`;
}

async function request(path, { method = 'GET', body } = {}) {
  const init = { method, cache: 'no-store' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(urlFor(path), init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RTDB ${method} ${path} -> ${res.status} ${text}`.trim());
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Lee un nodo. Devuelve el valor o null si no existe. */
export function rget(path) {
  return request(path);
}

/** Reemplaza el nodo completo (PUT). */
export function rset(path, value) {
  return request(path, { method: 'PUT', body: value });
}

/** Mezcla campos en el nodo (PATCH). */
export function rupdate(path, partial) {
  return request(path, { method: 'PATCH', body: partial });
}

/** Crea un hijo con key autogenerada (POST). Devuelve { name }. */
export function rpush(path, value) {
  return request(path, { method: 'POST', body: value });
}

/** Borra el nodo (DELETE). */
export function rremove(path) {
  return request(path, { method: 'DELETE' });
}

// --- Concurrencia optimista (ETags) -----------------------------------------
// RTDB REST permite lecturas con ETag (`X-Firebase-ETag: true`) y escrituras
// condicionales (`if-match`). Es la unica primitiva de concurrencia sin SDK:
// la usamos para "reclamar" de forma atomica el slot de un jugador al retarlo y
// evitar que dos retos simultaneos pisen al mismo rival.

/** Lee un nodo devolviendo { value, etag }. */
export async function rgetWithEtag(path) {
  const res = await fetch(urlFor(path), {
    method: 'GET',
    cache: 'no-store',
    headers: { 'X-Firebase-ETag': 'true' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RTDB GET(etag) ${path} -> ${res.status} ${text}`.trim());
  }
  const etag = res.headers.get('ETag');
  const text = await res.text();
  let value;
  try { value = text ? JSON.parse(text) : null; } catch { value = null; }
  return { value, etag };
}

/**
 * Escribe condicionalmente: solo aplica si el ETag actual coincide con el dado.
 * @returns {Promise<{ ok: boolean, status: number }>} ok=false si 412 (otro
 *          escritor gano la carrera).
 */
export async function rsetIfMatch(path, value, etag) {
  const res = await fetch(urlFor(path), {
    method: 'PUT',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'if-match': etag || '*' },
    body: JSON.stringify(value),
  });
  if (res.status === 412) return { ok: false, status: 412 };
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RTDB PUT(if-match) ${path} -> ${res.status} ${text}`.trim());
  }
  return { ok: true, status: res.status };
}
