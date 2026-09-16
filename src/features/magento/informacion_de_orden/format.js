// Normalizacion de los valores que salen al CSV. Todo puro: texto adentro,
// texto afuera.
//
// La ficha escribe para que la lea una persona, no una planilla: los importes
// vienen con simbolo y separadores ("$555.980"), las fechas en formato largo en
// ingles ("Sep 10, 2026, 07:40:08 PM") y los bloques con varios datos vienen
// aplanados en una sola linea ("Rule Name: X Expected delivery date: N/A ...").
// Aca se pasan a algo que se pueda ordenar, sumar y parsear.
//
// La trampa de los importes: el store es CLP y el punto es separador de MILES
// ("$555.980" son 555980 pesos), pero la ficha tambien emite en-US en algunas
// pantallas ("$588,565.00"). Se decide por la forma del numero, nunca por el
// locale del navegador (ver `normalizeNumber`).

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const MONEY_RE = /^(-?)\$?(-?)(\d[\d.,]*)$/;
const DATE_RE = /^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s*(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;

// -----------------------------------------------------------------------------
// Importes
// -----------------------------------------------------------------------------

/**
 * "$555.980" -> "555980" - "-$65,396.00" -> "-65396.00" - "N/A" -> "N/A".
 * Si no parece un importe devuelve el texto original: nunca se pierde el dato.
 * @param {*} value
 * @returns {string}
 */
export function normalizeMoney(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = MONEY_RE.exec(text.replace(/\s+/g, ''));
  if (!match) return text;
  const body = normalizeNumber(match[3]);
  if (body === null) return text;
  return `${match[1] || match[2] ? '-' : ''}${body}`;
}

/** El mismo importe como Number, para meterlo en un JSON. `null` si no lo es. */
export function moneyNumber(value) {
  const normalized = normalizeMoney(value);
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Decide que separador es decimal y cual de miles mirando la forma del numero.
 *
 * Con los dos presentes manda el ultimo ("1.234,56" -> coma decimal). Con uno
 * solo: repetido es de miles; una sola vez con EXACTAMENTE 3 digitos detras
 * tambien es de miles (es el caso CLP "$555.980", y en-US "$1,234" da lo
 * mismo); cualquier otra cantidad de digitos es decimal ("$539.99").
 */
function normalizeNumber(digits) {
  const dots = (digits.match(/\./g) || []).length;
  const commas = (digits.match(/,/g) || []).length;
  let decimal = '';
  if (dots && commas) {
    decimal = digits.lastIndexOf('.') > digits.lastIndexOf(',') ? '.' : ',';
  } else if (dots || commas) {
    const sep = dots ? '.' : ',';
    const tail = digits.slice(digits.lastIndexOf(sep) + 1);
    if (dots + commas === 1 && tail.length !== 3) decimal = sep;
  }

  const thousands = decimal === '.' ? ',' : '.';
  let body = digits.split(thousands).join('');
  if (decimal === ',') body = body.replace(',', '.');
  else if (!decimal) body = body.split(',').join('');

  return /^\d+(\.\d+)?$/.test(body) ? body : null;
}

// -----------------------------------------------------------------------------
// Fechas
// -----------------------------------------------------------------------------

/**
 * "Sep 10, 2026, 07:40:08 PM" -> "2026-09-10 19:40:08". Ordenable como texto y
 * sin el formato largo que Excel reinterpreta. Si no matchea, texto original.
 * @param {*} value
 * @returns {string}
 */
export function normalizeDateTime(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const match = DATE_RE.exec(text);
  if (!match) return text;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return text;

  let hour = Number(match[4]);
  const meridiem = (match[7] || '').toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  const pad = (n) => String(n).padStart(2, '0');
  return `${match[3]}-${pad(month)}-${pad(Number(match[2]))} ${pad(hour)}:${match[5]}:${match[6] || '00'}`;
}

// -----------------------------------------------------------------------------
// Bloques aplanados
// -----------------------------------------------------------------------------

/**
 * Bloque de varios campos que la ficha entrego en una sola linea, cortado por
 * etiquetas CONOCIDAS. No se detectan solas a proposito: los valores llevan
 * espacios y mayusculas ("Envio Normal RM + Pack OMO"), asi que un regex
 * generico parte donde no debe.
 *
 * @param {string} text
 * @param {string[]} labels  etiquetas esperadas, en cualquier orden
 * @returns {object|null} null si no aparece ninguna
 */
export function splitLabeled(text, labels) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!source) return null;

  const hits = [];
  for (const label of labels) {
    const index = source.indexOf(`${label}:`);
    if (index >= 0) hits.push({ label, index, after: index + label.length + 1 });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.index - b.index);

  const out = {};
  if (hits[0].index > 0) out.texto = source.slice(0, hits[0].index).trim();
  hits.forEach((hit, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index : source.length;
    out[hit.label] = source.slice(hit.after, end).trim();
  });
  return out;
}

/**
 * Comentario del historial -> lo mas estructurado que se pueda sacar de el: el
 * JSON que Magento deja crudo, o el objeto de un comentario "Etiqueta: valor"
 * por linea (las notas de pasarela). Si no es ninguno de los dos, texto.
 *
 * @param {string} text
 * @returns {object|string}
 */
export function parseComment(text) {
  const source = String(text ?? '').trim();
  if (!source) return '';

  const json = parseJsonText(source);
  if (json !== null) return json;

  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return source;

  const fields = {};
  const loose = [];
  for (const line of lines) {
    const match = /^([^:]{1,60}):\s*(.+)$/.exec(line);
    if (match) fields[match[1].trim()] = parseJsonText(match[2].trim()) ?? match[2].trim();
    else loose.push(line);
  }
  if (!Object.keys(fields).length) return lines.join(' ');
  return loose.length ? { texto: loose.join(' '), ...fields } : fields;
}

/** JSON embebido en un texto. `null` si no lo es (nunca lanza). */
export function parseJsonText(text) {
  const source = String(text ?? '').trim();
  if (!/^[{[]/.test(source)) return null;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Celdas
// -----------------------------------------------------------------------------

/** Un valor suelto (no lista) listo para la celda: los objetos van como JSON. */
export function scalarCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Una lista de valores en una celda, como JSON compacto. */
export function listCell(values) {
  return JSON.stringify(values.map((value) => (value === undefined ? null : value)));
}

export const __test = { normalizeNumber };
