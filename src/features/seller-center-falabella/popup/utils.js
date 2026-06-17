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

// ---------------------------------------------------------------------------
// Parser de CSV
// ---------------------------------------------------------------------------

/** Detecta el delimitador más probable mirando la primera línea no vacía. */
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const candidates = [
    { ch: ';', n: (firstLine.match(/;/g) || []).length },
    { ch: '\t', n: (firstLine.match(/\t/g) || []).length },
    { ch: ',', n: (firstLine.match(/,/g) || []).length },
  ];
  candidates.sort((a, b) => b.n - a.n);
  return candidates[0].n > 0 ? candidates[0].ch : ',';
}

/**
 * Parsea CSV a una matriz de filas (cada fila es un array de celdas). Soporta
 * comillas dobles (con escape `""`), saltos de línea dentro de celdas citadas,
 * `\r\n`/`\n` y BOM inicial. Delimitador autodetectado (`,`, `;` o tab).
 */
export function parseCsv(input) {
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
  // último campo/fila (sin newline final)
  row.push(field);
  rows.push(row);

  // Descartar filas totalmente vacías (p. ej. línea en blanco final).
  const cleaned = rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
  return { rows: cleaned, delimiter };
}

/**
 * Separa una celda "Nro Guia" en uno o más números. Se separan por espacios,
 * saltos de línea, `/` o `|`. NO se usan `,` ni `;` para no chocar con el
 * delimitador del CSV.
 */
export function splitGuias(cell) {
  return String(cell ?? '')
    .split(/[\s/|]+/)
    .map((g) => g.trim())
    .filter(Boolean);
}

/**
 * A partir de la matriz del CSV (con encabezado en la fila 0) arma la cola de
 * "Detalle Orden", aplicando la regla de múltiples Nro Guia: una guía => un
 * "Detalle Orden", manteniendo orden y cantidad de paquetes.
 *
 * Devuelve { detalles, errors, dataRowCount }.
 */
export function buildDetalles(rows) {
  const errors = [];
  const detalles = [];

  if (!rows.length) {
    return { detalles, errors: ['El CSV está vacío.'], dataRowCount: 0 };
  }
  if (rows.length === 1) {
    return { detalles, errors: ['El CSV sólo tiene la fila de encabezados (sin datos).'], dataRowCount: 0 };
  }

  const dataRows = rows.slice(1); // descartar encabezados
  dataRows.forEach((r, idx) => {
    const lineNo = idx + 2; // +1 por encabezado, +1 porque las líneas son 1-based
    const ordernumber = String(r[0] ?? '').trim();
    const guiaCell = r[1] ?? '';
    const cantP = String(r[2] ?? '').trim();
    const guias = splitGuias(guiaCell);

    const rowErrors = [];
    if (!ordernumber) rowErrors.push('falta "Número de orden"');
    if (guias.length === 0) rowErrors.push('falta "Nro Guia"');
    if (!cantP) rowErrors.push('falta "Cantidad de Paquetes"');

    if (rowErrors.length) {
      errors.push(`Fila ${lineNo}: ${rowErrors.join(', ')}.`);
      return;
    }

    for (const guia of guias) {
      detalles.push({ ordernumber, guia, cantP });
    }
  });

  return { detalles, errors, dataRowCount: dataRows.length };
}
