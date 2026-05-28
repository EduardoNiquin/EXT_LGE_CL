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

/**
 * Parsea una textarea libre con cupones (uno por línea, también admite comas o
 * punto y coma) y devuelve la lista limpia (sin vacíos, sin duplicados,
 * preservando el orden).
 */
export function parseQueries(raw) {
  if (!raw) return [];
  const tokens = String(raw)
    .split(/[\r\n,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
