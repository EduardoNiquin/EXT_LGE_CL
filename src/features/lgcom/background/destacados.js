// Orquestador de "Revisar Destacados" en el service worker.
//
// La pagina de categoria usa AEM y arma el recuadro de destacados con JS en el
// cliente, asi que NO sirve hacer fetch del HTML. En cambio, abrimos cada URL
// en una pestaña de fondo, dejamos que el navegador la renderice y le pedimos
// al content script que lea el DOM vivo (mensaje PARSE_SPOTLIGHT). Esto corre
// tanto para la revision manual (disparada desde el popup) como para la
// automatica (chrome.alarms), y funciona aunque no haya ninguna pestaña de
// lg.com abierta: el SW abre la suya.

import {
  DESTACADOS_ALARM,
  DESTACADOS_AUTO_DEFAULT,
  DESTACADOS_AUTO_MAX_MINUTES,
  DESTACADOS_AUTO_MIN_MINUTES,
  DESTACADOS_TAB_TIMEOUT,
  DESTACADOS_URLS,
  MESSAGES,
  PAGE_STATUS,
  STORAGE_KEYS,
} from '../constants.js';
import { getStorage, setStorage } from '../../../shared/storage/storage.js';
import { toMessage } from '../../../shared/errors/index.js';
import { logger } from '../../../shared/utils/logger.js';

const log = logger('lgcom');

let running = false;

function clampMinutes(min) {
  const n = Number(min);
  if (!Number.isFinite(n)) return DESTACADOS_AUTO_DEFAULT.intervalMinutes;
  return Math.max(DESTACADOS_AUTO_MIN_MINUTES, Math.min(DESTACADOS_AUTO_MAX_MINUTES, Math.round(n)));
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pathOf(url) {
  try { return new URL(url).pathname; } catch { return ''; }
}

// Convierte la respuesta del content (DOM vivo) en un PageResult.
function toPageResult(entry, res) {
  const base = { label: entry.label || '', url: entry.url };
  const products = Array.isArray(res?.products) ? res.products : [];
  if (!res?.hasSpotlight) {
    return { ...base, status: PAGE_STATUS.NO_SPOTLIGHT, spotlightCount: 0, problemCount: 0, products: [] };
  }
  const problemCount = products.filter((p) => p.issues?.length).length;
  return {
    ...base,
    status: problemCount ? PAGE_STATUS.ISSUES : PAGE_STATUS.OK,
    spotlightCount: products.length,
    problemCount,
    products,
  };
}

// Pide al content de la pestaña que lea el spotlight ya renderizado. Reintenta
// mientras el content todavia no responde (pagina cargando/navegando).
async function reviewInTab(tabId, entry) {
  const expectPath = pathOf(entry.url);
  const deadline = Date.now() + DESTACADOS_TAB_TIMEOUT;
  const base = { label: entry.label || '', url: entry.url };

  while (Date.now() < deadline) {
    let res;
    try {
      res = await chrome.tabs.sendMessage(tabId, {
        type: MESSAGES.PARSE_SPOTLIGHT,
        expectPath,
      });
    } catch {
      res = null; // content script aun no inyectado o pestaña navegando
    }
    if (res?.ok && res.ready) return toPageResult(entry, res);
    await delay(600);
  }
  return { ...base, status: PAGE_STATUS.ERROR, error: 'La pagina no renderizo a tiempo.', products: [] };
}

// Corre la revision completa: una pestaña de fondo recorre todas las URLs.
export async function runDestacados(trigger = 'manual') {
  if (running) return (await getStorage(STORAGE_KEYS.DESTACADOS_LAST)) || null;
  running = true;
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url: DESTACADOS_URLS[0].url, active: false });
    tabId = tab.id;

    const results = [];
    for (let i = 0; i < DESTACADOS_URLS.length; i++) {
      const entry = DESTACADOS_URLS[i];
      if (i > 0) {
        try { await chrome.tabs.update(tabId, { url: entry.url }); } catch { /* sigue */ }
      }
      results.push(await reviewInTab(tabId, entry));
    }

    const last = { ranAt: Date.now(), trigger, results };
    await setStorage(STORAGE_KEYS.DESTACADOS_LAST, last);
    log.info('destacados: revision completa', { trigger, paginas: results.length });
    return last;
  } catch (err) {
    log.error('destacados: fallo la revision', new Error(toMessage(err)));
    throw err;
  } finally {
    if (tabId != null) {
      try { await chrome.tabs.remove(tabId); } catch { /* ya cerrada */ }
    }
    running = false;
  }
}

// (Re)crea o limpia la alarma de revision automatica segun la config.
async function reconcileAlarm() {
  const cfg = (await getStorage(STORAGE_KEYS.DESTACADOS_AUTO)) || DESTACADOS_AUTO_DEFAULT;
  if (cfg.enabled) {
    const minutes = clampMinutes(cfg.intervalMinutes);
    chrome.alarms.create(DESTACADOS_ALARM, { periodInMinutes: minutes });
    log.debug('destacados auto: alarma activa', { minutes });
  } else {
    chrome.alarms.clear(DESTACADOS_ALARM);
    log.debug('destacados auto: alarma desactivada');
  }
}

// Se llama una vez desde el service worker.
export function wireDestacadosBackground() {
  // Disparo manual desde el popup.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== MESSAGES.RUN_DESTACADOS) return false;
    runDestacados('manual').then(
      (last) => sendResponse({ ok: true, last }),
      (err) => sendResponse({ ok: false, reason: toMessage(err) }),
    );
    return true; // respuesta async
  });

  // Disparo automatico.
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === DESTACADOS_ALARM) runDestacados('auto').catch(() => { /* ya logueado */ });
  });

  // Cambios de config (encender/apagar, intervalo) → recrear/limpiar alarma.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.DESTACADOS_AUTO]) reconcileAlarm();
  });

  reconcileAlarm();
}
