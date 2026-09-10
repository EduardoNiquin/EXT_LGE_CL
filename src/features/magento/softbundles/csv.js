// Resultado del run como matriz: una fila por oferta (producto hijo), con las
// columnas del bundle repetidas. Es la misma matriz que pinta la tabla del
// popup, asi que lo que se ve es exactamente lo que se exporta.

import { BUNDLE_STATUS_LABEL, CHILD_STATUS } from './constants.js';

const HEADERS = [
  'SKU principal',
  'Estado del bundle',
  'Package ID',
  'SKU hijo',
  'SKU hijo en Magento',
  'Descuento (%)',
  '% al principal',
  'Estado de la oferta',
  'Detalle',
];

const CHILD_STATUS_LABEL = {
  [CHILD_STATUS.PENDING]: 'Sin crear',
  [CHILD_STATUS.OK]:      'Creada',
  [CHILD_STATUS.ERROR]:   'Error',
};

/** @returns {{ headers: string[], rows: string[][] }} */
export function buildMatrix(run) {
  const config = run?.config || {};
  const rows = [];

  (run?.items || []).forEach((item) => {
    const bundleCells = [
      item.parentSku,
      BUNDLE_STATUS_LABEL[item.status] || item.status,
      item.packageId || '',
    ];
    const children = item.children?.length ? item.children : [null];
    children.forEach((child) => {
      if (!child) {
        rows.push([...bundleCells, '', '', '', '', '', item.error || '']);
        return;
      }
      rows.push([
        ...bundleCells,
        child.sku,
        child.chosenSku || '',
        String(child.discountRate ?? config.discountRate ?? ''),
        config.split ? String(child.mainDiscountRate ?? config.mainDiscountRate ?? '') : '',
        CHILD_STATUS_LABEL[child.status] || child.status,
        child.error || item.error || '',
      ]);
    });
  });

  return { headers: HEADERS, rows };
}

/** Excel ejecuta como formula lo que empieza con =, +, @ o un - seguido de texto. */
function protectFormula(value) {
  const text = String(value ?? '');
  return /^[=+@]|^-(?!\d)/.test(text) ? `'${text}` : text;
}

function escapeCell(value) {
  const text = protectFormula(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function matrixToCsv({ headers, rows }) {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
