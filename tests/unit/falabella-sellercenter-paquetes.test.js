import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { queryOrdenada, timestampApi, urlFirmada } from '../../src/features/falabella-sellercenter/api/firma.js';
import { comoLista } from '../../src/features/falabella-sellercenter/api/cliente.js';
import { analizarItems, diaDe, hallazgo, resumenOrden, ventanaApi } from '../../src/features/falabella-sellercenter/paquetes/analisis.js';
import { buildCsv, buildTexto, filas } from '../../src/features/falabella-sellercenter/paquetes/export.js';
import { descifrar } from '../../src/features/falabella-sellercenter/api/embebido.js';
import { cifrarSecreto } from '../../scripts/secretos.mjs';

// Items reales de la API (oct-2026), recortados a los campos que se usan.
const item = (over) => ({ Sku: 'X', Name: 'Prod', Status: 'ready_to_ship', PackageId: '', TrackingCode: '', ...over });

// 3254531299: bien separada (un paquete y una guia por producto).
const BIEN = [
  item({ Sku: '27U711B-B.AWH.ESCL.CL.C', PackageId: 'PKG00002M11AR', TrackingCode: '140111000018552126' }),
  item({ Sku: 'MS3032JAS.BBKPECL.ESCL.CL.C', PackageId: 'PKG00002M11AQ', TrackingCode: '140111000018552125' }),
];
// 3254612276: dos TV iguales en el mismo paquete y la misma guia.
const MAL = [
  item({ Sku: '55NU855BPSA.AWH.ESCL.CL.C', Name: 'Smart TV 55', PackageId: 'PKG00002M1XS5', TrackingCode: '140111000018569779' }),
  item({ Sku: '55NU855BPSA.AWH.ESCL.CL.C', Name: 'Smart TV 55', PackageId: 'PKG00002M1XS5', TrackingCode: '140111000018569779' }),
];

describe('firma', () => {
  it('ordena por nombre, omite vacios y codifica RFC 3986', () => {
    expect(queryOrdenada({ b: '2', a: 'x y', c: undefined, d: '', e: "(!)" })).toBe('a=x%20y&b=2&e=%28%21%29');
  });

  it('timestamp sin milisegundos con +00:00', () => {
    expect(timestampApi(new Date('2026-10-08T19:52:20.123Z'))).toBe('2026-10-08T19:52:20+00:00');
  });

  it('la firma coincide con HMAC-SHA256 de Node', async () => {
    const cred = { userId: 'a@b.cl', apiKey: 'clave' };
    const url = await urlFirmada(cred, 'GetOrders', { Limit: '1' }, new Date('2026-10-08T00:00:00Z'));
    const [, qs] = url.split('?');
    const [firmado, firma] = qs.split('&Signature=');
    expect(firmado).toBe('Action=GetOrders&Format=JSON&Limit=1&Timestamp=2026-10-08T00%3A00%3A00%2B00%3A00&UserID=a%40b.cl&Version=1.0');
    expect(firma).toBe(createHmac('sha256', 'clave').update(firmado).digest('hex'));
  });
});

describe('analizarItems', () => {
  it('orden bien separada: sin problema', () => {
    const a = analizarItems(BIEN);
    expect(a).toMatchObject({ problema: false, activos: 2, paquetes: 2, grupos: [] });
  });

  it('dos productos en el mismo paquete: problema', () => {
    const a = analizarItems(MAL);
    expect(a.problema).toBe(true);
    expect(a.grupos).toEqual([{
      packageId: 'PKG00002M1XS5',
      trackingCode: '140111000018569779',
      items: [
        { sku: '55NU855BPSA.AWH.ESCL.CL.C', nombre: 'Smart TV 55', estado: 'ready_to_ship' },
        { sku: '55NU855BPSA.AWH.ESCL.CL.C', nombre: 'Smart TV 55', estado: 'ready_to_ship' },
      ],
    }]);
  });

  it('los items cancelados no cuentan', () => {
    const a = analizarItems([MAL[0], { ...MAL[1], Status: 'canceled' }]);
    expect(a).toMatchObject({ problema: false, activos: 1 });
  });

  it('items sin PackageId todavia no se marcan', () => {
    const a = analizarItems([item({}), item({})]);
    expect(a).toMatchObject({ problema: false, sinPaquete: 2, paquetes: 0 });
  });

  it('3 productos, 2 juntos: falta 1 paquete', () => {
    const items = [...MAL, item({ Sku: 'OTRO', PackageId: 'PKG-B' })];
    const h = hallazgo(resumenOrden({ OrderId: 1, OrderNumber: 2, CreatedAt: '2026-10-05 14:47:24', ItemsCount: '3', Statuses: [{ Status: 'ready_to_ship' }] }), analizarItems(items));
    expect(h).toMatchObject({ productos: 3, paquetes: 2, paquetesFaltantes: 1, skus: '55NU855BPSA.AWH.ESCL.CL.C x2', estados: ['ready_to_ship'] });
  });
});

describe('fechas', () => {
  it('ventana con margen por punta', () => {
    expect(ventanaApi('2026-10-01', '2026-10-07', 6)).toEqual({
      createdAfter: '2026-09-30T18:00:00+00:00',
      createdBefore: '2026-10-08T05:59:59+00:00',
    });
  });
  it('dia de CreatedAt (hora de Chile)', () => {
    expect(diaDe('2026-10-05 23:59:59')).toBe('2026-10-05');
  });
});

describe('export', () => {
  const h = hallazgo(resumenOrden({ OrderId: '1167611729', OrderNumber: '3254612276', CreatedAt: '2026-10-05 14:47:24', ItemsCount: '2', Statuses: [{ Status: 'ready_to_ship' }] }), analizarItems(MAL));

  it('una fila por orden', () => {
    expect(filas([h])[0].slice(0, 7)).toEqual(['3254612276', '2026-10-05 14:47:24', 'ready_to_ship', 'ready_to_ship', 2, 1, 1]);
  });
  it('CSV con BOM y protegido contra formulas', () => {
    const csv = buildCsv([{ ...h, nombres: ['=HYPERLINK()'] }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`"'=HYPERLINK()"`);
  });
  it('texto para copiar', () => {
    expect(buildTexto([h], { desde: '2026-10-01', hasta: '2026-10-07' })).toBe(
      'Ordenes con productos agrupados en un solo paquete (2026-10-01 a 2026-10-07): 1\n'
      + '3254612276 — 2 productos en 1 paquete(s) — 55NU855BPSA.AWH.ESCL.CL.C x2 — ready_to_ship — PKG00002M1XS5',
    );
  });
});

describe('credenciales embebidas', () => {
  it('lo que cifra el build lo descifra el SW (y cada build cifra distinto)', async () => {
    const valor = { userId: 'a@b.cl', apiKey: 'clave-de-prueba' };
    const uno = cifrarSecreto(valor);
    const dos = cifrarSecreto(valor);
    expect(uno.c).not.toBe(dos.c);
    expect(JSON.stringify(uno)).not.toContain('clave-de-prueba');
    expect(await descifrar(uno)).toEqual(valor);
  });

  it('un blob alterado no se descifra', async () => {
    const blob = cifrarSecreto({ userId: 'x', apiKey: 'y' });
    const roto = { ...blob, c: Buffer.from(Buffer.from(blob.c, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64') };
    await expect(descifrar(roto)).rejects.toThrow();
  });
});

describe('comoLista', () => {
  it('normaliza uno o varios', () => {
    expect(comoLista(undefined)).toEqual([]);
    expect(comoLista('')).toEqual([]);
    expect(comoLista({ a: 1 })).toEqual([{ a: 1 }]);
    expect(comoLista([1, 2])).toEqual([1, 2]);
  });
});
