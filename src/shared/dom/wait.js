// Primitivas de espera para DOMs asíncronos / SPAs.
// Diseño:
//   - Todas las esperas son acotadas por timeout y devuelven una Promise.
//   - El predicado puede devolver el valor que se quiere "salvar" (truthy).
//   - Se respeta una señal de cancelación externa (AbortSignal).
//   - Errores son explícitos con el motivo, no genéricos.

export class WaitTimeoutError extends Error {
  constructor(message, { lastValue } = {}) {
    super(message);
    this.name = 'WaitTimeoutError';
    this.lastValue = lastValue;
  }
}

export class WaitAbortedError extends Error {
  constructor(message = 'Espera cancelada') {
    super(message);
    this.name = 'WaitAbortedError';
  }
}

/**
 * Espera a que `predicate()` devuelva un valor truthy.
 * Devuelve ese valor. Si vence el timeout o se cancela, rechaza.
 *
 * @param {() => any} predicate
 * @param {{ timeout?: number, interval?: number, signal?: AbortSignal, description?: string }} [opts]
 */
export function waitFor(predicate, opts = {}) {
  const { timeout = 10000, interval = 80, signal, description = 'condición' } = opts;
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    let lastValue;

    const onAbort = () => {
      clearTimeout(handle);
      reject(new WaitAbortedError(`Espera cancelada esperando ${description}`));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });

    let handle;
    const tick = () => {
      try {
        lastValue = predicate();
      } catch (err) {
        signal?.removeEventListener('abort', onAbort);
        reject(err);
        return;
      }
      if (lastValue) {
        signal?.removeEventListener('abort', onAbort);
        resolve(lastValue);
        return;
      }
      elapsed += interval;
      if (elapsed >= timeout) {
        signal?.removeEventListener('abort', onAbort);
        reject(
          new WaitTimeoutError(
            `Timeout (${timeout}ms) esperando ${description}`,
            { lastValue },
          ),
        );
        return;
      }
      handle = setTimeout(tick, interval);
    };
    tick();
  });
}

/** Atajo: espera a que aparezca un elemento por selector. */
export function waitForElement(selector, opts = {}) {
  const root = opts.root ?? document;
  return waitFor(() => root.querySelector(selector), {
    description: `elemento "${selector}"`,
    ...opts,
  });
}

/** Atajo: espera a que un elemento desaparezca. */
export function waitForGone(selector, opts = {}) {
  const root = opts.root ?? document;
  return waitFor(() => !root.querySelector(selector) || null, {
    description: `que desaparezca "${selector}"`,
    ...opts,
  });
}

/** Sleep cancellable. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new WaitAbortedError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new WaitAbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
