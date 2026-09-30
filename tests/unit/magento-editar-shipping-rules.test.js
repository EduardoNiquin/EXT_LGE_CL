import { describe, expect, it } from 'vitest';
import {
  buildRulesGridUrl,
  filterRules,
  missingIds,
  parseRulesGrid,
  parseTerms,
  slimRule,
  toActive,
  uniqueCarriers,
} from '../../src/features/magento/editar-shipping-rules/catalog.js';
import { buildChangesCsv, changeRows, CHANGE_HEADERS, exportFilename } from '../../src/features/magento/editar-shipping-rules/export.js';
import { historyEntryOf, makeRun } from '../../src/features/magento/editar-shipping-rules/state.js';
import { ACTION, ITEM_STATUS } from '../../src/features/magento/editar-shipping-rules/constants.js';
import { findCurrentIndex } from '../../src/features/magento/editar-shipping-rules/content/flows/run.js';

// Forma real de una fila del grid (medida en el admin, recortada).
const RAW = {
  entity_id: '1424',
  is_active: '0',
  name_fe: 'Entrega agendada',
  name_be: '[Rule 66] CL.SH7Q.DCHLLLK',
  description: '',
  shipping_code: 'CL_66',
  website_id: '111',
  carrier_id: 'LX Pantos Chile',
  start_date: '2024-01-09 00:00:00',
  end_date: '2040-01-31 23:59:59',
  priority: '0',
  delivery_fee: '5033.6000',
  actions: { edit: { href: 'https://shop.lg.com/obsadm/global_shippingrule/management/edit/entity_id/1424/key/abc/', label: 'Edit' } },
};

const RULES = [
  slimRule(RAW),
  slimRule({ ...RAW, entity_id: '4977', is_active: '1', name_fe: 'Envío Normal' }),
  slimRule({ ...RAW, entity_id: '1466', is_active: '1', name_be: '[Rule 70] CL.OTRA', carrier_id: 'Chilexpress', shipping_code: 'CL_70' }),
];

describe('catalogo de rules', () => {
  it('recorta la fila del grid a lo que se usa', () => {
    expect(RULES[0]).toMatchObject({
      id: '1424',
      isActive: false,
      nameBe: '[Rule 66] CL.SH7Q.DCHLLLK',
      carrier: 'LX Pantos Chile',
      editHref: RAW.actions.edit.href,
    });
    expect(toActive('1')).toBe(true);
    expect(toActive(0)).toBe(false);
    expect(toActive(true)).toBe(true);
  });

  it('arma la consulta al grid por ID ascendente', () => {
    const url = new URL(buildRulesGridUrl('https://x/obsadm/mui/index/render/key/k/?foo=1', 2, 500));
    expect(url.pathname).toBe('/obsadm/mui/index/render/key/k/');
    expect(url.searchParams.get('namespace')).toBe('shipping_rule_management_listing');
    expect(url.searchParams.get('paging[current]')).toBe('2');
    expect(url.searchParams.get('paging[pageSize]')).toBe('500');
    expect(url.searchParams.get('sorting[field]')).toBe('entity_id');
  });

  it('lee los items embebidos en el HTML de mui/index/render', () => {
    const payload = { '*': { 'Magento_Ui/js/core/app': { components: { ds: { data: { items: [RAW], totalRecords: 267 } } } } } };
    const html = `<div></div><script type="text/x-magento-init">${JSON.stringify(payload)}</script>`;
    expect(parseRulesGrid(html)).toEqual({ items: [RAW], totalRecords: 267 });
    expect(parseRulesGrid('<div>nada</div>')).toBeNull();
  });
});

describe('filtros', () => {
  it('separa terminos por coma o linea sin partir los nombres', () => {
    expect(parseTerms('Rule 66, 1424\n  4977 ;')).toEqual(['Rule 66', '1424', '4977']);
    expect(parseTerms('')).toEqual([]);
  });

  it('un numero calza con el ID exacto o como numero completo en el nombre', () => {
    expect(filterRules(RULES, { text: '66' }).map((rule) => rule.id)).toEqual(['1424', '4977']); // "[Rule 66]", no la 1466
    expect(filterRules(RULES, { text: '1466' }).map((rule) => rule.id)).toEqual(['1466']);
  });

  it('busca sin tildes ni mayusculas en nombres, codigo y carrier', () => {
    expect(filterRules(RULES, { text: 'envio normal' }).map((rule) => rule.id)).toEqual(['4977']);
    expect(filterRules(RULES, { text: 'cl_70' }).map((rule) => rule.id)).toEqual(['1466']);
    expect(filterRules(RULES, { text: 'chilexpress' }).map((rule) => rule.id)).toEqual(['1466']);
  });

  it('filtra por estado y carrier, y combina varios terminos', () => {
    expect(filterRules(RULES, { status: 'inactive' }).map((rule) => rule.id)).toEqual(['1424']);
    expect(filterRules(RULES, { status: 'active', carrier: 'LX Pantos Chile' }).map((rule) => rule.id)).toEqual(['4977']);
    expect(filterRules(RULES, { text: '1424, 1466' }).map((rule) => rule.id)).toEqual(['1424', '1466']);
  });

  it('avisa los IDs que no existen y lista los carriers', () => {
    expect(missingIds(RULES, '1424, 9999, Rule 66')).toEqual(['9999']);
    expect(uniqueCarriers(RULES)).toEqual(['Chilexpress', 'LX Pantos Chile']);
  });
});

describe('corrida', () => {
  it('fija el estado pedido segun la accion y arranca todo en cola', () => {
    const run = makeRun({ action: ACTION.DEACTIVATE, rules: RULES, listingUrl: 'u' });
    expect(run.active).toBe(true);
    expect(run.items.every((item) => item.target === false && item.status === ITEM_STATUS.PENDING)).toBe(true);
    expect(run.items[0].catalogActive).toBe(false);
  });

  it('una reversion respeta el target de cada rule', () => {
    const run = makeRun({
      action: 'revert',
      rules: [{ ...RULES[0], target: true }, { ...RULES[1], target: false }],
      listingUrl: 'u',
      revertOf: 'abc',
    });
    expect(run.items.map((item) => item.target)).toEqual([true, false]);
    expect(run.revertOf).toBe('abc');
  });

  it('casa el formulario abierto por ID o por el entity_id del enlace', () => {
    const run = makeRun({ action: ACTION.ACTIVATE, rules: RULES, listingUrl: 'u' });
    run.items[0].status = ITEM_STATUS.APPLYING;
    expect(findCurrentIndex(run, '1424')).toBe(0);
    expect(findCurrentIndex(run, '4977')).toBe(-1); // en cola, no en curso
    run.items[0].status = ITEM_STATUS.OK;
    expect(findCurrentIndex(run, '1424')).toBe(-1);
  });
});

describe('export', () => {
  const run = makeRun({ action: ACTION.DEACTIVATE, rules: RULES.slice(0, 2), listingUrl: 'u' });
  run.startedAt = new Date(2026, 8, 30, 12, 40).getTime();
  Object.assign(run.items[0], { status: ITEM_STATUS.UNCHANGED, before: false, after: false, verified: true, note: 'Ya estaba inactiva' });
  Object.assign(run.items[1], { status: ITEM_STATUS.OK, before: true, after: false, verified: true, changedAt: run.startedAt });

  it('una fila por rule con antes y despues', () => {
    const rows = changeRows(run);
    expect(rows).toHaveLength(2);
    const at = (name) => CHANGE_HEADERS.indexOf(name);
    expect(rows[1][at('ID')]).toBe('4977');
    expect(rows[1][at('Estado anterior')]).toBe('Activa');
    expect(rows[1][at('Estado nuevo')]).toBe('Inactiva');
    expect(rows[1][at('Resultado')]).toBe('Cambiada');
    expect(rows[1][at('Verificado en listado')]).toBe('Si');
    expect(rows[0][at('Resultado')]).toBe('Sin cambio');
    expect(rows[0][at('Accion')]).toBe('Desactivar');
  });

  it('CSV con BOM, comillas y protegido contra formulas', () => {
    const risky = { ...run, items: [{ ...run.items[0], nameFe: '=HYPERLINK("x")' }] };
    const csv = buildChangesCsv(risky);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(buildChangesCsv([run, run]).split('\r\n')).toHaveLength(5);
  });

  it('nombre de archivo y entrada de historial', () => {
    expect(exportFilename(run, 'xlsx')).toBe('magento-shipping-rules-desactivar-2026-09-30_12-40.xlsx');
    const entry = historyEntryOf(run);
    expect(entry.log).toBeUndefined();
    expect(entry.items[1]).toMatchObject({ id: '4977', before: true, after: false, status: ITEM_STATUS.OK });
  });
});
