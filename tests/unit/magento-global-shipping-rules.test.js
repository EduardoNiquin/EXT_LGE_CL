import { describe, expect, it } from 'vitest';
import { buildShippingRulesCsv, __test } from '../../src/features/magento/csv.js';
import { DETAIL_URL_RE } from '../../src/features/magento/constants.js';
import { __test as popupTest } from '../../src/features/magento/popup/sections/global-shipping-rules.js';

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

describe('Global Shipping Rules CSV', () => {
  it('repite la rule por cada tarifa regional y mantiene ID y nombre al inicio', () => {
    const csv = buildShippingRulesCsv({
      items: [{
        id: '5799',
        nameFe: 'Despacho RM',
        status: 'ok',
        editHref: 'https://shop.lg.com/edit/id/5799',
        summary: {
          ID: '5799',
          'Shipping Rule Name (FE)': 'Despacho RM',
          Website: 'Chile Website',
        },
        detail: {
          fields: [{ key: 'carrier_id', label: 'Carrier', value: 'LX Pantos Chile' }],
          regionalRows: [
            { Address: 'Santiago', 'Delivery Fee': '4990', 'Service Fee': '0' },
            { Address: 'Providencia', 'Delivery Fee': '5990', 'Service Fee': '0' },
          ],
        },
      }],
    });

    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    const headers = parseCsvLine(lines[0]);
    const first = parseCsvLine(lines[1]);
    const second = parseCsvLine(lines[2]);

    expect(headers.slice(0, 2)).toEqual(['ID', 'Shipping Rule Name (FE)']);
    expect(lines).toHaveLength(3);
    expect(first[0]).toBe('5799');
    expect(first[1]).toBe('Despacho RM');
    expect(second[0]).toBe('5799');
    expect(second[headers.indexOf('Regional - Address')]).toBe('Providencia');
  });

  it('conserva rules sin tarifas y escapa comillas, comas y formulas', () => {
    const csv = buildShippingRulesCsv({
      items: [{
        id: '1',
        nameFe: '=IMPORTXML("x", "y")',
        status: 'error',
        error: 'Fallo, sin tabla',
        editHref: '',
        summary: { ID: '1', 'Shipping Rule Name (FE)': '=IMPORTXML("x", "y")' },
      }],
    });

    expect(csv).toContain('"\'=IMPORTXML(""x"", ""y"")"');
    expect(csv).toContain('"Fallo, sin tabla"');
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('solo protege valores que pueden ejecutarse como formula', () => {
    expect(__test.protectFormula('+SUM(A1:A2)')).toBe("'+SUM(A1:A2)");
    expect(__test.protectFormula('-alert')).toBe("'-alert");
    expect(__test.protectFormula('-1200')).toBe('-1200');
    expect(__test.protectFormula('2026-08-19')).toBe('2026-08-19');
  });

  it('reconoce las URLs reales de detalle que usan entity_id', () => {
    const url = 'https://shop.lg.com/obsadm/global_shippingrule/management/edit/entity_id/5799/key/token/';
    expect(url.match(DETAIL_URL_RE)?.[1]).toBe('5799');
  });

  it('formatea duraciones breves y extensas', () => {
    expect(popupTest.formatDuration(1499)).toBe('1s');
    expect(popupTest.formatDuration(65000)).toBe('1m 05s');
    expect(popupTest.formatDuration(3661000)).toBe('1h 01m 01s');
  });

  it('resume tiempos y navegaciones persistidas', () => {
    expect(popupTest.metricSummary({
      startedAt: 1000,
      finishedAt: 66000,
      metrics: {
        discoveryMs: 5000,
        detailMs: 40000,
        regionalMs: 12000,
        detailCount: 4,
        navigationCount: 5,
      },
    })).toBe('Tiempo total: 1m 05s | Navegaciones: 5 | Listado: 5s | Promedio por rule: 10s | Tarifas: 12s');
  });
});
