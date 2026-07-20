// Lectura de los resultados del buscador de www.lg.com para un SKU.
//
// Flujo: el buscador arma la URL /cl/search/?search=<SKU>&tab=producto y la SRP
// (search results page) lista tarjetas de producto. Buscamos la tarjeta cuyo
// botón "copiar modelo" (`.btn-copy[data-sku]`) coincida EXACTO con el SKU. Si
// existe ⇒ el producto aparece. La disponibilidad se lee del atributo
// `data-shop-stock-status` de los botones de la tarjeta:
//   IN_STOCK       → con stock
//   OUT_OF_STOCK   → sin stock
//   presente vacío → descontinuado
//
// IMPORTANTE: la página usa AEM y los resultados los inyecta el JS en el
// cliente (no están en el HTML crudo). Por eso NO se hace fetch del HTML: el
// service worker abre la URL en una pestaña de fondo y este módulo lee el DOM YA
// renderizado (espera a que aparezcan los resultados antes de parsear).

import {
  BUSQUEDA_RENDER_TIMEOUT,
  BUSQUEDA_SELECTORS as S,
  BUSQUEDA_SETTLE_MS,
  STOCK,
} from '../../constants.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { isAbortError } from '../../../../shared/errors/index.js';

// Normaliza un SKU para comparar (sin espacios, mayúsculas).
export function normSku(value) {
  return String(value ?? '').trim().toUpperCase();
}

// Compara el data-sku de una tarjeta con el SKU buscado. Acepta coincidencia
// exacta o por la base antes del primer punto (el buscador a veces guarda el
// SKU completo tipo "86MRGB95BSA.AWH.ESCL.CL.C").
export function skuMatches(dataSku, target) {
  const a = normSku(dataSku);
  const b = normSku(target);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.split('.')[0] === b || b.split('.')[0] === a;
}

// ¿Hay ya en el DOM una tarjeta cuyo SKU coincide con el buscado?
function findSkuButton(target, doc = document) {
  const buttons = doc.querySelectorAll(S.skuButton);
  for (const btn of buttons) {
    if (skuMatches(btn.getAttribute('data-sku'), target)) return btn;
  }
  return null;
}

// Determina la disponibilidad de una tarjeta leyendo TODOS sus botones con
// `data-shop-stock-status` (hay duplicados: "Conoce más", "Comprar ahora" y las
// variantes móviles). Regla:
//   - algún botón IN_STOCK      → con stock
//   - si no, algún OUT_OF_STOCK → sin stock
//   - si no (atributo presente pero vacío, o ausente) → descontinuado
function readStock(scope) {
  const controls = [...scope.querySelectorAll(S.stockControl)];
  const values = controls
    .map((c) => (c.getAttribute('data-shop-stock-status') || '').trim().toUpperCase());
  if (values.includes('IN_STOCK')) return { stock: STOCK.IN_STOCK, raw: 'IN_STOCK' };
  if (values.includes('OUT_OF_STOCK')) return { stock: STOCK.OUT_OF_STOCK, raw: 'OUT_OF_STOCK' };
  return { stock: STOCK.DISCONTINUED, raw: values.find(Boolean) || '' };
}

// Parsea los resultados del buscador para un SKU concreto en un Document dado.
// Devuelve { found, sku, stock, stockStatus, modelName, href, price, ... }.
export function parseSearch(target, doc = document) {
  const resultsPresent = Boolean(doc.querySelector(S.results));
  const btn = findSkuButton(target, doc);
  if (!btn) return { found: false, resultsPresent };

  const li = btn.closest(S.item) || btn.closest('li');
  const scope = li || doc;

  const matchedSku = btn.getAttribute('data-sku')?.trim() || normSku(target);
  const { stock, raw } = readStock(scope);
  const modelName =
    scope.querySelector(S.modelNameSpan)?.textContent?.trim() ||
    scope.querySelector(S.modelNameA)?.textContent?.trim() ||
    '';
  const href = scope.querySelector(S.link)?.getAttribute('href') || '';
  const price = scope.querySelector(S.price)?.textContent?.trim() || '';

  return {
    found: true,
    sku: matchedSku,
    stock,
    stockStatus: raw || null,
    modelName,
    href,
    price,
    resultsPresent: true,
  };
}

// Recorre la página de arriba a abajo para disparar cargas diferidas (lazy /
// IntersectionObserver): la SRP puede no renderizar del todo en una pestaña de
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

// Espera a que la SRP renderice en la página ACTUAL y la parsea para el SKU
// buscado. Se usa dentro de la pestaña de fondo que abre el service worker.
// Resuelve en cuanto: aparece la tarjeta del SKU, o hay una lista de resultados
// renderizada, o hay un mensaje de "sin resultados". Si nada aparece dentro del
// timeout, parsea lo que haya (típicamente ⇒ no encontrado).
export async function waitAndParseSearch(target, signal) {
  let settled = false;
  const sweeper = (async () => {
    while (!settled && !signal?.aborted) {
      await nudgeScroll();
      await sleep(400);
    }
  })();

  try {
    await waitFor(
      () => {
        if (findSkuButton(target)) return 'match';
        const root = document.querySelector(S.results);
        if (root && root.querySelector(S.item)) return 'list';
        if (document.querySelector(S.noResult)) return 'empty';
        return null;
      },
      { timeout: BUSQUEDA_RENDER_TIMEOUT, interval: 250, signal, description: 'resultados del buscador' },
    );
  } catch (err) {
    settled = true;
    await sweeper.catch(() => {});
    if (isAbortError(err, signal)) throw err;
    // Timeout: parseamos lo que haya (probablemente sin coincidencia).
    return parseSearch(target);
  }

  settled = true;
  await sweeper.catch(() => {});
  // Damos un respiro para que precio/stock asíncronos terminen de poblarse.
  await sleep(BUSQUEDA_SETTLE_MS, signal);
  return parseSearch(target);
}
