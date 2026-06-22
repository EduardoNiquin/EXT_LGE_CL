// Núcleo de manejo de errores de la extensión.
//
// Objetivo: dejar de repetir `err?.message || String(err)` y el chequeo
// `err instanceof WaitAbortedError || signal.aborted` por todo el código, y
// darle a los errores una forma estructurada (code/context/cause) que el
// recorder de diagnóstico (shared/diagnostics) pueda serializar.
//
// Sin dependencias de `chrome.*` ni de otros módulos shared → seguro de
// importar desde cualquier contexto (content, popup, service worker).

/**
 * Error base de la extensión. Las features pueden extenderlo para tipar sus
 * fallos (ej. SkuNotFoundError) y obtener gratis `code`, `context` y `cause`.
 */
export class ExtError extends Error {
  constructor(message, { code = 'EXT_ERROR', context = null, cause = null } = {}) {
    super(message);
    this.name = 'ExtError';
    this.code = code;
    this.context = context;
    if (cause != null) this.cause = cause;
  }
}

/**
 * Mensaje legible de cualquier valor lanzado. Reemplaza el patrón
 * `err?.message || String(err)` repetido por todo el código.
 */
export function toMessage(err) {
  if (err == null) return 'Error desconocido';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.name || 'Error';
  if (typeof err.message === 'string') return err.message;
  try {
    return String(err);
  } catch {
    return 'Error no serializable';
  }
}

/**
 * `true` si el error proviene de una cancelación (AbortController / AbortSignal
 * / nuestras WaitAbortedError). Centraliza el chequeo que estaba duplicado en
 * cada runner. Acepta además un `signal` opcional para cubrir el caso en que el
 * abort llegó por otra vía pero el error es genérico.
 */
export function isAbortError(err, signal = null) {
  if (signal?.aborted) return true;
  if (err == null) return false;
  const name = err.name || err.constructor?.name;
  return name === 'WaitAbortedError' || name === 'AbortError';
}

/**
 * Forma serializable de un error, lista para guardar en storage o loggear.
 * Recorta el stack para no inflar el ring buffer.
 */
export function describeError(err, { context = null, scope = null, extra = null } = {}) {
  const base = {
    name: 'Error',
    message: toMessage(err),
    code: err?.code ?? null,
    context,
    scope,
    stack: null,
    extra: extra ?? null,
    ts: Date.now(),
  };
  if (err instanceof Error) {
    base.name = err.name || 'Error';
    if (typeof err.stack === 'string') {
      base.stack = err.stack.split('\n').slice(0, 12).join('\n');
    }
    if (err.context != null && base.extra == null) base.extra = err.context;
  }
  return base;
}
