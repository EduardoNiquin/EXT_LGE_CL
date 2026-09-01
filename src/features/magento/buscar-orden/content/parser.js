// Lectura del DOM: filas del listado de ordenes y notas del detalle.

import {
  LISTING_COLUMNS,
  ORDER_VIEW_URL_RE,
  SELECTORS,
} from '../constants.js';
import { buildTransaction } from '../transactions.js';
import { findOrdersTable } from './detector.js';

export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function getTableHeaders(table) {
  return Array.from(table?.querySelectorAll('thead th') || []).map((th) =>
    normalizeText(th.querySelector('.data-grid-cell-content')?.textContent || th.textContent));
}

/**
 * Filas visibles del listado → ordenes.
 * De las 100+ columnas del grid solo se guardan las de LISTING_COLUMNS: copiar
 * el resto por cada orden infla el storage sin aportar nada al CSV.
 */
export function parseOrderRows() {
  const table = findOrdersTable();
  if (!table) return [];
  const headers = getTableHeaders(table);

  return Array.from(table.querySelectorAll(SELECTORS.gridRow)).map((row) => {
    const cells = Array.from(row.querySelectorAll(':scope > td'));
    const summary = {};
    headers.forEach((header, index) => {
      if (LISTING_COLUMNS.includes(header)) summary[header] = readCell(cells[index]);
    });

    const anchor = row.querySelector(SELECTORS.viewLink);
    const viewHref = anchor?.href || anchor?.getAttribute('href') || '';
    // El "ID" de la columna es el increment id de la orden (123001395553); el
    // que Magento pone en la URL del detalle es el entity_id, otro numero.
    const entityId = viewHref.match(ORDER_VIEW_URL_RE)?.[1] || '';

    return {
      incrementId: normalizeText(summary.ID || ''),
      entityId,
      viewHref,
      summary,
    };
  }).filter((order) => order.viewHref && order.entityId);
}

/** Numero de orden que muestra el detalle (para cotejar con el del listado). */
export function readOrderNumber() {
  const title = normalizeText(document.querySelector(SELECTORS.orderTitle)?.textContent);
  return title.match(/#\s*(\S+)/)?.[1] || '';
}

/** Notas de la orden abierta → transacciones normalizadas. */
export function parseOrderTransactions() {
  return Array.from(document.querySelectorAll(SELECTORS.noteItem))
    .map((li) => {
      const date = normalizeText(li.querySelector(SELECTORS.noteDate)?.textContent);
      const time = normalizeText(li.querySelector(SELECTORS.noteTime)?.textContent);
      const noteStatus = normalizeText(li.querySelector(SELECTORS.noteStatus)?.textContent);
      const commentEl = li.querySelector(SELECTORS.noteComment);
      if (!commentEl) return null;
      return buildTransaction({
        when: [date, time].filter(Boolean).join(' '),
        noteStatus,
        comment: commentToText(commentEl),
      });
    })
    .filter(Boolean);
}

/** El comentario usa <br> como salto de linea; el texto plano los pierde. */
function commentToText(el) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(el.innerHTML || '').replace(/<br\s*\/?>/gi, '\n');
  return tmp.textContent || '';
}

function readCell(cell) {
  if (!cell) return '';
  return normalizeText(cell.querySelector('.data-grid-cell-content')?.textContent || cell.textContent);
}
