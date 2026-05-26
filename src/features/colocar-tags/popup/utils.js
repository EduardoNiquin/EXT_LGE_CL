export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Attach a one-shot watchdog that fires if the port doesn't receive any
 * message within `timeoutMs` after START. Si no llega ningún mensaje, suele
 * indicar que ningún frame en la pestaña activa detectó la pantalla esperada
 * (MIM no abierta, pestaña incorrecta, etc.).
 *
 * Devuelve un objeto con dos métodos:
 *   - clear(): cancela el watchdog (llamar al recibir el primer mensaje).
 *   - dispose(): cancela y libera referencias.
 *
 * @param {chrome.runtime.Port} port
 * @param {object} opts
 * @param {number} [opts.timeoutMs=12000]
 * @param {() => void} opts.onTimeout  callback cuando dispara
 */
export function attachPortWatchdog(port, { timeoutMs = 12000, onTimeout }) {
  let fired = false;
  let handle = setTimeout(() => {
    if (fired) return;
    fired = true;
    try { port.disconnect(); } catch { /* ya cerrado */ }
    try { onTimeout(); } catch { /* swallow */ }
  }, timeoutMs);

  return {
    clear() {
      if (handle != null) {
        clearTimeout(handle);
        handle = null;
      }
    },
    dispose() {
      this.clear();
    },
  };
}
