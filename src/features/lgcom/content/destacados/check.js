// Lectura de los "Destacados" de una página de categoría de www.lg.com.
//
// El recuadro de spotlight (`.c-result-area__spotlight`) lista 3 productos que
// deben tener TAG y ser comprables (con STOCK). Como van puestos a mano, puede
// pasar que queden sin tag o se agoten.
//
// IMPORTANTE: la página usa AEM y el spotlight lo inyecta el JS en el cliente
// (no esta en el HTML crudo). Por eso NO se hace fetch del HTML: el service
// worker abre la URL en una pestaña de fondo y este modulo lee el DOM YA
// renderizado (espera a que el recuadro aparezca antes de parsear).

import {
  DESTACADOS_RENDER_TIMEOUT,
  DESTACADOS_SELECTORS as S,
  DESTACADOS_SETTLE_MS,
  PRODUCT_ISSUE,
  STOCK_STATUS,
} from '../../constants.js';
import { sleep, waitForElement } from '../../../../shared/dom/wait.js';
import { isAbortError } from '../../../../shared/errors/index.js';

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

// Parsea los destacados de un Document (o cualquier raíz con querySelector).
export function parseSpotlight(doc) {
  const spotlight = doc.querySelector(S.spotlight);
  if (!spotlight) return { hasSpotlight: false, products: [] };

  let items = spotlight.querySelectorAll(S.item);
  if (!items.length) items = spotlight.querySelectorAll(S.itemFallback);

  const products = [...items].map(parseProduct);
  return { hasSpotlight: true, products };
}

// Recorre la página de arriba a abajo para disparar cargas diferidas (lazy /
// IntersectionObserver): el spotlight puede no renderizar en una pestaña de
// fondo hasta que su sección "entra" al viewport.
async function nudgeScroll() {
  try {
    const step = Math.max(400, window.innerHeight || 800);
    const height = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
    for (let y = 0; y <= height; y += step) {
      window.scrollTo(0, y);
      await sleep(120);
    }
    window.scrollTo(0, 0);
  } catch { /* da igual si falla el scroll */ }
}

// Espera a que el spotlight renderice en la página ACTUAL y lo parsea. Se usa
// dentro de la pestaña de fondo que abre el service worker. Mientras espera,
// hace scroll para forzar el render diferido. Si el recuadro no aparece dentro
// del timeout, devuelve hasSpotlight:false (la categoría no tiene destacados o
// no renderizo).
export async function waitAndParse(signal) {
  let found = false;
  // Sweeper de scroll en paralelo, hasta encontrar el spotlight o cancelar.
  const sweeper = (async () => {
    while (!found && !signal?.aborted) {
      await nudgeScroll();
      await sleep(400);
    }
  })();

  try {
    await waitForElement(`${S.spotlight} ${S.item}`, {
      timeout: DESTACADOS_RENDER_TIMEOUT,
      interval: 250,
      signal,
    });
  } catch (err) {
    found = true;
    await sweeper.catch(() => {});
    if (isAbortError(err, signal)) throw err;
    // Timeout: puede que la categoría realmente no tenga recuadro de destacados.
    return parseSpotlight(document);
  }
  found = true;
  await sweeper.catch(() => {});
  // El spotlight ya está; damos un respiro para que el stock/tags asíncronos
  // terminen de poblarse antes de leer.
  await sleep(DESTACADOS_SETTLE_MS, signal);
  return parseSpotlight(document);
}
