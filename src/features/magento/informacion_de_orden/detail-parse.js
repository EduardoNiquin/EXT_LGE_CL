// Lectura de la ficha de una orden (`/sales/order/view/order_id/<id>`).
//
// Puro: recibe un `Document` (el que arma el content script con DOMParser a
// partir del HTML de esa misma URL) y devuelve datos planos. Asi se puede
// probar con fragmentos de HTML reales, sin navegador.
//
// Regla que atraviesa todo el archivo (docs/intrucciones.md seccion 5): **las
// filas varian entre ordenes**. La de marketplace no trae `Placed from IP`, el
// nombre de la zona horaria cambia, y el bloque de pago no tiene un conjunto
// fijo de campos (con marketplace no tiene ninguno). Por eso NADA se lee por
// posicion ni se asume presente: se recorren los pares <th>/<td> tal como
// esten y cada par se emite como un campo con su etiqueta.

import {
  DETAIL_SECTION,
  DETAIL_SELECTORS,
  SECTION_LABEL,
  SHIPPING_LABEL,
  SHIPPING_TITLE_RE,
} from './constants.js';
import { buildTransaction } from '../buscar-orden/transactions.js';

// -----------------------------------------------------------------------------
// API principal
// -----------------------------------------------------------------------------

/**
 * @param {Document} doc
 * @param {{ sections?: object }} [opts]  qué secciones capturar (ver SECTIONS)
 * @returns {{ orderNumber, status, fields, items, notes, transactions }}
 */
export function parseOrderDetail(doc, { sections = {} } = {}) {
  const wanted = (key) => sections[key] !== false;
  const fields = [];
  const push = (section, label, value) => {
    const clean = cleanText(value);
    if (label && clean) fields.push({ section, label: cleanText(label), value: clean });
  };

  const orderNumber = readOrderNumber(doc);
  const status = cleanText(query(doc, DETAIL_SELECTORS.orderStatus)?.textContent);

  if (wanted(DETAIL_SECTION.INFO)) {
    const infoTable = query(doc, DETAIL_SELECTORS.orderInfoTable);
    if (infoTable) tableToPairs(infoTable).forEach(([label, value]) => push(SECTION_LABEL.orden, label, value));
    const accountTable = query(doc, DETAIL_SELECTORS.accountInfoTable);
    if (accountTable) tableToPairs(accountTable).forEach(([label, value]) => push(SECTION_LABEL.cliente, label, value));
  }

  if (wanted(DETAIL_SECTION.ADDRESSES)) {
    parseAddresses(doc).forEach((address) => push(SECTION_LABEL.direcciones, address.type, address.text));
  }

  if (wanted(DETAIL_SECTION.PAYMENT)) {
    parsePayment(doc).forEach(([label, value]) => push(SECTION_LABEL.pago, label, value));
    parseShipping(doc).forEach(([label, value]) => push(SECTION_LABEL.envio, label, value));
  }

  if (wanted(DETAIL_SECTION.TOTALS)) {
    parseTotals(doc).forEach(([label, value]) => push(SECTION_LABEL.totales, label, value));
  }

  if (wanted(DETAIL_SECTION.LOGS)) {
    parseCustomSection(doc).forEach(([label, value]) => push(SECTION_LABEL.inHouse, label, value));
    parseLogSection(doc, DETAIL_SELECTORS.gerpLog).forEach(([label, value]) => push(SECTION_LABEL.erp, label, value));
    parseLogSection(doc, DETAIL_SELECTORS.osmsLog).forEach(([label, value]) => push(SECTION_LABEL.osms, label, value));
  }

  const notes = wanted(DETAIL_SECTION.HISTORY) ? parseNotes(doc) : [];
  const transactions = notes
    .map((note) => buildTransaction(note))
    .filter((tx) => tx && tx.gateway !== 'unknown');

  return {
    orderNumber,
    status,
    fields,
    items: parseItems(doc),
    notes,
    transactions,
  };
}

/** Las secciones que Magento carga por AJAX llegan como HTML suelto. */
export function parseLogFragment(doc, kind) {
  const selector = kind === SECTION_LABEL.osms ? DETAIL_SELECTORS.osmsLog : DETAIL_SELECTORS.gerpLog;
  const pairs = parseLogSection(doc, selector);
  // El fragmento puede venir sin su contenedor: entonces se lee el documento entero.
  return pairs.length ? pairs : tablesToPairs(doc);
}

/** Notas sueltas (pestaña Comments History por AJAX). */
export function parseNotesFragment(doc) {
  return parseNotes(doc);
}

// -----------------------------------------------------------------------------
// Secciones
// -----------------------------------------------------------------------------

function readOrderNumber(doc) {
  const title = query(doc, DETAIL_SELECTORS.orderTitle)?.textContent || '';
  const match = title.match(/#\s*(\S+)/);
  return match ? match[1] : '';
}

/** Facturacion y envio, con el texto completo de la direccion. */
function parseAddresses(doc) {
  const root = query(doc, DETAIL_SELECTORS.addresses);
  if (!root) return [];
  return [...root.querySelectorAll(DETAIL_SELECTORS.addressItem)].map((item) => ({
    type: cleanText(item.querySelector(DETAIL_SELECTORS.addressTitle)?.textContent) || 'Direccion',
    text: cellText(item.querySelector('address') || item),
  })).filter((address) => address.text);
}

/**
 * Bloque de pago. Con marketplace NO tiene tabla de campos, solo el titulo: un
 * parser que espere filas devuelve vacio, asi que el titulo se emite igual.
 *
 * En varias fichas el elemento del titulo ENVUELVE a la tabla de campos, asi
 * que leerlo entero daba "Webpay - ... Payment Type Code: VN Transaction
 * Status: ..." duplicando en `Metodo` lo que ya sale en su propia columna. Las
 * tablas se sacan antes de leer el texto.
 */
function parsePayment(doc) {
  const root = query(doc, DETAIL_SELECTORS.paymentMethod);
  if (!root) return [];
  const pairs = [];
  const titleEl = root.querySelector(DETAIL_SELECTORS.paymentTitle);
  const title = titleEl ? textWithout(titleEl, 'table') : '';
  if (title) pairs.push(['Metodo', title]);
  root.querySelectorAll('table').forEach((table) => pairs.push(...tableToPairs(table)));
  return pairs;
}

/**
 * Metodo de envio. Sin tabla hay que leer el bloque entero, y ahi se colaba el
 * rotulo de la seccion ("Shipping & Handling Information Shipping $15.990"):
 * se prefiere el contenido y, si no esta, se descarta el titulo. La etiqueta se
 * unifica para que la columna sea la misma vengan o no los datos en tabla.
 */
function parseShipping(doc) {
  const root = query(doc, DETAIL_SELECTORS.shippingMethod);
  if (!root) return [];
  const pairs = [];
  root.querySelectorAll('table').forEach((table) => pairs.push(...tableToPairs(table)));
  if (pairs.length) {
    return pairs.map(([label, value]) => [SHIPPING_TITLE_RE.test(label) ? SHIPPING_LABEL : label, value]);
  }
  const content = root.querySelector(DETAIL_SELECTORS.sectionContent);
  const text = content ? cellText(content) : textWithout(root, DETAIL_SELECTORS.sectionTitle);
  return text ? [[SHIPPING_LABEL, text]] : [];
}

/**
 * Totales. No es una tabla th/td: son filas con el rotulo y el importe en
 * celdas. El de `Discount` incluye el nombre de la promocion, que cambia por
 * orden, asi que la etiqueta se emite tal cual y nunca se compara por igualdad.
 */
function parseTotals(doc) {
  const root = query(doc, DETAIL_SELECTORS.totals);
  if (!root) return [];
  const pairs = [];
  root.querySelectorAll('tr').forEach((row) => {
    const cells = [...row.children].filter((cell) => cell.tagName === 'TD' || cell.tagName === 'TH');
    if (cells.length < 2) return;
    const label = cleanText(cells[0].textContent);
    const value = cleanText(cells[cells.length - 1].textContent);
    if (label && value) pairs.push([label, value]);
  });
  return pairs;
}

/** "Full In House Information": cada <p> es "Etiqueta: valor". */
function parseCustomSection(doc) {
  const section = query(doc, DETAIL_SELECTORS.customSection);
  if (!section) return [];
  const pairs = [];
  section.querySelectorAll('p').forEach((p) => {
    const text = cleanText(p.textContent);
    const index = text.indexOf(':');
    if (index > 0) pairs.push([text.slice(0, index), text.slice(index + 1)]);
  });
  return pairs;
}

/** Logs ERP / OSMS: tablas con cabecera propia. */
function parseLogSection(doc, selector) {
  const root = query(doc, selector);
  if (!root) return [];
  return tablesToPairs(root);
}

/**
 * Tabla con <thead> -> pares "columna: valor" de la ULTIMA fila (el envio mas
 * reciente); si no hay cabecera, se leen los pares th/td.
 */
function tablesToPairs(root) {
  const pairs = [];
  root.querySelectorAll('table').forEach((table) => {
    const headers = [...table.querySelectorAll('thead th')].map((th) => cleanText(th.textContent));
    const rows = [...table.querySelectorAll('tbody tr')];
    if (headers.length && rows.length) {
      const cells = [...rows[rows.length - 1].children];
      headers.forEach((header, index) => {
        const value = cleanText(cells[index]?.textContent);
        if (header && value) pairs.push([header, value]);
      });
      if (rows.length > 1) pairs.push(['Registros', String(rows.length)]);
      return;
    }
    pairs.push(...tableToPairs(table));
  });
  return pairs;
}

/**
 * Items Ordered. Estructura: un <tbody> por item y, dentro, varias <tr> (la
 * primera lleva los datos). Las columnas se mapean leyendo los <th> del thead y
 * casando por posicion DENTRO de cada tbody: casi ninguna celda tiene clase
 * propia, asi que por clase no se puede.
 */
function parseItems(doc) {
  const table = query(doc, DETAIL_SELECTORS.itemsTable);
  if (!table) return [];
  const headers = [...table.querySelectorAll('thead th')].map((th) => cleanText(th.textContent));
  const items = [];
  table.querySelectorAll('tbody').forEach((body) => {
    const row = body.querySelector('tr');
    if (!row) return;
    const cells = [...row.children].filter((cell) => cell.tagName === 'TD');
    if (!cells.length) return;
    const item = {};
    cells.forEach((cell, index) => {
      const header = headers[index];
      if (!header) return;
      const value = cellText(cell);
      if (value) item[header] = value;
    });
    if (Object.keys(item).length) items.push(item);
  });
  return items;
}

/** Historial de notas (fecha, estado, si se notifico y el comentario). */
function parseNotes(doc) {
  return [...doc.querySelectorAll(DETAIL_SELECTORS.noteItem)].map((note) => {
    const date = cleanText(note.querySelector(DETAIL_SELECTORS.noteDate)?.textContent);
    const time = cleanText(note.querySelector(DETAIL_SELECTORS.noteTime)?.textContent);
    return {
      when: [date, time].filter(Boolean).join(' '),
      noteStatus: cleanText(note.querySelector(DETAIL_SELECTORS.noteStatus)?.textContent),
      comment: commentToText(note.querySelector(DETAIL_SELECTORS.noteComment)),
    };
  }).filter((note) => note.when || note.comment);
}

// -----------------------------------------------------------------------------
// helpers de DOM
// -----------------------------------------------------------------------------

function query(root, selector) {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

/** Tabla admin (<tr><th/><td/>) -> [[etiqueta, valor]]. */
function tableToPairs(table) {
  const pairs = [];
  table.querySelectorAll('tr').forEach((row) => {
    const th = row.querySelector('th');
    const td = row.querySelector('td');
    if (!th || !td) return;
    const label = cleanText(th.textContent);
    const value = cellText(td);
    if (label && value) pairs.push([label, value]);
  });
  return pairs;
}

/** Texto de un elemento salteando lo que matchee `selector` (tablas, titulos). */
function textWithout(el, selector) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll(selector).forEach((node) => node.remove());
  return cellText(clone);
}

/** Texto de una celda: los <br> se vuelven " / ". */
function cellText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('br').forEach((br) => br.replaceWith(' / '));
  return cleanText(clone.textContent);
}

/** El comentario conserva los saltos: buildTransaction lee "Etiqueta: valor" por linea. */
function commentToText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return String(clone.textContent || '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim();
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export const __test = { tableToPairs, parseItems, parseTotals, parseAddresses, parseNotes, cellText };
