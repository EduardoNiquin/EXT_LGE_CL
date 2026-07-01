import { EXISTS, STATUS } from '../constants.js';

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
 * Parsea el texto del textarea a una lista de SKU únicos, preservando el orden.
 * Separadores: saltos de línea, comas, punto y coma, tabs o espacios. Los SKU
 * pueden contener puntos (ej "75QNED85BSG.AWH"), así que no se tocan.
 */
export function parseSkus(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? '').split(/[\s,;]+/)) {
    const sku = raw.trim();
    if (!sku) continue;
    const key = sku.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sku);
  }
  return out;
}

/** Etiqueta de existencia de un item resuelto (YES/NO), o null si no aplica. */
export function existsLabel(item) {
  if (item?.status !== STATUS.OK || item.found == null) return null;
  return item.found ? EXISTS.YES : EXISTS.NO;
}

/** Escapa una celda para CSV (comillas si hace falta). */
function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV de resultados: dos columnas (SKU, Existe en PIM). Los SKU con error se
 * marcan como ERROR. BOM UTF-8 para que Excel abra bien.
 */
export function buildCsv(items) {
  const BOM = String.fromCharCode(0xFEFF);
  const lines = ['SKU,Existe en PIM'];
  for (const it of items || []) {
    const label = existsLabel(it) ?? (it.status === STATUS.ERROR ? 'ERROR' : '');
    lines.push(`${csvCell(it.sku)},${csvCell(label)}`);
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** Texto para copiar: una línea por SKU en formato "SKU/YES" o "SKU/NO". */
export function buildCopyText(items) {
  return (items || [])
    .map((it) => `${it.sku}/${existsLabel(it) ?? (it.status === STATUS.ERROR ? 'ERROR' : '')}`)
    .join('\n');
}

/** Dispara la descarga de un texto como archivo, sin permisos extra. */
export function downloadText(text, filename, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copia texto al portapapeles con fallback a execCommand. */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
