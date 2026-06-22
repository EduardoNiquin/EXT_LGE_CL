// Revisión de "Destacados" de las páginas de categoría de www.lg.com.
//
// El recuadro de spotlight (`.c-result-area__spotlight`) lista 3 productos que
// deben tener TAG y ser comprables (con STOCK). Como van puestos a mano, puede
// pasar que queden sin tag o se agoten. Acá detectamos eso por página.
//
// Estrategia: el content script vive en una pestaña de www.lg.com, así que
// puede hacer `fetch` mismo-origen de cada URL de categoría (con la sesión del
// usuario) y parsear el HTML devuelto con DOMParser — sin navegar la pestaña ni
// ejecutar scripts de la página. Los tags y el estado de stock vienen
// renderizados en el HTML (spans de `.neo-tag--box` y `data-shop-stock-status`).

import {
  DESTACADOS_FETCH_TIMEOUT,
  DESTACADOS_SELECTORS as S,
  PAGE_STATUS,
  PRODUCT_ISSUE,
  STOCK_STATUS,
} from '../../constants.js';
import { ExtError, toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('lgcom');

// Parsea un <li> de producto destacado → { sku, modelName, tags, hasTag, hasStock, ... }.
function parseProduct(li) {
  const sku =
    li.querySelector(S.skuButton)?.getAttribute('data-sku')?.trim() ||
    li.querySelector(S.skuText)?.textContent?.trim() ||
    '';
  const modelName = li.querySelector(S.modelName)?.textContent?.trim() || '';
  const href = li.querySelector(S.link)?.getAttribute('href') || '';

  // Tags: spans dentro de .neo-tag--box. Vacío ⇒ sin tag.
  const tagBox = li.querySelector(S.tagBox);
  const tags = tagBox
    ? [...tagBox.querySelectorAll('span')].map((s) => s.textContent.trim()).filter(Boolean)
    : [];
  const hasTag = tags.length > 0;

  // Stock: del data-attribute del control de compra. "Comprar ahora" trae
  // IN_STOCK; "Avísame cuando vuelva" trae OUT_OF_STOCK. Sin control de compra
  // ⇒ asumimos sin stock.
  const control = li.querySelector(S.stockControl);
  const stockStatus = control?.getAttribute('data-shop-stock-status') || null;
  const hasStock = stockStatus === STOCK_STATUS.IN_STOCK;

  const issues = [];
  if (!hasTag) issues.push(PRODUCT_ISSUE.NO_TAG);
  if (!hasStock) issues.push(PRODUCT_ISSUE.NO_STOCK);

  return { sku, modelName, href, tags, hasTag, hasStock, stockStatus, issues };
}

// Parsea los destacados de un Document ya construido.
export function parseSpotlight(doc) {
  const spotlight = doc.querySelector(S.spotlight);
  if (!spotlight) return { hasSpotlight: false, products: [] };

  let items = spotlight.querySelectorAll(S.item);
  if (!items.length) items = spotlight.querySelectorAll(S.itemFallback);

  const products = [...items].map(parseProduct);
  return { hasSpotlight: true, products };
}

// Deriva el estado de una página a partir de sus productos.
function pageStatusFor(hasSpotlight, products) {
  if (!hasSpotlight) return PAGE_STATUS.NO_SPOTLIGHT;
  const problemCount = products.filter((p) => p.issues.length).length;
  return problemCount ? PAGE_STATUS.ISSUES : PAGE_STATUS.OK;
}

// Revisa UNA URL de categoría. Nunca lanza: devuelve un PageResult con
// status:'error' si algo falla, para que el batch continúe.
export async function checkUrl({ label, url }, signal) {
  const base = { label: label || '', url };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DESTACADOS_FETCH_TIMEOUT);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });

    let html;
    try {
      const res = await fetch(url, { credentials: 'include', signal: ctrl.signal });
      if (!res.ok) throw new ExtError(`HTTP ${res.status}`, { code: 'DESTACADOS_HTTP' });
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const { hasSpotlight, products } = parseSpotlight(doc);
    const status = pageStatusFor(hasSpotlight, products);

    return {
      ...base,
      status,
      hasSpotlight,
      spotlightCount: products.length,
      problemCount: products.filter((p) => p.issues.length).length,
      products,
    };
  } catch (err) {
    log.error('destacados: fallo al revisar página', new Error(toMessage(err)), { url });
    return { ...base, status: PAGE_STATUS.ERROR, error: toMessage(err), products: [] };
  }
}

// Revisa una lista de URLs en secuencia. Devuelve un PageResult por URL.
export async function checkUrls(urls, signal) {
  const results = [];
  for (const entry of urls) {
    if (signal?.aborted) break;
    results.push(await checkUrl(entry, signal));
  }
  return results;
}
