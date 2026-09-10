import { describe, expect, it } from 'vitest';
import {
  countOffers,
  normalizeSku,
  parseBundleLines,
  parsePercent,
  sameSku,
} from '../../src/features/magento/softbundles/parse-input.js';
import { buildMatrix, matrixToCsv } from '../../src/features/magento/softbundles/csv.js';
import { BUNDLE_STATUS, CHILD_STATUS } from '../../src/features/magento/softbundles/constants.js';
import { findCreatingIndex } from '../../src/features/magento/softbundles/content/flows/run.js';
import { toMagentoDate } from '../../src/features/magento/softbundles/popup/section.js';

describe('normalizacion de SKU', () => {
  it('ignora el prefijo del catalogo y las mayusculas', () => {
    expect(normalizeSku(' cl.86MRGB95BSA.awh ')).toBe('86MRGB95BSA.AWH');
    expect(sameSku('86MRGB95BSA.AWH', 'CL.86MRGB95BSA.AWH')).toBe(true);
    expect(sameSku('RNC7', 'CL.RNC7.DCHLLLK')).toBe(false);
  });

  it('no da por iguales dos vacios', () => {
    expect(sameSku('', '')).toBe(false);
    expect(sameSku(null, undefined)).toBe(false);
  });
});

describe('parsePercent', () => {
  it('acepta enteros, decimales y el signo de porcentaje', () => {
    expect(parsePercent('5')).toBe('5');
    expect(parsePercent(' 7,5 %')).toBe('7.5');
  });

  it('rechaza lo que Magento no acepta', () => {
    expect(parsePercent('abc')).toBe(null);
    expect(parsePercent('120')).toBe(null);
    expect(parsePercent('0', { min: 1, max: 99 })).toBe(null);
    expect(parsePercent('')).toBe(null);
  });
});

describe('parseBundleLines', () => {
  it('lee una linea por bundle: el primero es el padre', () => {
    const { bundles } = parseBundleLines('PADRE,HIJO1,HIJO2\nPADRE2,HIJO3');
    expect(bundles).toHaveLength(2);
    expect(bundles[0].parentSku).toBe('PADRE');
    expect(bundles[0].children.map((child) => child.sku)).toEqual(['HIJO1', 'HIJO2']);
    expect(countOffers(bundles)).toBe(3);
  });

  it('acepta punto y coma, tabulador y comillas del CSV', () => {
    const { bundles } = parseBundleLines('"PADRE";"HIJO1"\nPADRE2\tHIJO2');
    expect(bundles.map((bundle) => bundle.parentSku)).toEqual(['PADRE', 'PADRE2']);
    expect(bundles[0].children[0].sku).toBe('HIJO1');
  });

  it('lee los porcentajes que trae el hijo', () => {
    const { bundles } = parseBundleLines('PADRE,HIJO1:10,HIJO2:8:40,HIJO3');
    expect(bundles[0].children).toEqual([
      { sku: 'HIJO1', discountRate: '10', mainDiscountRate: null },
      { sku: 'HIJO2', discountRate: '8', mainDiscountRate: '40' },
      { sku: 'HIJO3', discountRate: null, mainDiscountRate: null },
    ]);
  });

  it('avisa y usa el global cuando el porcentaje del hijo no sirve', () => {
    const { bundles, warnings } = parseBundleLines('PADRE,HIJO1:abc,HIJO2:5:0');
    expect(bundles[0].children[0].discountRate).toBe(null);
    expect(bundles[0].children[1].mainDiscountRate).toBe(null);
    expect(warnings).toHaveLength(2);
  });

  it('descarta encabezados, comentarios y lineas vacias', () => {
    const { bundles } = parseBundleLines('SKU Padre,SKU Hijo\n\n# comentario\nPADRE,HIJO');
    expect(bundles).toHaveLength(1);
    expect(bundles[0].parentSku).toBe('PADRE');
  });

  it('omite el bundle sin hijos', () => {
    const { bundles, warnings } = parseBundleLines('PADRE\nPADRE2,HIJO');
    expect(bundles).toHaveLength(1);
    expect(warnings[0]).toMatch(/no trae ningun producto hijo/);
  });

  it('deja un solo bundle por SKU padre y un solo hijo repetido', () => {
    const { bundles, warnings } = parseBundleLines('PADRE,HIJO,CL.HIJO,PADRE\nCL.PADRE,OTRO');
    expect(bundles).toHaveLength(1);
    expect(bundles[0].children.map((child) => child.sku)).toEqual(['HIJO']);
    // hijo repetido con prefijo, hijo igual al padre y linea duplicada
    expect(warnings).toHaveLength(3);
  });
});

describe('toMagentoDate', () => {
  it('convierte el ISO del input date al formato del datepicker', () => {
    expect(toMagentoDate('2026-09-09')).toBe('9/09/2026');
    expect(toMagentoDate('2026-12-31')).toBe('12/31/2026');
  });

  it('devuelve vacio cuando no hay fecha', () => {
    expect(toMagentoDate('')).toBe('');
    expect(toMagentoDate(null)).toBe('');
  });
});

describe('findCreatingIndex', () => {
  const run = {
    items: [
      { status: BUNDLE_STATUS.OK, packageId: '1' },
      { status: BUNDLE_STATUS.CREATING, packageId: '' },
      { status: BUNDLE_STATUS.PENDING, packageId: '' },
    ],
  };

  it('encuentra el unico bundle en curso', () => {
    expect(findCreatingIndex(run)).toBe(1);
  });

  it('confirma por package_id cuando ya lo tiene', () => {
    const withId = { items: [{ status: BUNDLE_STATUS.CREATING, packageId: '125433' }] };
    expect(findCreatingIndex(withId, '125433')).toBe(0);
    // El id no casa pero sigue siendo el unico en curso: no se pierde el bundle.
    expect(findCreatingIndex(withId, '999')).toBe(0);
  });

  it('devuelve -1 cuando no hay ninguno en curso', () => {
    expect(findCreatingIndex({ items: [{ status: BUNDLE_STATUS.OK }] })).toBe(-1);
    expect(findCreatingIndex(null)).toBe(-1);
  });
});

describe('CSV del resultado', () => {
  const run = {
    config: { discountRate: '5', mainDiscountRate: '50', split: true },
    items: [
      {
        parentSku: 'PADRE',
        status: BUNDLE_STATUS.PARTIAL,
        packageId: '125433',
        error: '1 oferta(s) no se pudieron crear',
        children: [
          { sku: 'HIJO1', chosenSku: 'CL.HIJO1', discountRate: null, mainDiscountRate: null, status: CHILD_STATUS.OK, error: '' },
          { sku: 'HIJO2', chosenSku: '', discountRate: '10', mainDiscountRate: '40', status: CHILD_STATUS.ERROR, error: 'No existe' },
        ],
      },
    ],
  };

  it('genera una fila por oferta repitiendo las columnas del bundle', () => {
    const { headers, rows } = buildMatrix(run);
    expect(headers[0]).toBe('SKU principal');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(['PADRE', 'Creado con errores', '125433', 'HIJO1', 'CL.HIJO1', '5', '50', 'Creada', '1 oferta(s) no se pudieron crear']);
    expect(rows[1][5]).toBe('10');
    expect(rows[1][8]).toBe('No existe');
  });

  it('deja una fila cuando el bundle no llego a tener hijos', () => {
    const { rows } = buildMatrix({
      config: {},
      items: [{ parentSku: 'PADRE', status: BUNDLE_STATUS.ERROR, error: 'SKU inexistente', children: [] }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0][8]).toBe('SKU inexistente');
  });

  it('protege las celdas que Excel ejecutaria como formula', () => {
    const csv = matrixToCsv({ headers: ['a'], rows: [['=CMD()'], ['texto, con coma']] });
    expect(csv).toContain("'=CMD()");
    expect(csv).toContain('"texto, con coma"');
    expect(csv.startsWith('﻿')).toBe(true);
  });
});
