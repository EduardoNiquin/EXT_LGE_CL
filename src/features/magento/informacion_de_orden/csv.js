// Armado del CSV. Se usa dos veces: para el archivo que se descarga y para la
// tabla que el popup muestra, asi que lo que se ve es exactamente lo que se
// exporta.
//
// Una fila por orden. La forma del CSV la manda la ficha, y la ficha no tiene
// un conjunto fijo de campos: las filas cambian entre ordenes (la de
// marketplace no trae IP, el bloque de pago no muestra los mismos campos segun
// la pasarela, el descuento lleva el nombre de la promocion...). Por eso los
// campos de la ficha se emiten como columnas DINAMICAS "<seccion> - <etiqueta>"
// y el encabezado es la union estable de lo que aparecio en todas las ordenes.
//
// Sobre esa union hay DOS PERFILES (`buildMatrix(records, { allColumns })`):
// por defecto salen solo las columnas de `ESSENTIAL_COLUMNS`, en ese orden y
// siempre las mismas aunque una corrida no las traiga todas; con
// `allColumns: true` sale la union completa, como antes.
//
// La union se puede pasar hecha (`{ columns }`): el resultado se exporta EN
// PARTES y todas tienen que llevar el mismo encabezado, asi que la union se
// acumula durante la captura (`recordColumnKeys` + `mergeColumns`) y se guarda
// en el indice, en vez de recalcularse por parte (que daria archivos con
// columnas distintas, imposibles de unir).
//
// Los campos que traen varios datos NO se aplanan con separadores: van como
// JSON (el historial, los items de una orden con mas de un producto, el bloque
// de envio de cada item). Asi se pueden volver a leer sin adivinar donde corta
// cada valor.

import {
  ESSENTIAL_COLUMNS,
  GRID_COLUMNS,
  HISTORY_MAX_CHARS,
  ITEM_COLUMNS,
  ITEM_JOIN,
  LABELED_ITEM_COLUMNS,
  META_COLUMNS,
  MONEY_ITEM_COLUMNS,
  MONEY_SECTIONS,
  DATE_FIELD_PREFIXES,
  ORDER_STATUS,
  PAYMENT_COLUMNS,
} from './constants.js';
import { moneyValue, stripHtml } from './grid-parse.js';
import {
  listCell,
  moneyNumber,
  normalizeDateTime,
  normalizeMoney,
  parseComment,
  scalarCell,
  splitLabeled,
} from './format.js';
import { normalizePayment } from './payment.js';

const STATUS_LABEL = {
  [ORDER_STATUS.OK]: 'OK',
  [ORDER_STATUS.NOT_FOUND]: 'No encontrada',
  [ORDER_STATUS.ERROR]: 'Error',
  [ORDER_STATUS.PENDING]: 'Pendiente',
};

const FIXED_COLUMNS = [...GRID_COLUMNS, ...PAYMENT_COLUMNS];
const EXTRA_FIXED = ['URL', 'Estado (ficha)'];
const HISTORY_HEADERS = ['Notas', 'Historial'];

/**
 * Orden capturada -> registro compacto.
 *
 * Los items y las notas se guardan CRUDOS: el aplanado a celda depende del
 * perfil de columnas, que se elige al exportar y no al capturar.
 *
 * @param {object} o
 * @param {object} o.item     item del grid (identifica la orden y trae el pago crudo)
 * @param {object} o.detail   lo leido de la ficha
 * @param {string} o.viewHref enlace de la orden
 */
export function buildRecord({ item = {}, detail = null, viewHref = '' } = {}) {
  const payment = normalizePayment(item);
  const fixed = FIXED_COLUMNS.map((column) => {
    const source = column.pay ? payment[column.pay] : item[column.key];
    return column.money ? moneyValue(source) : stripHtml(source);
  });

  const detailValues = {};
  for (const field of detail?.fields || []) {
    const key = `${field.section} - ${field.label}`;
    const value = normalizeField(field);
    // Una etiqueta repetida dentro de la misma seccion (pasa en los logs) se
    // concatena en vez de pisarse.
    detailValues[key] = detailValues[key] ? `${detailValues[key]}${ITEM_JOIN}${value}` : value;
  }

  return {
    incrementId: stripHtml(item.increment_id) || detail?.orderNumber || '',
    entityId: stripHtml(item.entity_id),
    viewHref,
    status: ORDER_STATUS.OK,
    error: '',
    fixed,
    extra: [viewHref, detail?.status || ''],
    detail: detailValues,
    itemRows: detail?.items || [],
    notes: detail?.notes || [],
  };
}

/** Una orden que se pidio y el grid no devolvio, o cuya ficha fallo. */
export function makeMissingRecord(incrementId, {
  status = ORDER_STATUS.NOT_FOUND,
  error = '',
  item = null,
  viewHref = '',
} = {}) {
  const base = item
    ? buildRecord({ item, viewHref })
    : {
      incrementId: String(incrementId),
      entityId: '',
      viewHref,
      fixed: FIXED_COLUMNS.map((column) => (column.key === 'increment_id' ? String(incrementId) : '')),
      extra: [viewHref, ''],
      detail: {},
      itemRows: [],
      notes: [],
    };
  return { ...base, status, error };
}

/**
 * Valor de un campo de la ficha listo para planilla: los importes pasan a
 * numero plano y las fechas largas a "YYYY-MM-DD HH:mm:ss". El resto tal cual.
 */
function normalizeField({ section, label, value }) {
  if (MONEY_SECTIONS.has(section)) return normalizeMoney(value);
  const isDate = DATE_FIELD_PREFIXES.some(
    (rule) => rule.section === section && String(label).startsWith(rule.prefix),
  );
  return isDate ? normalizeDateTime(value) : value;
}

// -----------------------------------------------------------------------------
// Items
// -----------------------------------------------------------------------------

/**
 * Los productos de la orden. Con un solo item la celda lleva el valor pelado;
 * con varios lleva un array JSON con una posicion POR ITEM (los faltantes van
 * como `null`), asi las columnas de items se leen alineadas entre si.
 *
 * Cada columna busca su dato entre varios encabezados posibles porque el nombre
 * cambia entre versiones de la pantalla.
 */
function itemColumns(items) {
  if (!items.length) return {};
  const out = { Items: String(items.length) };
  for (const { label, values } of itemColumnEntries(items)) {
    out[label] = items.length === 1 ? scalarCell(values[0]) : listCell(values);
  }
  return out;
}

/**
 * Las columnas de items que SI traen dato, con sus valores por item. Separado de
 * `itemColumns` para poder preguntar solo por las etiquetas: la union de
 * columnas se calcula en CADA orden capturada, y armar ahi las celdas seria
 * pagar dos veces el JSON de los items.
 */
function itemColumnEntries(items) {
  const entries = [];
  for (const column of ITEM_COLUMNS) {
    const values = items.map((item) => itemValue(column, pickHeader(item, column.headers)));
    if (values.every((value) => value === null)) continue;
    entries.push({ label: column.label, values });
  }
  return entries;
}

/** Numero si la columna es un importe, objeto si trae un bloque de campos. */
function itemValue(column, raw) {
  if (!raw) return null;
  if (MONEY_ITEM_COLUMNS.has(column.label)) return moneyNumber(raw) ?? raw;
  const labels = LABELED_ITEM_COLUMNS[column.label];
  if (labels) return splitLabeled(raw, labels) ?? raw;
  return raw;
}

function pickHeader(item, headers) {
  for (const header of headers) {
    if (item[header]) return item[header];
  }
  // Tolerancia: el mismo nombre con otra capitalizacion o espacios de mas.
  const keys = Object.keys(item);
  for (const header of headers) {
    const found = keys.find((key) => key.toLowerCase() === header.toLowerCase());
    if (found && item[found]) return item[found];
  }
  return '';
}

// -----------------------------------------------------------------------------
// Historial
// -----------------------------------------------------------------------------

/**
 * El historial completo en una celda, como array JSON (la nota mas nueva
 * primero, que es el orden en que la ficha las lista).
 *
 * El tope NO se aplica cortando el texto: eso dejaria un JSON invalido. Se
 * descartan las notas mas viejas y se deja constancia de cuantas faltan.
 */
function historyCell(notes) {
  if (!notes.length) return '';
  const entries = notes.map((note) => {
    const entry = {};
    if (note.when) entry.fecha = normalizeDateTime(note.when);
    if (note.noteStatus) entry.estado = note.noteStatus;
    const comment = parseComment(note.comment);
    if (comment) entry.comentario = comment;
    return entry;
  });

  let kept = entries.length;
  let text = JSON.stringify(entries);
  while (text.length > HISTORY_MAX_CHARS && kept > 1) {
    kept -= 1;
    text = JSON.stringify([...entries.slice(0, kept), { omitidas: entries.length - kept }]);
  }
  return text;
}

// -----------------------------------------------------------------------------
// Matriz
// -----------------------------------------------------------------------------

/**
 * Registros -> { headers, rows } listo para pintar o serializar.
 * @param {object[]} records
 * @param {object} [opts]
 * @param {boolean} [opts.allColumns] true = la union completa de columnas
 * @param {string[]|null} [opts.columns] union ya calculada (la de TODA la
 *   corrida). Hace falta para que las partes de un mismo resultado salgan con el
 *   mismo encabezado; sin ella la union se saca de `records`, que solo es
 *   correcto cuando son todos los registros.
 */
export function buildMatrix(records, { allColumns = false, columns = null } = {}) {
  const list = Array.isArray(records) ? records : [];
  const cells = list.map(recordCells);

  let headers;
  if (!allColumns) headers = [...ESSENTIAL_COLUMNS, ...META_COLUMNS];
  else if (columns?.length) headers = [...columns, ...META_COLUMNS];
  else headers = [...unionKeys(cells), ...META_COLUMNS];

  const rows = list.map((record, index) => headers.map((header) => {
    if (header === META_COLUMNS[0]) return STATUS_LABEL[record.status] || record.status || '';
    if (header === META_COLUMNS[1]) return record.error || '';
    return cells[index][header] ?? '';
  }));

  return { headers, rows };
}

/**
 * Las columnas que aporta un registro, sin armar sus celdas. Es lo que se
 * acumula durante la captura para tener la union de la corrida (el encabezado
 * comun de todas las partes) sin guardar los registros ni volver a leerlos.
 *
 * No incluye META_COLUMNS: esas las agrega `buildMatrix` al final.
 */
export function recordColumnKeys(record) {
  const keys = [
    ...FIXED_COLUMNS.map((column) => column.label),
    ...EXTRA_FIXED,
    ...Object.keys(record?.detail || {}),
  ];

  const items = record?.itemRows || [];
  if (items.length) {
    keys.push('Items');
    for (const entry of itemColumnEntries(items)) keys.push(entry.label);
  } else if (record?.items) {
    keys.push(...Object.keys(record.items));
  }

  if (record?.notes?.length || record?.history?.count) keys.push(...HISTORY_HEADERS);
  return keys;
}

/**
 * Suma columnas nuevas a la union conservando el orden de aparicion (el mismo
 * criterio que `unionKeys`). Devuelve el arreglo recibido si no hubo novedad,
 * asi el caso normal --una orden mas que no trae ninguna columna nueva-- no
 * copia nada.
 */
export function mergeColumns(columns, keys) {
  const current = Array.isArray(columns) ? columns : [];
  const seen = new Set(current);
  let out = current;
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (out === current) out = [...current];
    out.push(key);
  }
  return out;
}

/** Todas las celdas de un registro, indexadas por el nombre de su columna. */
function recordCells(record) {
  const out = {};
  const fixed = pad(record.fixed, FIXED_COLUMNS.length);
  FIXED_COLUMNS.forEach((column, index) => { out[column.label] = fixed[index]; });
  const extra = pad(record.extra, EXTRA_FIXED.length);
  EXTRA_FIXED.forEach((label, index) => { out[label] = extra[index]; });

  Object.assign(out, record.detail || {});

  // `items`/`history` son la forma anterior del registro (ya aplanada). Un
  // resultado capturado antes de este cambio sigue en storage: se pinta con lo
  // que tiene en vez de quedar en blanco hasta la proxima corrida.
  if (record.itemRows || !record.items) Object.assign(out, itemColumns(record.itemRows || []));
  else Object.assign(out, record.items);

  const notes = record.notes || [];
  if (notes.length) {
    out[HISTORY_HEADERS[0]] = String(notes.length);
    out[HISTORY_HEADERS[1]] = historyCell(notes);
  } else if (record.history?.count) {
    out[HISTORY_HEADERS[0]] = String(record.history.count);
    out[HISTORY_HEADERS[1]] = record.history.text || '';
  }
  return out;
}

/** Un registro viejo o incompleto no debe correr las columnas de la derecha. */
function pad(values, size) {
  const list = Array.isArray(values) ? values.slice(0, size) : [];
  while (list.length < size) list.push('');
  return list;
}

/** Union estable de claves: la primera aparicion manda el orden. */
function unionKeys(maps) {
  const keys = [];
  const seen = new Set();
  for (const map of maps) {
    for (const key of Object.keys(map || {})) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export const CSV_EOL = '\r\n';
export const CSV_BOM = '\uFEFF'; // sin el, Excel lee el UTF-8 como latin-1

/**
 * Matriz -> texto CSV, sin BOM y sin salto de linea final.
 * `header: false` es para anexar una parte a un archivo ya empezado.
 */
export function matrixToCsvText({ headers, rows }, { header = true } = {}) {
  const lines = header ? [headers.map(csvCell).join(',')] : [];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join(CSV_EOL);
}

/** Matriz -> texto CSV completo (con BOM para que Excel respete los acentos). */
export function matrixToCsv(matrix) {
  return `${CSV_BOM}${matrixToCsvText(matrix)}`;
}

function csvCell(value) {
  const safe = protectFormula(String(value ?? ''));
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Excel ejecuta lo que empieza con =, +, @ o un guion seguido de texto. */
function protectFormula(value) {
  return /^[=+@\t\r]/.test(value) || /^-[^\d]/.test(value) ? `'${value}` : value;
}

export const __test = {
  csvCell, protectFormula, unionKeys, itemColumns, historyCell, pickHeader, recordCells,
  itemColumnEntries,
};
