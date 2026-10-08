// De donde salen las credenciales de la API (solo service worker):
//   1. las que la persona cargo en el popup (override opcional), o
//   2. las incluidas en la extension, cifradas en el build.

import { credencialesEmbebidas } from './embebido.js';
import { getCredenciales } from '../state.js';

export const FUENTE = { PROPIAS: 'propias', INCLUIDAS: 'incluidas' };

/** @returns {Promise<{cred:{userId,apiKey}, fuente:string} | null>} */
export async function resolverCredenciales() {
  const propias = await getCredenciales();
  if (propias?.userId && propias?.apiKey) return { cred: propias, fuente: FUENTE.PROPIAS };
  const incluidas = await credencialesEmbebidas();
  if (incluidas?.userId && incluidas?.apiKey) return { cred: incluidas, fuente: FUENTE.INCLUIDAS };
  return null;
}

/** Lo que puede ver el popup: la fuente y el UserID, nunca la API Key. */
export async function estadoCredenciales() {
  const r = await resolverCredenciales();
  return r ? { fuente: r.fuente, userId: r.cred.userId } : { fuente: null, userId: null };
}
