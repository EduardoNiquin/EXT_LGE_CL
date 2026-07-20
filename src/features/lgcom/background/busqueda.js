// Orquestador de "Búsqueda" en el service worker.
//
// El buscador de www.lg.com (SRP) usa AEM y arma los resultados con JS en el
// cliente, así que NO sirve hacer fetch del HTML. En cambio, para cada SKU
// abrimos la URL del buscador en una pestaña de fondo, dejamos que renderice y
// le pedimos al content script que lea el DOM vivo (mensaje PARSE_SEARCH).
//
// Para ir más rápido se buscan VARIOS SKUs en paralelo (pool de pestañas, cuyo
// tamaño elige el usuario 1-5). El progreso se persiste en
// STORAGE_KEYS.BUSQUEDA_RUN en cada cambio, así el popup puede mostrar en vivo
// qué SKU se está buscando, cuántos faltan y el resultado por SKU — y
// reconstruir el estado aunque se cierre/reabra el popup.
//
// IMPORTANTE (una pestaña NUEVA por SKU): todas las búsquedas comparten el mismo
// path /cl/search/ y sólo cambian el query ?search=. Reusar la pestaña con
// tabs.update (como en Destacados, que sí cambia de path) no re-renderiza de
// forma fiable en la SPA de AEM: la pestaña se queda mostrando la primera
// búsqueda. Por eso cada SKU abre y cierra su propia pestaña: navegación limpia
// y content script fresco garantizados.

import {
  BUSQUEDA_LOG_CAP,
  BUSQUEDA_MAX_SKUS,
  BUSQUEDA_TAB_TIMEOUT,
  MESSAGES,
  SEARCH_FINISH,
  SEARCH_STATUS,
  STOCK,
  STORAGE_KEYS,
  buildSearchUrl,
  clampBusquedaPool,
} from '../constants.js';
import { setStorage } from '../../../shared/storage/storage.js';
import { toMessage } from '../../../shared/errors/index.js';
import { logger } from '../../../shared/utils/logger.js';

const log = logger('lgcom/busqueda');

let running = false;
let stopped = false;   // se activa al pedir "Detener"; los workers lo respetan
let currentRun = null; // estado en memoria; se persiste en cada cambio

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Limpia y normaliza la lista de SKUs: separa por línea/coma/espacio, quita
// vacíos y duplicados, recorta al tope.
function normalizeSkus(input) {
  const raw = Array.isArray(input) ? input.join('\n') : String(input || '');
  const seen = new Set();
  const out = [];
  for (const token of raw.split(/[\n,;]+/)) {
    const sku = token.trim();
    if (!sku) continue;
    const key = sku.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sku);
    if (out.length >= BUSQUEDA_MAX_SKUS) break;
  }
  return out;
}

function isTerminal(status) {
  return status === SEARCH_STATUS.FOUND_IN_STOCK ||
    status === SEARCH_STATUS.FOUND_OUT_OF_STOCK ||
    status === SEARCH_STATUS.FOUND_DISCONTINUED ||
    status === SEARCH_STATUS.NOT_FOUND ||
    status === SEARCH_STATUS.ERROR;
}

// Mapea la disponibilidad leída del DOM (STOCK.*) al estado del item.
function statusFromStock(stock) {
  if (stock === STOCK.IN_STOCK) return SEARCH_STATUS.FOUND_IN_STOCK;
  if (stock === STOCK.OUT_OF_STOCK) return SEARCH_STATUS.FOUND_OUT_OF_STOCK;
  return SEARCH_STATUS.FOUND_DISCONTINUED;
}

function persist() {
  return setStorage(STORAGE_KEYS.BUSQUEDA_RUN, currentRun);
}

// Agrega una línea al registro de la corrida (visible en el popup) y emite el
// log al logger — que en "Modo Dev" fuerza el nivel debug (ver shared/utils/logger).
async function pushLog(level, message) {
  const entry = { ts: Date.now(), level, message };
  if (currentRun) {
    const prev = Array.isArray(currentRun.log) ? currentRun.log : [];
    const next = [...prev, entry];
    if (next.length > BUSQUEDA_LOG_CAP) next.splice(0, next.length - BUSQUEDA_LOG_CAP);
    currentRun.log = next;
    await persist();
  }
  const emit = log[level] || log.info;
  emit(message);
}

async function patchItem(idx, patch) {
  if (!currentRun?.items?.[idx]) return;
  Object.assign(currentRun.items[idx], patch);
  currentRun.doneCount = currentRun.items.filter((it) => isTerminal(it.status)).length;
  await persist();
}

// Convierte la respuesta del content (DOM vivo) en los campos del item.
function itemFieldsFromResponse(res, sku) {
  if (!res?.found) {
    return { status: SEARCH_STATUS.NOT_FOUND };
  }
  return {
    status: statusFromStock(res.stock),
    stock: res.stock || null,
    foundSku: res.sku || sku,
    modelName: res.modelName || '',
    href: res.href || '',
    price: res.price || '',
    stockStatus: res.stockStatus || null,
  };
}

// Pide al content de la pestaña que lea los resultados ya renderizados.
// Reintenta mientras el content todavía no responde (página cargando/navegando).
// Devuelve null si se pidió detener (para no registrar un resultado espurio).
async function searchInTab(tabId, sku) {
  const deadline = Date.now() + BUSQUEDA_TAB_TIMEOUT;
  while (Date.now() < deadline) {
    if (stopped) return null;
    let res;
    try {
      res = await chrome.tabs.sendMessage(tabId, { type: MESSAGES.PARSE_SEARCH, sku });
    } catch {
      res = null; // content script aún no inyectado o pestaña navegando
    }
    if (res?.ok && res.ready) return itemFieldsFromResponse(res, sku);
    await delay(600);
  }
  return { status: SEARCH_STATUS.ERROR, error: 'La página no cargó a tiempo.' };
}

// Texto legible del resultado de un SKU, para el registro.
function describeResult(sku, fields) {
  switch (fields.status) {
    case SEARCH_STATUS.FOUND_IN_STOCK:
      return { level: 'info', message: `${sku}: con stock${fields.price ? ` (${fields.price})` : ''}.` };
    case SEARCH_STATUS.FOUND_OUT_OF_STOCK:
      return { level: 'warn', message: `${sku}: aparece pero SIN stock.` };
    case SEARCH_STATUS.FOUND_DISCONTINUED:
      return { level: 'warn', message: `${sku}: aparece pero DESCONTINUADO.` };
    case SEARCH_STATUS.NOT_FOUND:
      return { level: 'warn', message: `${sku}: sin resultados en el buscador.` };
    default:
      return { level: 'error', message: `${sku}: error — ${fields.error || 'no se pudo leer la página.'}` };
  }
}

// Busca UN SKU en su propia pestaña de fondo (abrir → parsear → cerrar).
// Una pestaña nueva por SKU garantiza una navegación limpia (ver nota de cabecera).
async function searchOneSku(idx, sku) {
  let tabId = null;
  try {
    await patchItem(idx, { status: SEARCH_STATUS.CHECKING });
    const tab = await chrome.tabs.create({ url: buildSearchUrl(sku), active: false });
    tabId = tab.id;
    const fields = await searchInTab(tabId, sku);
    if (fields === null) return; // detenido: no registramos resultado de este SKU
    await patchItem(idx, fields);
    const { level, message } = describeResult(sku, fields);
    await pushLog(level, message);
  } finally {
    if (tabId != null) {
      try { await chrome.tabs.remove(tabId); } catch { /* ya cerrada */ }
    }
  }
}

// Un "worker": va tomando SKUs de la cola compartida y busca cada uno en una
// pestaña propia y efímera.
async function worker(queue, skus) {
  let idx = queue.next();
  while (idx !== -1) {
    if (stopped) break;
    try {
      await searchOneSku(idx, skus[idx]);
    } catch (err) {
      log.error('busqueda: worker fallo', new Error(toMessage(err)));
      await patchItem(idx, { status: SEARCH_STATUS.ERROR, error: toMessage(err) });
    }
    idx = queue.next();
  }
}

// Marca los SKUs que quedaron sin terminar (al detener) como pendientes de
// cancelación, para que el resumen no los cuente como resultados.
function closeUnfinishedItems() {
  if (!currentRun?.items) return;
  for (const it of currentRun.items) {
    if (!isTerminal(it.status)) it.status = SEARCH_STATUS.PENDING;
  }
}

// Corre la búsqueda completa con un pool de pestañas en paralelo.
// `poolInput` es el nº de pestañas simultáneas elegido por el usuario (1-5).
export async function runBusqueda(skusInput, poolInput) {
  if (running) return currentRun;
  const skus = normalizeSkus(skusInput);
  if (!skus.length) return null;

  running = true;
  stopped = false;
  try {
    const poolSize = Math.min(clampBusquedaPool(poolInput), skus.length);
    currentRun = {
      active: true,
      startedAt: Date.now(),
      finishedAt: null,
      finishReason: null,
      total: skus.length,
      doneCount: 0,
      pool: poolSize,
      skus,
      items: skus.map((sku) => ({ sku, status: SEARCH_STATUS.PENDING })),
      log: [],
    };
    await persist();
    await pushLog('info', `Iniciando búsqueda de ${skus.length} SKU(s) (${poolSize} en paralelo).`);

    // Cola compartida: cada worker pide el siguiente índice (o -1 si se detuvo).
    let cursor = 0;
    const queue = { next: () => (!stopped && cursor < skus.length ? cursor++ : -1) };

    await Promise.all(Array.from({ length: poolSize }, () => worker(queue, skus)));

    if (stopped) {
      closeUnfinishedItems();
      currentRun.finishReason = SEARCH_FINISH.STOPPED;
    } else {
      currentRun.finishReason = SEARCH_FINISH.DONE;
    }
    currentRun.active = false;
    currentRun.finishedAt = Date.now();
    await persist();
    await pushLog(
      stopped ? 'warn' : 'info',
      stopped
        ? `Detenida por el usuario (${currentRun.doneCount}/${currentRun.total} completados).`
        : `Búsqueda completa: ${currentRun.total} SKU(s) revisados.`,
    );
    return currentRun;
  } catch (err) {
    if (currentRun) {
      currentRun.active = false;
      currentRun.finishedAt = Date.now();
      currentRun.finishReason = SEARCH_FINISH.ERROR;
      currentRun.error = toMessage(err);
      await pushLog('error', `La búsqueda falló: ${toMessage(err)}`);
    }
    log.error('busqueda: fallo la corrida', new Error(toMessage(err)));
    throw err;
  } finally {
    running = false;
    stopped = false;
  }
}

// Pide detener la corrida en curso. Los workers lo notan entre SKUs y cierran.
export function stopBusqueda() {
  if (!running) return false;
  stopped = true;
  log.info('busqueda: detención solicitada');
  return true;
}

// Se llama una vez desde el service worker.
export function wireBusquedaBackground() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === MESSAGES.RUN_BUSQUEDA) {
      runBusqueda(msg.skus, msg.pool).then(
        (run) => sendResponse({ ok: true, run }),
        (err) => sendResponse({ ok: false, reason: toMessage(err) }),
      );
      return true; // respuesta async
    }
    if (msg?.type === MESSAGES.STOP_BUSQUEDA) {
      sendResponse({ ok: true, stopped: stopBusqueda() });
      return false;
    }
    return false;
  });
}
