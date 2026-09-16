// Utilidades de la vista del Registro de acciones.

export function escapeHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

/** Cronometro: hh:mm:ss mientras se graba. */
export function cronometro(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const dos = (n) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${dos(m)}:${dos(s)}` : `${dos(m)}:${dos(s)}`;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Los tipos mas frecuentes primero, para el resumen por tipo. */
export function tiposOrdenados(porTipo = {}, tope = 6) {
  return Object.entries(porTipo)
    .sort((a, b) => b[1] - a[1])
    .slice(0, tope);
}
