// Armado del CSV de resultados. Se usa dos veces: para el archivo que se
// descarga y para la tabla que el popup muestra en pantalla, asi que lo que se
// ve es exactamente lo que se exporta.
//
// Una orden con N transacciones genera N filas (las columnas de la orden se
// repiten); una orden sin transacciones genera una fila con el aviso.

import { GATEWAY_LABEL, LISTING_COLUMNS, ORDER_STATUS } from './constants.js';

const BASE_HEADERS = ['Orden', 'Order ID', ...LISTING_COLUMNS.filter((column) => column !== 'ID')];
const TAIL_HEADERS = ['Coincide', 'Pasarela', 'Fecha nota', 'Estado nota', 'Detalle nota'];
const META_HEADERS = ['Estado captura', 'Error', 'URL'];

const NO_TRANSACTIONS = 'Sin datos de transaccion';

/**
 * run → { headers, rows } listo para pintar o serializar.
 * @param {object} run
 * @param {{ onlyMatches?: boolean }} [opts]
 */
export function buildMatrix(run, { onlyMatches = false } = {}) {
  const items = (run?.items || []).filter((item) => item.status === ORDER_STATUS.OK || item.status === ORDER_STATUS.ERROR);
  const visible = onlyMatches ? items.filter((item) => item.matched) : items;

  const txKeys = unique(visible.flatMap((item) => (item.transactions || []).flatMap((tx) => tx.order || [])));
  const headers = [...BASE_HEADERS, ...TAIL_HEADERS, ...txKeys.map((key) => `Tx - ${key}`), ...META_HEADERS];

  const rows = [];
  visible.forEach((item) => {
    const summary = item.summary || {};
    const base = [
      item.incrementId || '',
      item.entityId || '',
      ...LISTING_COLUMNS.filter((column) => column !== 'ID').map((column) => summary[column] || ''),
    ];
    const meta = [statusLabel(item.status), item.error || '', item.viewHref || ''];
    const transactions = item.transactions || [];
    const matchedIndexes = new Set(item.matchedIndexes || []);

    if (!transactions.length) {
      rows.push([...base, item.matched ? 'SI' : 'NO', NO_TRANSACTIONS, '', '', '', ...txKeys.map(() => ''), ...meta]);
      return;
    }

    transactions.forEach((tx, index) => {
      if (onlyMatches && matchedIndexes.size && !matchedIndexes.has(index)) return;
      rows.push([
        ...base,
        matchedIndexes.has(index) ? 'SI' : 'NO',
        GATEWAY_LABEL[tx.gateway] || tx.gateway || '',
        tx.when || '',
        tx.noteStatus || '',
        tx.title || '',
        ...txKeys.map((key) => tx.values?.[key] || ''),
        ...meta,
      ]);
    });
  });

  return { headers, rows };
}

/** Matriz → texto CSV (con BOM para que Excel respete los acentos). */
export function matrixToCsv({ headers, rows }) {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

export function buildPurchaseSearchCsv(run, opts) {
  return matrixToCsv(buildMatrix(run, opts));
}

function statusLabel(status) {
  if (status === ORDER_STATUS.OK) return 'OK';
  if (status === ORDER_STATUS.ERROR) return 'Error';
  return status || '';
}

function csvCell(value) {
  const safe = protectFormula(String(value ?? ''));
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Excel ejecuta lo que empieza con =, +, @ o un guion seguido de texto. */
function protectFormula(value) {
  return /^[=+@\t\r]/.test(value) || /^-[^\d]/.test(value) ? `'${value}` : value;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export const __test = { csvCell, protectFormula };
