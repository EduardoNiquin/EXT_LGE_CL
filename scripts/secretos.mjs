// Secretos embebidos en el build (hoy: credenciales de la API de Falabella
// SellerCenter). El texto plano vive en `keys/` (gitignored) y NUNCA entra al
// repo ni al bundle: en cada build se cifra con AES-256-GCM y una clave
// aleatoria nueva, partida en dos mitades XOR. Solo el service worker lo
// descifra, en memoria.
//
// Limite honesto: la clave para descifrar viaja en el mismo paquete (la
// extension la necesita), asi que esto frena a quien abra el ZIP o haga grep,
// no a alguien que depure el service worker.

import { createCipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

// Datos asociados: atan el cifrado a este uso (cambiarlos invalida el blob).
export const AAD = 'ext-lge-cl:falabella-sellercenter:v1';

export function cifrarSecreto(valor) {
  const clave = randomBytes(32);
  const mascara = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', clave, iv);
  cipher.setAAD(Buffer.from(AAD));
  const cuerpo = Buffer.concat([cipher.update(JSON.stringify(valor), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const parte = Buffer.from(clave.map((b, i) => b ^ mascara[i]));
  return { a: mascara.toString('base64'), b: iv.toString('base64'), c: cuerpo.toString('base64'), d: parte.toString('base64') };
}

/** Blob cifrado de un JSON de `keys/`, o null si el archivo no esta (CI, otra PC). */
export function secretoDesdeArchivo(ruta, campos) {
  if (!existsSync(ruta)) return null;
  const json = JSON.parse(readFileSync(ruta, 'utf8'));
  const faltan = campos.filter((c) => !json[c]);
  if (faltan.length) throw new Error(`${ruta}: faltan ${faltan.join(', ')}`);
  return cifrarSecreto(Object.fromEntries(campos.map((c) => [c, String(json[c]).trim()])));
}
