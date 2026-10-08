// Credenciales incluidas en el build, cifradas (ver scripts/secretos.mjs).
// Importar SOLO desde el service worker: se descifran en memoria y nunca se
// guardan en storage, se loguean ni se mandan al popup (solo el UserID).

/* global __FSC_EMBEBIDO__ */

// Mismo valor que AAD en scripts/secretos.mjs.
const AAD = 'ext-lge-cl:falabella-sellercenter:v1';

const blob = typeof __FSC_EMBEBIDO__ !== 'undefined' ? __FSC_EMBEBIDO__ : null;

let cache = null;

const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Descifra un blob de cifrarSecreto(). Exportada para los tests. */
export async function descifrar(secreto) {
  const mascara = bytes(secreto.a);
  const clave = bytes(secreto.d).map((b, i) => b ^ mascara[i]);
  const key = await crypto.subtle.importKey('raw', clave, { name: 'AES-GCM' }, false, ['decrypt']);
  const plano = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes(secreto.b), additionalData: new TextEncoder().encode(AAD) },
    key,
    bytes(secreto.c),
  );
  return JSON.parse(new TextDecoder().decode(plano));
}

/** {userId, apiKey} incluidas en el build, o null. */
export function credencialesEmbebidas() {
  if (!blob) return Promise.resolve(null);
  cache ??= descifrar(blob).catch(() => null);
  return cache;
}
