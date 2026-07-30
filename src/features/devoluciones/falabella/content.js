// Lector del token de emparejamiento de la web de Devoluciones.
//
// Corre dentro del content script del feature (que matchea <all_urls>). Lee las
// dos <meta> que el servidor publica en el HTML de la página de devoluciones y,
// si están, guarda el emparejamiento en chrome.storage.local. No toca la UI de
// la web. Como el usuario abre la web de todos modos (es donde mira el avance),
// el emparejamiento ocurre solo.

import { META_BASE, META_TOKEN } from './constants.js';
import { getPairing, setPairing } from './state.js';
import { logger } from '../../../shared/utils/logger.js';

const log = logger('devoluciones-seller');

function readMeta(name) {
  const el = document.querySelector(`meta[name="${name}"]`);
  return el?.content?.trim() || '';
}

async function tryPair() {
  const token = readMeta(META_TOKEN);
  const base = readMeta(META_BASE);
  if (!token || !base) return false;

  const prev = await getPairing();
  if (prev && prev.token === token && prev.base === base) return true; // sin cambios

  await setPairing({ token, base, ts: Date.now() });
  log.info('emparejamiento actualizado desde la web', { base });
  return true;
}

export function initPairing() {
  // Sólo el top frame lee las <meta> (evita trabajo en iframes).
  if (window !== window.top) return;

  tryPair().catch((err) => log.warn?.('tryPair falló', err));

  // La página puede inyectar/rotar la <meta> tras el idle (SPA): reintento breve.
  setTimeout(() => { tryPair().catch(() => { /* no-op */ }); }, 1500);
}
