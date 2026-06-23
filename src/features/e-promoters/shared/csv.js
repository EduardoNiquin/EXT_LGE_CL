// CSV para "Informe ordenes": parseo a array de objetos (keyed por encabezado)
// y serializacion. Sin dependencias de chrome.* — reutilizable en SW y popup.

/** Detecta el delimitador mas probable mirando la primera linea no vacia. */
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const candidates = [
    { ch: ',', n: (firstLine.match(/,/g) || []).length },
    { ch: ';', n: (firstLine.match(/;/g) || []).length },
    { ch: '\t', n: (firstLine.match(/\t/g) || []).length },
  ];
  candidates.sort((a, b) => b.n - a.n);
  return candidates[0].n > 0 ? candidates[0].ch : ',';
}

/**
 * Parsea CSV a matriz de filas (cada fila es un array de celdas). Soporta
 * comillas dobles con escape `""`, saltos de linea dentro de celdas citadas,
 * `\r\n`/`\n` y BOM inicial. Delimitador autodetectado (`,`, `;` o tab).
 */
export function parseCsvMatrix(input) {
  let text = String(input ?? '');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (text.trim() === '') return { rows: [], delimiter: ',' };

  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  rows.push(row);

  const cleaned = rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
  return { rows: cleaned, delimiter };
}

/**
 * Parsea CSV a un array de objetos usando la primera fila como encabezados.
 * Devuelve { records, headers }.
 */
export function parseCsvRecords(input) {
  const { rows } = parseCsvMatrix(input);
  if (rows.length === 0) return { records: [], headers: [] };
  const headers = rows[0].map((h) => String(h).trim());
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = r[c] ?? '';
    records.push(obj);
  }
  return { records, headers };
}

/** Escapa una celda para CSV (comillas si hay delimitador, comillas o salto). */
function escapeCell(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Serializa un array de objetos a CSV. `columns` es un array de encabezados
 * (string) o de objetos `{ out, src }`: `out` es el encabezado a escribir y
 * `src` la clave a leer del objeto. Antepone BOM para que Excel respete UTF-8.
 */
export function buildCsv(records, columns) {
  const cols = columns.map((c) => (typeof c === 'string' ? { out: c, src: c } : c));
  const header = cols.map((c) => escapeCell(c.out)).join(',');
  const lines = records.map((rec) =>
    cols.map((c) => escapeCell(rec[c.src] ?? rec[c.out] ?? '')).join(','),
  );
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n';
}
