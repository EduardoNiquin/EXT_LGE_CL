// Salidas de "Identificar paquetes": texto para pegar, filas para CSV/Excel.
// Puro: el .xlsx se arma en el popup con estas mismas filas.
//
// Orden de lectura en todas las salidas: ordenes por fecha de creacion (luego
// numero) y, dentro de cada orden, primero los productos que comparten paquete
// (el problema), luego el resto por paquete y al final los cancelados.
// Los montos de la orden van UNA vez por orden (hoja Ordenes, o la primera fila
// de la orden en Productos/CSV) para que sumar la columna de el total correcto.

import { EXPORT_FILENAME_PREFIX, etiquetaEstado } from '../constants.js';
import { totales } from './analisis.js';

// BOM UTF-8: sin el, Excel abre el CSV como ANSI y rompe las tildes.
const BOM = String.fromCharCode(0xfeff);

const estadosTxt = (lista) => (lista || []).map(etiquetaEstado).join(', ');
const siNo = (v) => (v ? 'Si' : 'No');

// --- Hoja "Ordenes": una fila por orden --------------------------------------

export const HEADERS_ORDENES = [
  'Orden',
  'Fecha creacion',
  'Estado orden',
  'Productos',
  'Paquetes',
  'Paquetes faltantes',
  'SKU en paquete compartido',
  'PackageId compartido',
  'Guia',
  'Total productos',
  'Envio',
  'Descuento',
  'Total orden',
  'Promesa de despacho',
  'OrderId (API)',
];

export function filasOrdenes(hallazgos) {
  return (hallazgos || []).map((h) => [
    h.orderNumber,
    h.createdAt,
    estadosTxt(h.estados),
    h.productos,
    h.paquetes,
    h.paquetesFaltantes,
    h.skus,
    h.packageIds.join(', '),
    h.guias.join(', '),
    h.montos?.productos ?? 0,
    h.montos?.envio ?? 0,
    h.montos?.descuento ?? 0,
    h.montos?.total ?? 0,
    h.promesa,
    h.orderId,
  ]);
}

/** Fila de totales al pie de la hoja Ordenes. */
export function filaTotalOrdenes(hallazgos) {
  const t = totales(hallazgos);
  const suma = (k) => (hallazgos || []).reduce((s, h) => s + (h.montos?.[k] || 0), 0);
  return [`TOTAL (${t.ordenes} ordenes)`, '', '', '', '', '', '', '', '', suma('productos'), t.envio, suma('descuento'), t.monto, '', ''];
}

// --- Hoja "Productos" / CSV: una fila por producto, agrupadas por orden ------

export const HEADERS_PRODUCTOS = [
  'Orden',
  'Fecha creacion',
  'Estado orden',
  'N°',
  'SKU',
  'Producto',
  'Estado producto',
  'Precio pagado',
  'Precio lista',
  'PackageId',
  'Comparte paquete',
  'Guia',
  'Total productos',
  'Envio',
  'Total orden',
];

export function filasProductos(hallazgos) {
  const out = [];
  for (const h of hallazgos || []) {
    const items = h.items || [];
    items.forEach((it, i) => {
      const primera = i === 0;
      out.push([
        h.orderNumber,
        h.createdAt,
        estadosTxt(h.estados),
        `${i + 1} de ${items.length}`,
        it.sku,
        it.nombre,
        etiquetaEstado(it.estado),
        it.precio,
        it.precioLista,
        it.paquete,
        siNo(it.compartido),
        it.guia,
        primera ? h.montos?.productos ?? 0 : '',
        primera ? h.montos?.envio ?? 0 : '',
        primera ? h.montos?.total ?? 0 : '',
      ]);
    });
  }
  return out;
}

export function buildCsv(hallazgos) {
  const rows = [HEADERS_PRODUCTOS, ...filasProductos(hallazgos)];
  return `${BOM}${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
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

// --- Texto para pegar ---------------------------------------------------------

const clp = (n) => `$${Math.round(n || 0).toLocaleString('es-CL')}`;

/** Texto plano para pegar en un chat o correo: una linea por orden + total. */
export function buildTexto(hallazgos, { desde, hasta, estados } = {}) {
  const lista = hallazgos || [];
  const t = totales(lista);
  const filtro = estados?.length ? ` · estados: ${estadosTxt(estados)}` : '';
  const head = `Ordenes con productos agrupados en un solo paquete (${desde || '?'} a ${hasta || '?'}${filtro}): ${t.ordenes} · monto total ${clp(t.monto)}`;
  const lineas = lista.map((h) =>
    `${h.orderNumber} — ${h.productos} productos en ${h.paquetes} paquete(s) — ${h.skus} — ${estadosTxt(h.estados)} — total ${clp(h.montos?.total)} — ${h.packageIds.join(', ')}`);
  return [head, ...lineas].join('\n');
}

export function exportFilename(desde, hasta, ext) {
  return `${EXPORT_FILENAME_PREFIX}-${desde || 'x'}_${hasta || 'x'}.${ext}`;
}
