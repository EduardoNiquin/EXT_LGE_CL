// Pipeline puro de transformacion del "Informe ordenes". Sin chrome.* — testeable
// y reutilizable. Entrada: array de registros (objetos keyed por encabezado del
// origen, sea CSV o JSON de la API). Salida: registros recortados a las columnas
// de salida + estadisticas para mostrar en la UI.

import {
  DATE_COLUMN,
  EMAIL_COLUMN,
  KEEP_STATUSES,
  NAME_COLUMN,
  OUTPUT_COLUMNS,
  WAREHOUSE_COLUMN,
  WAREHOUSE_KEEP_TOKEN,
} from '../constants.js';

const KEEP_SET = new Set(KEEP_STATUSES.map(normStatus));

function normStatus(s) {
  return String(s ?? '').trim().toLowerCase();
}

/** Normaliza un valor para comparar identidades (email/nombre). */
function normKey(v) {
  return String(v ?? '').trim().toLowerCase();
}

/** Normaliza un encabezado para lookup tolerante (minusculas, espacios colapsados). */
function normHeader(h) {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Construye un buscador de valores tolerante a mayusculas/espacios en los
 * encabezados. A partir del primer registro mapea encabezado-normalizado -> clave
 * real, y devuelve `get(record, sourceHeader)`.
 */
function makeFieldGetter(sample) {
  const map = new Map();
  for (const key of Object.keys(sample || {})) map.set(normHeader(key), key);
  return (record, sourceHeader) => {
    const realKey = map.get(normHeader(sourceHeader));
    return realKey != null ? record[realKey] : undefined;
  };
}

/** Devuelve la parte de fecha (YYYY-MM-DD) de un "Local Time" tipo "2026-06-23 09:37:02". */
export function dateOnly(localTime) {
  const s = String(localTime ?? '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

/**
 * Aplica todo el pipeline.
 * @param {object[]} records  registros del origen.
 * @param {object} opts
 * @param {string} opts.from  fecha inicial YYYY-MM-DD (inclusive).
 * @param {string} opts.to    fecha final YYYY-MM-DD (inclusive).
 * @returns {{ records: object[], stats: object }}
 */
export function processReport(records, { from, to } = {}) {
  const input = Array.isArray(records) ? records : [];
  const stats = {
    totalRows: input.length,
    afterDate: 0,
    afterStatus: 0,
    afterWarehouse: 0,
    removedDuplicateNames: 0,
    removedBoughtLater: 0,
    removedDuplicateEmails: 0,
    finalRows: 0,
    byStatus: {},
  };

  if (input.length === 0) return { records: [], stats };

  const get = makeFieldGetter(input[0]);

  // 1. Filtro por rango de fechas (columna "Local Time", solo la fecha).
  const hasFrom = Boolean(from);
  const hasTo = Boolean(to);
  const byDate = input.filter((rec) => {
    const d = dateOnly(get(rec, DATE_COLUMN));
    if (!d) return false; // sin fecha valida -> fuera
    if (hasFrom && d < from) return false;
    if (hasTo && d > to) return false;
    return true;
  });
  stats.afterDate = byDate.length;

  // 2. Identidades de clientes con COMPRA EXITOSA. "Exitosa" = cualquier estado
  //    no vacio que NO sea de fallo (no esta en KEEP_STATUSES). Se calcula sobre
  //    TODO el dataset en rango (sin importar estado ni almacen): la idea es que
  //    un cliente que fallo/cancelo pero luego logro comprar NO debe contactarse.
  const successEmails = new Set();
  const successNames = new Set();
  for (const rec of byDate) {
    const status = normStatus(get(rec, 'Status'));
    if (!status || KEEP_SET.has(status)) continue; // vacio o fallo -> no es compra
    const email = normKey(get(rec, EMAIL_COLUMN));
    const name = normKey(get(rec, NAME_COLUMN));
    if (email) successEmails.add(email);
    if (name) successNames.add(name);
  }

  // 3. Filtro por estado (ordenes a recuperar).
  const byStatus = byDate.filter((rec) => KEEP_SET.has(normStatus(get(rec, 'Status'))));
  stats.afterStatus = byStatus.length;

  // 4. Filtro por "Warehouse Code": solo filas que contengan el token (p.ej.
  //    "N2U" o "NB9N2U"). Comparacion tolerante a mayusculas.
  const wantToken = String(WAREHOUSE_KEEP_TOKEN).toUpperCase();
  const byWarehouse = byStatus.filter((rec) =>
    String(get(rec, WAREHOUSE_COLUMN) ?? '').toUpperCase().includes(wantToken)
  );
  stats.afterWarehouse = byWarehouse.length;

  // 5. Dedupe por "Bill-to Name" (se mantiene la 1a ocurrencia). Los nombres
  //    vacios NO se deduplican (se conservan todos).
  const seenNames = new Set();
  const afterNameDedupe = [];
  for (const rec of byWarehouse) {
    const name = normKey(get(rec, NAME_COLUMN));
    if (name) {
      if (seenNames.has(name)) { stats.removedDuplicateNames++; continue; }
      seenNames.add(name);
    }
    afterNameDedupe.push(rec);
  }

  // 6. Excluir clientes que SI compraron (match por email O por Bill-to Name).
  const afterSuccess = afterNameDedupe.filter((rec) => {
    const email = normKey(get(rec, EMAIL_COLUMN));
    const name = normKey(get(rec, NAME_COLUMN));
    const bought = (email && successEmails.has(email)) || (name && successNames.has(name));
    if (bought) { stats.removedBoughtLater++; return false; }
    return true;
  });

  // 7. Dedupe por "Customer Email" (se mantiene la 1a ocurrencia). Los emails
  //    vacios NO se deduplican (se conservan todos).
  const seenEmails = new Set();
  const deduped = [];
  for (const rec of afterSuccess) {
    const email = normKey(get(rec, EMAIL_COLUMN));
    if (email) {
      if (seenEmails.has(email)) { stats.removedDuplicateEmails++; continue; }
      seenEmails.add(email);
    }
    deduped.push(rec);
  }

  // 8. Recorte a columnas de salida (con encabezados finales pedidos).
  const out = deduped.map((rec) => {
    const o = {};
    for (const col of OUTPUT_COLUMNS) {
      const v = get(rec, col.src);
      o[col.out] = v == null ? '' : v;
    }
    return o;
  });

  stats.finalRows = out.length;
  for (const rec of out) {
    const st = rec.Status || '(sin estado)';
    stats.byStatus[st] = (stats.byStatus[st] || 0) + 1;
  }

  return { records: out, stats };
}
