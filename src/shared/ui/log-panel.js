// Panel de logs reutilizable (desplegable) por feature/sección.
//
// QoL (item 6): mostrar, dentro de cada apartado, únicamente los logs del
// proceso que corre/corrió ahí mismo — sin tener que bucear en la consola de
// DevTools. Se alimenta del array `log` del estado de ejecución (run.log) que
// cada feature ya persiste en chrome.storage.local.
//
// Es agnóstico de la feature: recibe las entradas y pinta. La consistencia
// visual sale de las clases `.log-panel` definidas en popup.css.

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Genera el HTML de un panel de logs desplegable. Pegar en un `innerHTML`.
 * Mantener el `data-log-panel` para poder ubicar el `<ul>` luego.
 *
 * @param {object} [opts]
 * @param {string} [opts.title='Registro']
 * @param {boolean} [opts.open=false]
 * @param {string} [opts.id]  id opcional para el <ul>
 */
export function logPanelHtml({ title = 'Registro', open = false, id = '' } = {}) {
  return `
    <details class="log-panel" ${open ? 'open' : ''}>
      <summary class="log-panel-summary">
        <span class="log-panel-title">${escapeHtml(title)}</span>
        <span class="log-panel-count" data-log-count></span>
      </summary>
      <ul class="log-panel-list" ${id ? `id="${id}"` : ''} data-log-panel></ul>
    </details>
  `;
}

/**
 * Rellena un panel de logs ya montado.
 *
 * @param {HTMLElement} root  contenedor donde está el `[data-log-panel]`.
 * @param {Array<{ts:number, level:string, message:string}>} entries
 * @param {object} [opts]
 * @param {number} [opts.max=80]  máximo de líneas mostradas (las más nuevas).
 */
export function renderLogPanel(root, entries, { max = 80 } = {}) {
  if (!root) return;
  const list = root.matches?.('[data-log-panel]') ? root : root.querySelector('[data-log-panel]');
  if (!list) return;

  const all = Array.isArray(entries) ? entries : [];
  const shown = all.slice(-max).reverse();

  list.innerHTML = shown.map((e) => `
    <li class="log-panel-item log-panel-item--${escapeHtml(e.level || 'info')}">
      <span class="log-panel-time">${formatTime(e.ts)}</span>
      <span class="log-panel-msg">${escapeHtml(e.message)}</span>
    </li>
  `).join('') || '<li class="log-panel-empty">Sin entradas todavía.</li>';

  const countEl = root.querySelector?.('[data-log-count]');
  if (countEl) countEl.textContent = all.length ? String(all.length) : '';
}
