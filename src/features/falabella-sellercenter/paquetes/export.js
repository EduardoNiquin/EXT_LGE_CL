// Salidas de "Identificar paquetes": texto para pegar, filas para CSV/Excel.
// Puro: el .xlsx se arma en el popup con estas mismas filas.

import { EXPORT_FILENAME_PREFIX } from '../constants.js';

// BOM UTF-8: sin el, Excel abre el CSV como ANSI y rompe las tildes.
const BOM = String.fromCharCode(0xfeff);

export const HEADERS = [
  'Orden',
  'Fecha creacion',
  'Estado orden',
  'Estado items',
  'Productos',
  'Paquetes',
  'Paquetes faltantes',
  'SKU',
  'Producto',
  'PackageId',
  'Guia',
  'Promesa de despacho',
  'OrderId (API)',
];

export function filas(hallazgos) {
  return (hallazgos || []).map((h) => [
    h.orderNumber,
    h.createdAt,
    h.estados.join(', '),
    h.estadosItems.join(', '),
    h.productos,
    h.paquetes,
    h.paquetesFaltantes,
    h.skus,
    h.nombres.join(' | '),
    h.packageIds.join(', '),
    h.guias.join(', '),
    h.promesa,
    h.orderId,
  ]);
}

export function buildCsv(hallazgos) {
  return `${BOM}${[HEADERS, ...filas(hallazgos)].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

function csvCell(value) {
  const safe = protectFormula(String(value ?? ''));
  return `"${safe.replace(/"/g, '""')}"`;
}

// Excel ejecutaria lo que empieza con =, +, @ o "-texto" (los nombres de
// producto son texto libre).
function protectFormula(value) {
  return /^[=+@\t\r]/.test(value) || /^-[^\d]/.test(value) ? `'${value}` : value;
}

/** Texto plano para pegar en un chat o correo: una linea por orden. */
export function buildTexto(hallazgos, { desde, hasta } = {}) {
  const lista = hallazgos || [];
  const head = `Ordenes con productos agrupados en un solo paquete (${desde || '?'} a ${hasta || '?'}): ${lista.length}`;
  const lineas = lista.map((h) =>
    `${h.orderNumber} — ${h.productos} productos en ${h.paquetes} paquete(s) — ${h.skus} — ${h.estados.join('/')} — ${h.packageIds.join(', ')}`);
  return [head, ...lineas].join('\n');
}

export function exportFilename(desde, hasta, ext) {
  return `${EXPORT_FILENAME_PREFIX}-${desde || 'x'}_${hasta || 'x'}.${ext}`;
}
