// Catalogo de modelos de GP1 (todas las super categorias), cacheado un rato en
// el frame: ~1.000 filas en 7 peticiones (~5 s). Volver a correr tras corregir
// un SKU no deberia bajarlo de nuevo.

import { BRIDGE } from '../constants.js';
import { askBridge } from './bridge-client.js';

const TTL_MS = 10 * 60 * 1000;
let cache = null; // { at, bizType, rows }

export async function getCatalog(bizType = 'B2C', { refresh = false, signal } = {}) {
  const fresh = cache && cache.bizType === bizType && Date.now() - cache.at < TTL_MS;
  if (fresh && !refresh) return { ...cache, cached: true };
  const { rows } = await askBridge(BRIDGE.OPS.CATALOG, { bizType }, { signal });
  cache = { at: Date.now(), bizType, rows };
  return { ...cache, cached: false };
}
