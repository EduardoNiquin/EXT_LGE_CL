// Recorder central de errores de la extensión.
//
// Mantiene un ring buffer de los últimos errores en chrome.storage.local para
// que sean inspeccionables desde el popup (Ajustes → "Errores recientes"),
// incluso después de que ocurrieron y sin tener que abrir la consola de
// DevTools del contexto correcto (content script / service worker).
//
// Fuentes que alimentan el recorder:
//   - logger().error(...)            (ver shared/utils/logger.js)
//   - installGlobalErrorCapture()    (window.onerror / unhandledrejection)
//   - recordError() directo          (catch explícitos que quieran registrar)
//
// El buffer se escribe con coalescing (un solo set por microtask burst) para no
// martillar storage si caen muchos errores juntos.

import { describeError } from '../errors/index.js';

const STORAGE_KEY = 'diagnostics:errors';
const CAP = 60;

let buffer = null;            // Array<descriptor> | null mientras carga
let loaded = false;
const pending = [];           // errores registrados antes de cargar
const listeners = new Set();

function safeGet(keys) {
  try { return chrome.storage.local.get(keys); } catch { return Promise.resolve({}); }
}
function safeSet(obj) {
  try { return chrome.storage.local.set(obj); } catch { return Promise.resolve(); }
}

safeGet([STORAGE_KEY]).then((res) => {
  buffer = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
  loaded = true;
  if (pending.length) {
    buffer.push(...pending.splice(0));
    trim();
    schedulePersist();
  }
  emit();
});

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    buffer = Array.isArray(changes[STORAGE_KEY].newValue) ? changes[STORAGE_KEY].newValue : [];
    emit();
  });
} catch { /* contexto sin chrome.storage */ }

function emit() {
  const snapshot = buffer || [];
  for (const l of listeners) {
    try { l(snapshot); } catch { /* noop */ }
  }
}

function trim() {
  if (buffer.length > CAP) buffer.splice(0, buffer.length - CAP);
}

let persistScheduled = false;
function schedulePersist() {
  if (persistScheduled) return;
  persistScheduled = true;
  Promise.resolve().then(() => {
    persistScheduled = false;
    if (buffer) safeSet({ [STORAGE_KEY]: buffer });
  });
}

/**
 * Registra un error en el ring buffer. Acepta un Error o cualquier valor;
 * `meta` agrega { context, scope, extra }.
 */
export function recordError(err, meta = {}) {
  const descriptor = describeError(err, meta);
  if (!loaded) {
    pending.push(descriptor);
    emit();
    return descriptor;
  }
  buffer.push(descriptor);
  trim();
  schedulePersist();
  emit();
  return descriptor;
}

/** Snapshot sincrónico de los errores capturados (más viejos primero). */
export function getErrors() {
  return (buffer || []).slice();
}

/** Vacía el ring buffer (persiste). */
export function clearErrors() {
  buffer = [];
  pending.length = 0;
  schedulePersist();
  emit();
}

/** Subscribirse a cambios del buffer. Devuelve la desuscripción. */
export function subscribeErrors(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Idempotencia por contexto: no instalar los handlers globales dos veces.
let globalCaptureInstalled = false;

/**
 * Instala captura global de errores no atrapados para este contexto
 * (content script / popup / service worker). Idempotente.
 */
export function installGlobalErrorCapture(context = 'unknown') {
  if (globalCaptureInstalled) return;
  globalCaptureInstalled = true;

  const onError = (event) => {
    const err = event?.error || event?.message || 'Error global';
    recordError(err, { context, scope: 'window.onerror' });
  };
  const onRejection = (event) => {
    recordError(event?.reason ?? 'Promise rejection', { context, scope: 'unhandledrejection' });
  };

  try { self.addEventListener('error', onError); } catch { /* noop */ }
  try { self.addEventListener('unhandledrejection', onRejection); } catch { /* noop */ }
}

export const DIAGNOSTICS_STORAGE_KEY = STORAGE_KEY;
export const DIAGNOSTICS_CAP = CAP;
