// Lista de productos del popup de "Stock": filtro por estado, busqueda y CSV.
// PURO (sin chrome.* ni DOM).

import { ESTADO_LABEL, ESTADOS, FILTROS } from './constants.js';
import { fechaHoraChileLarga, selloArchivo } from './tiempo.js';

/** Minusculas y sin tildes, para buscar sin importar como se escribio. */
export function normalizarBusqueda(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function pasaFiltro(p, filtro) {
  if (!filtro || filtro === FILTROS.TODOS) return true;
  if (filtro === FILTROS.POCO_STOCK) return Boolean(p?.poco_stock);
  return p?.estado === filtro;
}

/**
 * Productos que pasan el filtro de estado y la busqueda. La busqueda mira
 * nombre, SKU y modelo; con varias palabras tienen que estar todas.
 */
export function filtrarProductos(productos, { filtro = FILTROS.TODOS, texto = '' } = {}) {
  const lista = Array.isArray(productos) ? productos : [];
  const terminos = normalizarBusqueda(texto).split(' ').filter(Boolean);
  return lista.filter((p) => {
    if (!pasaFiltro(p, filtro)) return false;
    if (!terminos.length) return true;
    const pajar = normalizarBusqueda(`${p?.nombre || ''} ${p?.sku || ''} ${p?.modelo || ''}`);
    return terminos.every((t) => pajar.includes(t));
  });
}

/** Cuantos productos hay en cada filtro. */
export function contarPorFiltro(productos) {
  const lista = Array.isArray(productos) ? productos : [];
  const out = { [FILTROS.TODOS]: lista.length };
  for (const f of [ESTADOS.EN_STOCK, ESTADOS.PREVENTA, ESTADOS.AGOTADO, ESTADOS.FUERA]) {
    out[f] = lista.filter((p) => p?.estado === f).length;
  }
  out[FILTROS.POCO_STOCK] = lista.filter((p) => p?.poco_stock).length;
  return out;
}

// -----------------------------------------------------------------------------
// CSV
// -----------------------------------------------------------------------------

export const CSV_COLUMNAS = [
  ['SKU', (p) => p.sku],
  ['Modelo', (p) => p.modelo],
  ['Nombre', (p) => p.nombre],
  ['Estado', (p) => ESTADO_LABEL[p.estado] || p.estado],
  ['Comprable', (p) => (p.comprable ? 'si' : 'no')],
  ['Quedan', (p) => p.quedan],
  ['Poco stock', (p) => (p.poco_stock ? 'si' : 'no')],
  ['Precio lista', (p) => p.precio_lista],
  ['Precio final', (p) => p.precio_final],
  ['Descuento %', (p) => p.descuento_pct],
  ['URL', (p) => p.url],
  ['Visto (hora Chile)', (p) => fechaHoraChileLarga(p.visto_en)],
  ['Ultimo cambio (hora Chile)', (p) => fechaHoraChileLarga(p.cambio_en)],
];

/** Un texto que Excel tomaria como formula queda con un apostrofo delante. */
function protegerFormula(valor) {
  return /^[=+@\t\r]/.test(valor) || /^-[^\d]/.test(valor) ? `'${valor}` : valor;
}

export function celdaCsv(valor) {
  const texto = protegerFormula(String(valor ?? ''));
  return `"${texto.replace(/"/g, '""')}"`;
}

/**
 * CSV de los productos (con BOM para que Excel lea UTF-8; todas las celdas
 * entre comillas). `separador` ',' por defecto, como los demas CSV del apartado.
 */
export function productosACsv(productos, { separador = ',' } = {}) {
  const lista = Array.isArray(productos) ? productos : [];
  const filas = [
    CSV_COLUMNAS.map(([titulo]) => titulo),
    ...lista.map((p) => CSV_COLUMNAS.map(([, valor]) => valor(p || {}))),
  ];
  return `\uFEFF${filas.map((fila) => fila.map(celdaCsv).join(separador)).join('\r\n')}`;
}

export function nombreCsv(ahora = Date.now(), filtro = FILTROS.TODOS) {
  const sufijo = filtro && filtro !== FILTROS.TODOS ? `-${filtro.replace(/_/g, '-')}` : '';
  return `stock-lgcom${sufijo}-${selloArchivo(ahora)}.csv`;
}
