// Config persistente de qué scopes del logger están habilitados.
//
// Diseño:
//  - Persistencia en `chrome.storage.local` para que sea cross-context
//    (content script + popup + service worker comparten el mismo storage).
//  - Cache sincrónica en memoria porque el logger es sync. Antes de que la
//    cache cargue, todos los scopes se consideran habilitados (no perdemos
//    logs durante el boot).
//  - "Auto-registro" de scopes: la primera vez que un código pide
//    `logger('foo')`, el scope queda registrado y aparece en la UI de
//    Ajustes (aunque no haya configuración aún, su valor default es true).
//  - Listener `chrome.storage.onChanged` mantiene la cache fresca si la
//    UI de Ajustes cambia algo desde otro contexto.

const STORAGE_KEY = 'log-config:scopes';
const KNOWN_SCOPES_KEY = 'log-config:known-scopes';

// Cache: Record<scope, boolean>. null = aún no cargada.
let scopeCache = null;
// Set de scopes que se han pedido al logger en este contexto.
const knownScopes = new Set();
// Persisted set (todos los contextos suman al global).
let knownScopesPersisted = null;
// Subscribers a cambios (la UI de Ajustes se subscribe).
const listeners = new Set();

// Booleano "aún no cargado" — por defecto todos los scopes habilitados.
const DEFAULT_ENABLED_BEFORE_LOAD = true;

function safeStorageGet(keys) {
  try {
    return chrome.storage.local.get(keys);
  } catch {
    return Promise.resolve({});
  }
}

function safeStorageSet(obj) {
  try {
    return chrome.storage.local.set(obj);
  } catch {
    return Promise.resolve();
  }
}

// Carga inicial — se dispara al importar el módulo.
safeStorageGet([STORAGE_KEY, KNOWN_SCOPES_KEY]).then((res) => {
  scopeCache = res[STORAGE_KEY] || {};
  knownScopesPersisted = new Set(res[KNOWN_SCOPES_KEY] || []);
  // Mergeamos los scopes ya pedidos en este contexto al set persistido,
  // por si el código del logger corrió antes de que cargara el storage.
  for (const s of knownScopes) knownScopesPersisted.add(s);
  // Si agregamos scopes nuevos, los persistimos.
  if (knownScopes.size > 0) persistKnownScopes();
  emit();
});

// Listener cross-context.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEY]) {
      scopeCache = changes[STORAGE_KEY].newValue || {};
      emit();
    }
    if (changes[KNOWN_SCOPES_KEY]) {
      knownScopesPersisted = new Set(changes[KNOWN_SCOPES_KEY].newValue || []);
      emit();
    }
  });
} catch { /* no chrome.storage en algún contexto raro */ }

function emit() {
  for (const l of listeners) {
    try { l(); } catch { /* noop */ }
  }
}

function persistKnownScopes() {
  if (!knownScopesPersisted) return;
  safeStorageSet({ [KNOWN_SCOPES_KEY]: Array.from(knownScopesPersisted) });
}

/**
 * Marca el scope como "conocido" para que aparezca en la UI de Ajustes.
 * Idempotente.
 */
export function registerScope(scope) {
  if (knownScopes.has(scope)) return;
  knownScopes.add(scope);
  if (knownScopesPersisted) {
    if (!knownScopesPersisted.has(scope)) {
      knownScopesPersisted.add(scope);
      persistKnownScopes();
    }
  }
}

/**
 * `true` si los logs del scope están habilitados. Sincrónico —
 * si la cache aún no cargó, devuelve el default (habilitado).
 */
export function isScopeEnabled(scope) {
  if (scopeCache === null) return DEFAULT_ENABLED_BEFORE_LOAD;
  // Default = habilitado. Sólo lo deshabilitan si el usuario lo desactivó
  // explícitamente desde la UI.
  return scopeCache[scope] !== false;
}

/** Habilitar/deshabilitar un scope. Persiste a storage. */
export function setScopeEnabled(scope, enabled) {
  scopeCache = scopeCache || {};
  scopeCache[scope] = enabled !== false;
  safeStorageSet({ [STORAGE_KEY]: scopeCache });
}

/**
 * Lista de todos los scopes conocidos (los que algún `logger(scope)` invocó
 * en algún contexto). Usado por la UI de Ajustes.
 */
export function getAllKnownScopes() {
  const set = new Set(knownScopes);
  if (knownScopesPersisted) for (const s of knownScopesPersisted) set.add(s);
  return Array.from(set).sort();
}

/** Subscribirse a cambios. Devuelve la función para des-subscribirse. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reset total — útil para testing/debug. */
export function resetAll() {
  scopeCache = {};
  knownScopesPersisted = new Set();
  safeStorageSet({ [STORAGE_KEY]: {}, [KNOWN_SCOPES_KEY]: [] });
}

export const SCOPES_STORAGE_KEY = STORAGE_KEY;
export const KNOWN_SCOPES_STORAGE_KEY = KNOWN_SCOPES_KEY;
