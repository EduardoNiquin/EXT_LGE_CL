// Pipeline puro de transformacion del "Informe ordenes". Sin chrome.* — testeable
// y reutilizable. Entrada: array de registros (objetos keyed por encabezado del
// origen, sea CSV o JSON de la API). Salida: registros recortados a las columnas
// de salida + estadisticas para mostrar en la UI.

import {
  CANCELLED_STATUSES,
  DATE_COLUMN,
  DEDUPE_KEYS,
  KEEP_STATUSES,
  OUTPUT_COLUMNS,
  WAREHOUSE_COLUMN,
  WAREHOUSE_KEEP_TOKEN,
} from '../constants.js';

const CANCELLED_SET = new Set(CANCELLED_STATUSES.map(normStatus));
const KEEP_SET = new Set(KEEP_STATUSES.map(normStatus));

function normStatus(s) {
  return String(s ?? '').trim().toLowerCase();
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
    removedDuplicates: 0,
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

  // 2. Filtro por estado (ordenes a recuperar).
  const byStatus = byDate.filter((rec) => KEEP_SET.has(normStatus(get(rec, 'Status'))));
  stats.afterStatus = byStatus.length;

  // 3. Filtro por "Warehouse Code": solo filas que contengan el token (p.ej.
  //    "N2U" o "NB9N2U"). Comparacion tolerante a mayusculas.
  const wantToken = String(WAREHOUSE_KEEP_TOKEN).toUpperCase();
  const byWarehouse = byStatus.filter((rec) =>
    String(get(rec, WAREHOUSE_COLUMN) ?? '').toUpperCase().includes(wantToken)
  );
  stats.afterWarehouse = byWarehouse.length;

  // 4. Dedupe de canceladas por (Customer Email + Bill-to Name). Solo entre
  //    canceladas; las demas se conservan intactas. Se mantiene la 1a ocurrencia.
  const seen = new Set();
  const deduped = [];
  for (const rec of byWarehouse) {
    const status = normStatus(get(rec, 'Status'));
    if (CANCELLED_SET.has(status)) {
      const key = DEDUPE_KEYS
        .map((h) => String(get(rec, h) ?? '').trim().toLowerCase())
        .join('||');
      if (seen.has(key)) { stats.removedDuplicates++; continue; }
      seen.add(key);
    }
    deduped.push(rec);
  }

  // 5. Recorte a columnas de salida (con encabezados finales pedidos).
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
