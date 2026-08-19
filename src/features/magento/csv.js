const PRIMARY_HEADERS = ['ID', 'Shipping Rule Name (FE)'];

export function buildShippingRulesCsv(run) {
  const items = Array.isArray(run?.items) ? run.items : [];
  const listingHeaders = unique(items.flatMap((item) => Object.keys(item.summary || {})))
    .filter((header) => !PRIMARY_HEADERS.includes(header) && header !== 'Action');
  const detailKeys = unique(items.flatMap((item) => (item.detail?.fields || []).map((field) => field.key)));
  const detailLabels = new Map();
  items.forEach((item) => (item.detail?.fields || []).forEach((field) => {
    if (!detailLabels.has(field.key)) detailLabels.set(field.key, field.label || field.key);
  }));
  const regionalHeaders = unique(items.flatMap((item) =>
    (item.detail?.regionalRows || []).flatMap((row) => Object.keys(row)),
  ));

  const headers = [
    ...PRIMARY_HEADERS,
    ...listingHeaders,
    ...detailKeys.map((key) => `Detail - ${detailLabels.get(key) || key}`),
    ...regionalHeaders.map((header) => `Regional - ${header}`),
    'Capture Status',
    'Capture Error',
    'Edit URL',
  ];

  const rows = [];
  items.forEach((item) => {
    const detailValues = new Map((item.detail?.fields || []).map((field) => [field.key, field.value]));
    const regionalRows = item.detail?.regionalRows?.length ? item.detail.regionalRows : [{}];

    regionalRows.forEach((regional) => {
      rows.push([
        item.id,
        item.nameFe,
        ...listingHeaders.map((header) => item.summary?.[header] || ''),
        ...detailKeys.map((key) => detailValues.get(key) || ''),
        ...regionalHeaders.map((header) => regional[header] || ''),
        item.status || '',
        item.error || '',
        item.editHref || '',
      ]);
    });
  });

  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

function csvCell(value) {
  const safe = protectFormula(String(value ?? ''));
  return `"${safe.replace(/"/g, '""')}"`;
}

function protectFormula(value) {
  return /^[=+@\t\r]/.test(value) || /^-[^\d]/.test(value) ? `'${value}` : value;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export const __test = { csvCell, protectFormula };
