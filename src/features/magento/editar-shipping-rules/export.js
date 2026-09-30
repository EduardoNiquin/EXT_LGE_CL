// Filas del registro de cambios (una por rule) y su CSV. Puro: el .xlsx se arma
// en el popup con estas mismas filas.

import { ACTION_LABEL, ITEM_STATUS_LABEL } from './constants.js';
import { activeLabel } from './catalog.js';

// BOM UTF-8: sin el, Excel abre el CSV como ANSI y rompe las tildes.
const BOM = String.fromCharCode(0xfeff);

export const CHANGE_HEADERS = [
  'Fecha',
  'Corrida',
  'Accion',
  'ID',
  'Shipping Rule Name (FE)',
  'Shipping Rule Name (BE)',
  'Carrier',
  'Estado anterior',
  'Estado nuevo',
  'Resultado',
  'Verificado en listado',
  'Detalle',
  'URL de edicion',
];

function stamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function actionText(run) {
  if (run?.revertOf) return 'Revertir';
  return ACTION_LABEL[run?.action] || '';
}

function verifiedText(value) {
  if (value === true) return 'Si';
  if (value === false) return 'No';
  return '';
}

/** Una fila por rule, en el orden de CHANGE_HEADERS. */
export function changeRows(run) {
  return (run?.items || []).map((item) => [
    stamp(item.changedAt || run.finishedAt || run.startedAt),
    run.id || '',
    actionText(run),
    item.id,
    item.nameFe,
    item.nameBe,
    item.carrier,
    activeLabel(item.before),
    activeLabel(item.after),
    ITEM_STATUS_LABEL[item.status] || item.status || '',
    verifiedText(item.verified),
    item.error || item.note || '',
    item.editHref || '',
  ]);
}

export function buildChangesCsv(runs) {
  const list = Array.isArray(runs) ? runs : [runs];
  const rows = list.flatMap((run) => changeRows(run));
  return `${BOM}${[CHANGE_HEADERS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

function csvCell(value) {
  const safe = protectFormula(String(value ?? ''));
  return `"${safe.replace(/"/g, '""')}"`;
}

// Excel ejecutaria lo que empieza con =, +, @ o "-texto". Los nombres de rule
// empiezan con "[" y los estados son texto, pero la descripcion es libre.
function protectFormula(value) {
  return /^[=+@\t\r]/.test(value) || /^-[^\d]/.test(value) ? `'${value}` : value;
}

export function exportFilename(run, ext) {
  const d = new Date(run?.startedAt || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const what = run?.revertOf ? 'revertir' : (run?.action === 'activate' ? 'activar' : 'desactivar');
  return `magento-shipping-rules-${what}-${when}.${ext}`;
}

export const __test = { csvCell, protectFormula, stamp };
