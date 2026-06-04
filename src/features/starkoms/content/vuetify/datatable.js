// Helpers para leer tablas de Vuetify (v-data-table) y la tabla de productos
// del detalle de orden.
//
// Quirk del DOM de Starkoms: varias celdas vienen anidadas como
//   <td class="text-start"><td><span>valor</span></td></td>
// Los `<td>` internos NO son hijos directos del <tr> (lo es el externo), así
// que `:scope > td` devuelve las columnas alineadas correctamente y
// `.textContent` recurre al contenido interno sin problema.

import { SELECTORS } from '../../constants.js';

/** Devuelve los <td> de nivel superior de una fila (alineados a columnas). */
export function rowCells(tr) {
  return Array.from(tr.querySelectorAll(':scope > td'));
}

/**
 * Mapa { etiqueta(lowercase) → índice de columna } a partir del thead.
 * Usa `aria-label` si existe (grilla de órdenes/inventario), si no el texto del th.
 */
export function headerIndexMap(table) {
  const ths = Array.from(table.querySelectorAll('thead th'));
  const map = {};
  ths.forEach((th, i) => {
    const label = (th.getAttribute('aria-label') ?? th.textContent ?? '').trim().toLowerCase();
    if (label) map[label] = i;
  });
  return map;
}

/** Índice de una columna por etiqueta (case-insensitive, contains como rescate). */
export function colIndex(map, label) {
  const l = label.trim().toLowerCase();
  if (l in map) return map[l];
  const key = Object.keys(map).find((k) => k.includes(l));
  return key != null ? map[key] : -1;
}

/** Filas del tbody de la (primera) data-table presente. */
export function tableRows(table) {
  return Array.from(table.querySelectorAll('tbody tr'));
}

/** Texto de la celda en `index` (trim). */
export function cellTextAt(tr, index) {
  const cells = rowCells(tr);
  return (cells[index]?.textContent ?? '').trim();
}

/** Elemento <td> de nivel superior en `index` (para buscar <a>/<button> dentro). */
export function cellAt(tr, index) {
  return rowCells(tr)[index] || null;
}

/** Primera data-table del documento (o null). */
export function firstTable() {
  return document.querySelector(SELECTORS.dataTable);
}
