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

/** "hace 3 min" — para el "conectado desde". */
export function desdeHace(ts) {
  if (!ts) return '';
  const seg = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seg < 60) return 'hace un momento';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const horas = Math.round(min / 60);
  return `hace ${horas} h`;
}

/** Parte un textarea en lineas limpias, sin vacios ni duplicados. */
export function lineas(texto) {
  const vistas = new Set();
  return String(texto || '')
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter((l) => {
      if (!l || vistas.has(l)) return false;
      vistas.add(l);
      return true;
    });
}
