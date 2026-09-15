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

import {
  GRID_COLUMNS,
  HISTORY_JOIN,
  HISTORY_MAX_CHARS,
  ITEM_COLUMNS,
  ITEM_JOIN,
  META_COLUMNS,
  ORDER_STATUS,
  PAYMENT_COLUMNS,
} from './constants.js';
import { moneyValue, stripHtml } from './grid-parse.js';
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
    const key = columnKey(field.section, field.label);
    // Una etiqueta repetida dentro de la misma seccion (pasa en los logs) se
    // concatena en vez de pisarse.
    detailValues[key] = detailValues[key] ? `${detailValues[key]}${ITEM_JOIN}${field.value}` : field.value;
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
    items: summarizeItems(detail?.items || []),
    history: summarizeHistory(detail?.notes || []),
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
      items: {},
      history: { count: 0, text: '' },
    };
  return { ...base, status, error };
}

/**
 * Los productos de la orden, concatenados con " | " para que la fila por orden
 * no pierda el detalle. Cada columna busca su dato entre varios encabezados
 * posibles porque el nombre cambia entre versiones de la pantalla.
 */
function summarizeItems(items) {
  if (!items.length) return {};
  const out = { Items: String(items.length) };
  for (const column of ITEM_COLUMNS) {
    const values = items.map((item) => pickHeader(item, column.headers)).filter(Boolean);
    if (values.length) out[column.label] = values.join(ITEM_JOIN);
  }
  return out;
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

/** El historial completo en una celda, con tope para no reventar la planilla. */
function summarizeHistory(notes) {
  if (!notes.length) return { count: 0, text: '' };
  const text = notes
    .map((note) => [note.when, note.noteStatus, note.comment].filter(Boolean).join(' - '))
    .join(HISTORY_JOIN);
  return {
    count: notes.length,
    text: text.length > HISTORY_MAX_CHARS ? `${text.slice(0, HISTORY_MAX_CHARS)}...` : text,
  };
}

function columnKey(section, label) {
  return `${section} - ${label}`;
}

/**
 * Registros -> { headers, rows } listo para pintar o serializar.
 * @param {object[]} records
 */
export function buildMatrix(records) {
  const list = Array.isArray(records) ? records : [];
  const detailKeys = unionKeys(list.map((record) => record.detail));
  const itemKeys = unionKeys(list.map((record) => record.items));

  const headers = [
    ...FIXED_COLUMNS.map((column) => column.label),
    ...EXTRA_FIXED,
    ...detailKeys,
    ...itemKeys,
    ...HISTORY_HEADERS,
    ...META_COLUMNS,
  ];

  const rows = list.map((record) => [
    ...pad(record.fixed, FIXED_COLUMNS.length),
    ...pad(record.extra, EXTRA_FIXED.length),
    ...detailKeys.map((key) => record.detail?.[key] ?? ''),
    ...itemKeys.map((key) => record.items?.[key] ?? ''),
    record.history?.count ? String(record.history.count) : '',
    record.history?.text || '',
    STATUS_LABEL[record.status] || record.status || '',
    record.error || '',
  ]);

  return { headers, rows };
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

/** Matriz -> texto CSV (con BOM para que Excel respete los acentos). */
export function matrixToCsv({ headers, rows }) {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

function csvCell(value) {
  const safe = protectFormula(String(value ?? ''));
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Excel ejecuta lo que empieza con =, +, @ o un guion seguido de texto. */
function protectFormula(value) {
  return /^[=+@\t\r]/.test(value) || /^-[^\d]/.test(value) ? `'${value}` : value;
}

export const __test = { csvCell, protectFormula, unionKeys, summarizeItems, summarizeHistory, pickHeader };
