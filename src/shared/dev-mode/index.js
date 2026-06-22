// "Modo desarrollador" global de la extensión.
//
// Un único flag persistente (chrome.storage.local) con cache sincrónica en
// memoria — mismo patrón que shared/log-config. Cuando está activo:
//   - El logger fuerza el nivel efectivo a 'debug' (ver shared/utils/logger).
//   - El recorder de diagnóstico captura todo (ver shared/diagnostics).
//   - La UI de cada feature puede mostrar afordances extra de depuración.
//
// Cross-context vía chrome.storage.onChanged: togglear el modo en el popup
// (Ajustes) se refleja al instante en los content scripts y el service worker.

const STORAGE_KEY = 'dev-mode:enabled';

// null = aún no cargado desde storage. Default mientras carga: false.
let cache = null;
const listeners = new Set();
let readyResolve;
const readyPromise = new Promise((res) => { readyResolve = res; });

function safeGet(keys) {
  try { return chrome.storage.local.get(keys); } catch { return Promise.resolve({}); }
}
function safeSet(obj) {
  try { return chrome.storage.local.set(obj); } catch { return Promise.resolve(); }
}

safeGet([STORAGE_KEY]).then((res) => {
  cache = res[STORAGE_KEY] === true;
  readyResolve(cache);
  emit();
});

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    cache = changes[STORAGE_KEY].newValue === true;
    emit();
  });
} catch { /* contexto sin chrome.storage */ }

function emit() {
  for (const l of listeners) {
    try { l(cache === true); } catch { /* noop */ }
  }
}

/** Estado sincrónico del modo dev. `false` mientras la cache no cargó. */
export function isDevMode() {
  return cache === true;
}

/** Activa/desactiva el modo dev. Persiste a storage (cross-context). */
export function setDevMode(enabled) {
  cache = enabled === true;
  emit();
  return safeSet({ [STORAGE_KEY]: cache });
}

/** Promesa que resuelve con el valor inicial una vez cargado el storage. */
export function whenDevModeReady() {
  return readyPromise;
}

/** Subscribirse a cambios. Devuelve la función de desuscripción. */
export function subscribeDevMode(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const DEV_MODE_STORAGE_KEY = STORAGE_KEY;
