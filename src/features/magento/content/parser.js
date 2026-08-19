import { DETAIL_SECTION_SELECTORS, DETAIL_URL_RE, SELECTORS } from '../constants.js';
import { findListingTable } from './detector.js';

export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function getTableHeaders(table) {
  return Array.from(table?.querySelectorAll('thead th') || []).map((th) =>
    normalizeText(th.querySelector('.data-grid-cell-content')?.textContent || th.textContent),
  );
}

export function parseListingRows() {
  const table = findListingTable();
  if (!table) return [];
  const headers = getTableHeaders(table);

  return Array.from(table.querySelectorAll(SELECTORS.listingRow)).map((row) => {
    const cells = Array.from(row.querySelectorAll(':scope > td'));
    const summary = {};
    headers.forEach((header, index) => {
      if (header && header !== 'Action') summary[header] = readCell(cells[index]);
    });

    const anchor = row.querySelector(SELECTORS.listingEditLink);
    const editHref = anchor?.href || anchor?.getAttribute('href') || '';
    const idMatch = editHref.match(DETAIL_URL_RE) || editHref.match(/\/id\/(\d+)/i);
    const id = normalizeText(summary.ID || idMatch?.[1]);

    return {
      id,
      nameFe: normalizeText(summary['Shipping Rule Name (FE)']),
      editHref,
      summary,
    };
  }).filter((rule) => rule.id && rule.editHref);
}

export function parseDetailFields() {
  const fields = new Map();

  for (const selector of DETAIL_SECTION_SELECTORS) {
    const root = document.querySelector(selector);
    if (!root) continue;
    const section = sectionLabel(root);

    for (const control of root.querySelectorAll('input[name], select[name], textarea[name]')) {
      if (control.closest(SELECTORS.regionalRoot)) continue;
      const type = String(control.type || control.tagName).toLowerCase();
      if (['hidden', 'button', 'submit', 'reset', 'file'].includes(type)) continue;
      if ((type === 'radio') && !control.checked) continue;

      const key = normalizeText(control.name).replace(/\[\]$/, '');
      if (!key) continue;
      const value = readControl(control);
      const label = fieldLabel(control) || key;
      const previous = fields.get(key);

      if (!previous) {
        fields.set(key, { key, label, section, value });
      } else if (value && !splitValues(previous.value).includes(value)) {
        previous.value = [previous.value, value].filter(Boolean).join(' | ');
      }
    }
  }

  return Array.from(fields.values());
}

export function findRegionalTable() {
  const root = document.querySelector(SELECTORS.regionalRoot);
  if (!root) return null;
  return Array.from(root.querySelectorAll('table[data-role="grid"], table.data-grid')).find((table) => {
    const headers = getTableHeaders(table).join(' | ');
    return /Address/i.test(headers) && /Delivery Fee/i.test(headers);
  }) || null;
}

export function parseRegionalRows() {
  const table = findRegionalTable();
  if (!table) return [];
  const headers = getTableHeaders(table);

  return Array.from(table.querySelectorAll('tbody tr.data-row')).map((row) => {
    const cells = Array.from(row.querySelectorAll(':scope > td'));
    const data = {};
    headers.forEach((header, index) => {
      if (header && header !== 'Action') data[header] = readCell(cells[index]);
    });
    return data;
  }).filter((row) => Object.values(row).some(Boolean));
}

function readCell(cell) {
  if (!cell) return '';
  const controls = Array.from(cell.querySelectorAll('input, select, textarea'))
    .filter((control) => !['checkbox', 'radio', 'hidden'].includes(String(control.type).toLowerCase()))
    .map(readControl)
    .filter(Boolean);
  if (controls.length) return Array.from(new Set(controls)).join(' | ');
  return normalizeText(cell.querySelector('.data-grid-cell-content')?.textContent || cell.textContent);
}

function readControl(control) {
  if (control.tagName === 'SELECT') {
    return Array.from(control.selectedOptions || [])
      .map((option) => normalizeText(option.textContent || option.value))
      .filter(Boolean)
      .join(' | ');
  }
  if (String(control.type).toLowerCase() === 'checkbox') return control.checked ? 'Yes' : 'No';
  return normalizeText(control.value);
}

function fieldLabel(control) {
  const field = control.closest('.admin__field');
  return normalizeText(field?.querySelector('.admin__field-label span')?.textContent);
}

function sectionLabel(root) {
  return normalizeText(root.querySelector(':scope > .fieldset-wrapper-title .admin__collapsible-title > span')?.textContent)
    || normalizeText(root.dataset.index);
}

function splitValues(value) {
  return String(value || '').split(' | ');
}
