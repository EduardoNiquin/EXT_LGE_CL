// Orquestador de "Revisar Destacados" en el service worker.
//
// La pagina de categoria usa AEM y arma el recuadro de destacados con JS en el
// cliente, asi que NO sirve hacer fetch del HTML. En cambio, abrimos las URLs
// en pestañas de fondo, dejamos que el navegador las renderice y le pedimos al
// content script que lea el DOM vivo (mensaje PARSE_SPOTLIGHT).
//
// Para ir mas rapido se revisan VARIAS pestañas en paralelo (pool). El progreso
// se persiste en STORAGE_KEYS.DESTACADOS_RUN en cada cambio, asi el popup puede
// mostrar en vivo que pagina se esta revisando, cuantas faltan y los resultados
// — y reconstruir el estado aunque se cierre/reabra.
//
// Corre tanto para la revision manual (desde el popup) como para la automatica
// (chrome.alarms), y funciona aunque no haya ninguna pestaña de lg.com abierta.

import {
  DESTACADOS_ALARM,
  DESTACADOS_AUTO_DEFAULT,
  DESTACADOS_AUTO_MAX_MINUTES,
  DESTACADOS_AUTO_MIN_MINUTES,
  DESTACADOS_POOL,
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
let currentRun = null; // estado en memoria; se persiste en cada cambio

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

// Persiste el estado actual de la corrida (snapshot defensivo).
function persist() {
  return setStorage(STORAGE_KEYS.DESTACADOS_RUN, currentRun);
}

// Aplica un patch a un item y persiste.
async function patchItem(idx, patch) {
  if (!currentRun?.items?.[idx]) return;
  Object.assign(currentRun.items[idx], patch);
  currentRun.doneCount = currentRun.items.filter((it) => isTerminal(it.status)).length;
  await persist();
}

function isTerminal(status) {
  return status === PAGE_STATUS.OK || status === PAGE_STATUS.ISSUES ||
    status === PAGE_STATUS.NO_SPOTLIGHT || status === PAGE_STATUS.ERROR;
}

// Convierte la respuesta del content (DOM vivo) en los campos del item.
function itemFieldsFromResponse(res) {
  const products = Array.isArray(res?.products) ? res.products : [];
  if (!res?.hasSpotlight) {
    return { status: PAGE_STATUS.NO_SPOTLIGHT, spotlightCount: 0, problemCount: 0, products: [] };
  }
  const problemCount = products.filter((p) => p.issues?.length).length;
  return {
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

  while (Date.now() < deadline) {
    let res;
    try {
      res = await chrome.tabs.sendMessage(tabId, { type: MESSAGES.PARSE_SPOTLIGHT, expectPath });
    } catch {
      res = null; // content script aun no inyectado o pestaña navegando
    }
    if (res?.ok && res.ready) return itemFieldsFromResponse(res);
    await delay(600);
  }
  return { status: PAGE_STATUS.ERROR, error: 'La pagina no renderizo a tiempo.', products: [] };
}

// Un "worker": tiene su propia pestaña de fondo y va tomando items de la cola.
async function worker(queue) {
  let tabId = null;
  try {
    let idx = queue.next();
    if (idx === -1) return;

    // Crea la pestaña ya en la primera URL que le toca (evita un about:blank).
    const tab = await chrome.tabs.create({ url: DESTACADOS_URLS[idx].url, active: false });
    tabId = tab.id;

    let first = true;
    while (idx !== -1) {
      const entry = DESTACADOS_URLS[idx];
      await patchItem(idx, { status: PAGE_STATUS.CHECKING });
      if (!first) {
        try { await chrome.tabs.update(tabId, { url: entry.url }); } catch { /* sigue */ }
      }
      first = false;
      const fields = await reviewInTab(tabId, entry);
      await patchItem(idx, fields);
      idx = queue.next();
    }
  } catch (err) {
    log.error('destacados: worker fallo', new Error(toMessage(err)));
  } finally {
    if (tabId != null) {
      try { await chrome.tabs.remove(tabId); } catch { /* ya cerrada */ }
    }
  }
}

// Corre la revision completa con un pool de pestañas en paralelo.
export async function runDestacados(trigger = 'manual') {
  if (running) return currentRun;
  running = true;
  try {
    currentRun = {
      active: true,
      trigger,
      startedAt: Date.now(),
      finishedAt: null,
      total: DESTACADOS_URLS.length,
      doneCount: 0,
      items: DESTACADOS_URLS.map((u) => ({ label: u.label || '', url: u.url, status: PAGE_STATUS.PENDING })),
    };
    await persist();

    // Cola compartida: cada worker pide el siguiente indice.
    let cursor = 0;
    const queue = { next: () => (cursor < DESTACADOS_URLS.length ? cursor++ : -1) };

    const poolSize = Math.min(DESTACADOS_POOL, DESTACADOS_URLS.length);
    await Promise.all(Array.from({ length: poolSize }, () => worker(queue)));

    currentRun.active = false;
    currentRun.finishedAt = Date.now();
    await persist();
    log.info('destacados: revision completa', { trigger, paginas: currentRun.total });
    return currentRun;
  } catch (err) {
    if (currentRun) {
      currentRun.active = false;
      currentRun.finishedAt = Date.now();
      currentRun.error = toMessage(err);
      await persist();
    }
    log.error('destacados: fallo la revision', new Error(toMessage(err)));
    throw err;
  } finally {
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
      (run) => sendResponse({ ok: true, run }),
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
