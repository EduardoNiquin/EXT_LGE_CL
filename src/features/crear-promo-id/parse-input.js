// Lista de SKUs desde texto pegado o desde un CSV/Excel ya convertido a matriz.
// Puro: sin DOM ni chrome.*, testeable.

// Encabezados que se reconocen como "la columna de los SKUs" en un archivo.
const HEADER_RE = /^(sku|skus|sales ?model|model|modelo|product ?id|codigo|c[oó]digo)$/i;

/** Normaliza un SKU para comparar: sin espacios, en mayusculas. */
export function normalizeSku(value) {
  return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
}

function looksLikeHeader(value) {
  return HEADER_RE.test(String(value ?? '').trim());
}

function dedupe(values) {
  const seen = new Set();
  const skus = [];
  const duplicates = [];
  for (const raw of values) {
    const sku = normalizeSku(raw);
    if (!sku) continue;
    if (seen.has(sku)) { duplicates.push(sku); continue; }
    seen.add(sku);
    skus.push(sku);
  }
  return { skus, duplicates };
}

/**
 * Un SKU por linea (tambien acepta coma, punto y coma o tabulador). Las lineas
 * que empiezan con `#` se ignoran, igual que un encabezado "SKU" al principio.
 *
 * @returns {{ skus: string[], duplicates: string[] }}
 */
export function parseSkuText(text) {
  const values = [];
  String(text ?? '').split(/\r?\n/).forEach((line, index) => {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) return;
    clean.split(/[,;\t]+/).forEach((cell, col) => {
      if (index === 0 && col === 0 && looksLikeHeader(cell)) return;
      values.push(cell);
    });
  });
  return dedupe(values);
}

/**
 * Matriz de un CSV/Excel (filas de celdas). Si alguna de las primeras filas
 * trae un encabezado reconocible (SKU, Sales Model, Model...), se usa esa
 * columna; si no, la primera columna con datos.
 *
 * @param {Array<Array<unknown>>} rows
 * @returns {{ skus: string[], duplicates: string[], column: string|null }}
 */
export function parseSkuMatrix(rows) {
  const matrix = (Array.isArray(rows) ? rows : []).filter((row) => Array.isArray(row));
  let headerRow = -1;
  let col = -1;
  for (let r = 0; r < Math.min(matrix.length, 5) && col < 0; r += 1) {
    const found = matrix[r].findIndex(looksLikeHeader);
    if (found >= 0) { headerRow = r; col = found; }
  }
  if (col < 0) {
    col = 0;
    const width = Math.max(0, ...matrix.map((row) => row.length));
    for (let c = 0; c < width; c += 1) {
      if (matrix.some((row) => normalizeSku(row[c]))) { col = c; break; }
    }
  }
  const values = matrix.slice(headerRow + 1).map((row) => row[col]);
  const column = headerRow >= 0 ? String(matrix[headerRow][col]).trim() : null;
  return { ...dedupe(values), column };
}

/**
 * CSV a matriz, sin librerias: separador coma, punto y coma o tabulador (el
 * que mas aparezca en la primera linea) y comillas dobles.
 */
export function csvToMatrix(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const first = lines[0];
  const sep = [',', ';', '\t']
    .map((s) => [s, first.split(s).length])
    .sort((a, b) => b[1] - a[1])[0][0];
  return lines.map((line) => {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = !quoted;
      } else if (ch === sep && !quoted) {
        cells.push(cur); cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}
