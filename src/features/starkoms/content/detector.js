import { HOST, PAGE_TYPE, ROUTE_RE, SELECTORS } from '../constants.js';

/** True si estamos en el host de Starkoms. */
export function isStarkomsHost() {
  return location.hostname === HOST || location.hostname.endsWith(`.${HOST}`);
}

/**
 * Identifica la pantalla actual a partir del hash (SPA). Las regex más
 * específicas se evalúan primero.
 */
export function detectPage() {
  const hash = location.hash || '';
  const base = {
    url: location.href,
    hash,
    host: location.hostname,
    isStarkoms: isStarkomsHost(),
    isTopFrame: window === window.top,
  };

  if (!base.isStarkoms) return { type: PAGE_TYPE.OTHER, ...base };

  let m;
  if ((m = hash.match(ROUTE_RE.STOCK_EDIT))) {
    return { type: PAGE_TYPE.STOCK_EDIT, sku: decodeURIComponent(m[1]), bodegaId: m[2], ...base };
  }
  if ((m = hash.match(ROUTE_RE.INVENTORY_PRODUCT))) {
    return { type: PAGE_TYPE.INVENTORY_PRODUCT, sku: decodeURIComponent(m[1]), ...base };
  }
  if (ROUTE_RE.INVENTORY_LIST.test(hash)) return { type: PAGE_TYPE.INVENTORY_LIST, ...base };
  if (ROUTE_RE.PRODUCTS.test(hash))       return { type: PAGE_TYPE.PRODUCTS, ...base };
  if ((m = hash.match(ROUTE_RE.ORDER_DETAIL))) {
    return { type: PAGE_TYPE.ORDER_DETAIL, orderNumber: m[1], ...base };
  }
  if (ROUTE_RE.ORDERS_LIST.test(hash)) return { type: PAGE_TYPE.ORDERS_LIST, ...base };

  return { type: PAGE_TYPE.OTHER, ...base };
}

export function diagnose() {
  const page = detectPage();
  const selectors = {};
  for (const [key, sel] of Object.entries(SELECTORS)) {
    let present = false;
    try { present = Boolean(document.querySelector(sel)); } catch { /* selector contextual */ }
    selectors[key] = { selector: sel, present };
  }
  return { page, selectors };
}
