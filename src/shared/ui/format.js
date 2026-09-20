// Formato para HTML del popup: escapar texto y mostrar tiempos, tamanos y montos.
// (Varias features llevan copias privadas de escapeHtml/formatTime; esta es la
// version compartida para las nuevas.)

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Entero con separador de miles al estilo chileno: 8634097 -> "8.634.097". */
export function formatClp(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '';
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Number(value));
}
