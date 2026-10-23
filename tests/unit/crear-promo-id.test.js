import { describe, expect, it } from 'vitest';
import { csvToMatrix, parseSkuMatrix, parseSkuText } from '../../src/features/crear-promo-id/parse-input.js';
import { defaultMainModels, itemsFromResolution, pickMainModels, resolveSkus, validateConfig } from '../../src/features/crear-promo-id/resolve.js';
import { CATEGORY_MODE } from '../../src/features/crear-promo-id/constants.js';
import { aceptaArchivo } from '../../src/shared/ui/file-intake.js';

// Filas como las devuelve retrieveCategoryModelList: una por ruta de categoria.
const row = (modelId, salesModel, modelName, category, subCategory = '') => ({
  bizType: 'B2C', superCategory: 'TV/Audio/Video', category, subCategory,
  superCategoryId: 'CT1', categoryId: `C-${category}`, subCategoryId: subCategory ? `S-${subCategory}` : '',
  salesModel, modelName, modelId, productId: `${salesModel}.ESCL.CL.C`, msrp: '1', stgMsrp: '1',
});

const CATALOG = [
  row('MD1', 'STAGE301.ACHLLBK', 'STAGE301', 'Speakers', 'Portable Speakers'),
  row('MD1', 'STAGE301.ACHLLBK', 'STAGE301', 'Speakers', 'XBOOM'),
  row('MD1', 'STAGE301.ACHLLBK', 'STAGE301', 'Speakers', 'XBOOM'), // repetida
  row('MD2', 'RNC5.DCHLLLK', 'RNC5', 'Hi-Fi System'),
  row('MD3', 'OLED65C5PSA.AWH', 'OLED65C5', 'TVs'),
  row('MD4', 'OLED65C5PSA.AWHX', 'OLED65C5', 'TVs'),
];

describe('parseSkuText', () => {
  it('uno por linea, normaliza y quita repetidos, comentarios y encabezado', () => {
    const { skus, duplicates } = parseSkuText('SKU\n stage301.achllbk \n# nota\nRNC5.DCHLLLK\nSTAGE301.ACHLLBK\n\n');
    expect(skus).toEqual(['STAGE301.ACHLLBK', 'RNC5.DCHLLLK']);
    expect(duplicates).toEqual(['STAGE301.ACHLLBK']);
  });
  it('acepta coma, punto y coma y tabulador', () => {
    expect(parseSkuText('A1,A2;A3\tA4').skus).toEqual(['A1', 'A2', 'A3', 'A4']);
  });
});

describe('parseSkuMatrix / csvToMatrix', () => {
  it('usa la columna con encabezado reconocible', () => {
    const m = [['Nombre', 'Sales Model'], ['tele', 'OLED65C5PSA.AWH'], ['parlante', 'RNC5.DCHLLLK']];
    const r = parseSkuMatrix(m);
    expect(r.skus).toEqual(['OLED65C5PSA.AWH', 'RNC5.DCHLLLK']);
    expect(r.column).toBe('Sales Model');
  });
  it('sin encabezado usa la primera columna con datos', () => {
    expect(parseSkuMatrix([['', 'X1'], ['', 'X2']]).skus).toEqual(['X1', 'X2']);
  });
  it('CSV con punto y coma y comillas', () => {
    expect(csvToMatrix('sku;nota\n"A;1";x\nB2;y')).toEqual([['sku', 'nota'], ['A;1', 'x'], ['B2', 'y']]);
  });
});

describe('resolveSkus', () => {
  it('trae todas las categorias de cada modelo, sin filas repetidas', () => {
    const r = resolveSkus(['STAGE301.ACHLLBK', 'RNC5'], CATALOG);
    expect(r.models.map((m) => m.modelId)).toEqual(['MD1', 'MD2']);
    expect(r.models[0].rows).toHaveLength(2);
    expect(r.models[1].matchedBy).toBe('modelName');
    expect(r.rowCount).toBe(3);
  });
  it('modo "solo la primera" deja una fila por modelo', () => {
    const r = resolveSkus(['STAGE301.ACHLLBK'], CATALOG, { categoryMode: CATEGORY_MODE.FIRST });
    expect(r.models[0].rows).toHaveLength(1);
  });
  it('encuentra por Product ID', () => {
    expect(resolveSkus(['RNC5.DCHLLLK.ESCL.CL.C'], CATALOG).models[0].matchedBy).toBe('productId');
  });
  it('separa no encontrados, ambiguos y repetidos', () => {
    const r = resolveSkus(['NOEXISTE', 'OLED65C5', 'STAGE301', 'STAGE301.ACHLLBK'], CATALOG);
    expect(r.notFound).toEqual(['NOEXISTE']);
    expect(r.ambiguous[0]).toEqual({ sku: 'OLED65C5', options: ['OLED65C5PSA.AWH', 'OLED65C5PSA.AWHX'] });
    expect(r.repeated).toEqual(['STAGE301.ACHLLBK']);
    expect(r.models).toHaveLength(1);
  });
});

describe('Main Model / validateConfig / items', () => {
  const models = resolveSkus(['STAGE301.ACHLLBK', 'RNC5.DCHLLLK', 'OLED65C5PSA.AWH'], CATALOG).models;
  const config = { title: 'Promo', startDate: '2026-10-20', endDate: '2026-11-20' };

  it('3 Main Model si hay 3 o mas, 1 si no', () => {
    expect(defaultMainModels(models)).toEqual(['MD1', 'MD2', 'MD3']);
    expect(defaultMainModels(models.slice(0, 2))).toEqual(['MD1']);
  });
  it('Main Model elegidos por SKU, con caida a los por defecto si no dan 1 o 3', () => {
    expect(pickMainModels(models, ['rnc5.dchlllk']).ids).toEqual(['MD2']);
    const bad = pickMainModels(models, ['RNC5.DCHLLLK', 'NOEXISTE', 'OLED65C5PSA.AWH']);
    expect(bad.ids).toEqual(['MD1', 'MD2', 'MD3']);
    expect(bad.warnings.join(' ')).toMatch(/NOEXISTE/);
  });
  it('valida antes de tocar GP1 sin exigir que los SKUs existan', () => {
    expect(validateConfig(config, { skus: ['X'] })).toEqual([]);
    expect(validateConfig(config, { skus: ['X'], mainSkus: ['A', 'B'] })[0]).toMatch(/1 o 3/);
    const errs = validateConfig({ title: 'x'.repeat(61), startDate: '2026-12-01', endDate: '2026-11-01' }, { skus: [] });
    expect(errs.join(' ')).toMatch(/60/);
    expect(errs.join(' ')).toMatch(/posterior/);
    expect(errs.join(' ')).toMatch(/al menos un SKU/);
  });
  it('estado por SKU en el orden pegado', () => {
    const skus = ['NOEXISTE', 'STAGE301.ACHLLBK', 'OLED65C5'];
    const items = itemsFromResolution(skus, resolveSkus(skus, CATALOG));
    expect(items.map((it) => it.status)).toEqual(['not-found', 'found', 'ambiguous']);
    expect(items[1].rows).toBe(2);
  });
});

describe('aceptaArchivo (pegado desde Excel)', () => {
  const png = { name: 'image.png', type: 'image/png' };
  it('la imagen que Excel pone al copiar celdas no cuenta como archivo', () => {
    expect(aceptaArchivo('.csv,.txt,.xlsx,.xls', png)).toBe(false);
    expect(aceptaArchivo('.csv,.txt,.xlsx,.xls', { name: 'skus.xlsx', type: '' })).toBe(true);
  });
  it('sin accept todo vale; acepta mime y comodin', () => {
    expect(aceptaArchivo('', png)).toBe(true);
    expect(aceptaArchivo('image/*', png)).toBe(true);
    expect(aceptaArchivo('text/csv', { name: 'a', type: 'text/csv' })).toBe(true);
  });
});
