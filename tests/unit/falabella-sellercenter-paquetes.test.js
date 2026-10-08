import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { queryOrdenada, timestampApi, urlFirmada } from '../../src/features/falabella-sellercenter/api/firma.js';
import { comoLista } from '../../src/features/falabella-sellercenter/api/cliente.js';
import {
  analizarItems, diaDe, hallazgo, parseMonto, pasaFiltroEstados, resumenOrden, totales, ventanaApi,
} from '../../src/features/falabella-sellercenter/paquetes/analisis.js';
import {
  buildCsv, buildTexto, filaTotalOrdenes, filasOrdenes, filasProductos,
} from '../../src/features/falabella-sellercenter/paquetes/export.js';
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

// Cabecera real de 3254612276 (montos tal cual los manda la API).
const ORDEN_MAL = {
  OrderId: '1167611729', OrderNumber: '3254612276', CreatedAt: '2026-10-05 14:47:24', ItemsCount: '2',
  Statuses: [{ Status: 'ready_to_ship' }], Price: '658970.00', GrandTotal: '658,970.00',
  ProductTotal: '639,980.00', ShippingFeeTotal: '18,990.00', Voucher: '20002.00',
};
const MAL_CON_PRECIOS = MAL.map((it, i) => ({ ...it, OrderItemId: String(42764139 + i), PaidPrice: '319990.00', ItemPrice: '329991.00', ShippingAmount: '9495.00' }));
const h = hallazgo(resumenOrden(ORDEN_MAL), analizarItems(MAL_CON_PRECIOS), MAL_CON_PRECIOS);

describe('montos y productos', () => {
  it('parsea montos con coma de miles', () => {
    expect(parseMonto('658,970.00')).toBe(658970);
    expect(parseMonto('20002.00')).toBe(20002);
    expect(parseMonto('')).toBe(0);
    expect(parseMonto('abc')).toBe(0);
  });

  it('montos de la orden: total = productos + envio', () => {
    expect(h.montos).toEqual({ productos: 639980, envio: 18990, descuento: 20002, total: 658970 });
    expect(h.montos.productos + h.montos.envio).toBe(h.montos.total);
  });

  it('productos con SKU y precio, primero los del paquete compartido', () => {
    const items = [...MAL_CON_PRECIOS, item({ Sku: 'AAA', PackageId: 'PKG-A', PaidPrice: '1000.00' }), item({ Sku: 'CAN', Status: 'canceled', PackageId: 'PKG-0' })];
    const lista = hallazgo(resumenOrden(ORDEN_MAL), analizarItems(items), items).items;
    expect(lista.map((it) => [it.sku, it.compartido, it.activo])).toEqual([
      ['55NU855BPSA.AWH.ESCL.CL.C', true, true],
      ['55NU855BPSA.AWH.ESCL.CL.C', true, true],
      ['AAA', false, true],
      ['CAN', false, false],
    ]);
    expect(lista[0]).toMatchObject({ precio: 319990, precioLista: 329991, paquete: 'PKG00002M1XS5', guia: '140111000018569779' });
  });

  it('totales del resultado', () => {
    const otra = { ...h, orderNumber: '1', montos: { ...h.montos, total: 30, envio: 0 } };
    expect(totales([h, otra])).toEqual({ ordenes: 2, monto: 659000, envio: 18990 });
    expect(totales([])).toEqual({ ordenes: 0, monto: 0, envio: 0 });
  });

  it('filtro de estados: vacio deja pasar todo; si no, basta con un estado', () => {
    expect(pasaFiltroEstados(['pending'], [])).toBe(true);
    expect(pasaFiltroEstados(['pending', 'canceled'], ['canceled'])).toBe(true);
    expect(pasaFiltroEstados(['delivered'], ['pending', 'ready_to_ship'])).toBe(false);
  });
});

describe('export', () => {
  it('hoja Ordenes: una fila por orden con montos y estado legible', () => {
    expect(filasOrdenes([h])[0]).toEqual([
      '3254612276', '2026-10-05 14:47:24', 'Listo para despacho', 2, 1, 1,
      '55NU855BPSA.AWH.ESCL.CL.C x2', 'PKG00002M1XS5', '140111000018569779',
      639980, 18990, 20002, 658970, '', '1167611729',
    ]);
    expect(filaTotalOrdenes([h, h])).toEqual(['TOTAL (2 ordenes)', '', '', '', '', '', '', '', '', 1279960, 37980, 40004, 1317940, '', '']);
  });

  it('hoja Productos: una fila por producto; montos de la orden solo en la primera', () => {
    const filas = filasProductos([h]);
    expect(filas).toHaveLength(2);
    expect(filas[0].slice(0, 5)).toEqual(['3254612276', '2026-10-05 14:47:24', 'Listo para despacho', '1 de 2', '55NU855BPSA.AWH.ESCL.CL.C']);
    expect(filas[0].slice(7)).toEqual([319990, 329991, 'PKG00002M1XS5', 'Si', '140111000018569779', 639980, 18990, 658970]);
    expect(filas[1].slice(12)).toEqual(['', '', '']);
  });

  it('CSV con BOM, una fila por producto y protegido contra formulas', () => {
    const csv = buildCsv([{ ...h, items: [{ ...h.items[0], nombre: '=HYPERLINK()' }] }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain(`"'=HYPERLINK()"`);
  });

  it('texto para copiar con total', () => {
    expect(buildTexto([h], { desde: '2026-10-01', hasta: '2026-10-07', estados: ['ready_to_ship'] })).toBe(
      'Ordenes con productos agrupados en un solo paquete (2026-10-01 a 2026-10-07 · estados: Listo para despacho): 1 · monto total $658.970\n'
      + '3254612276 — 2 productos en 1 paquete(s) — 55NU855BPSA.AWH.ESCL.CL.C x2 — Listo para despacho — total $658.970 — PKG00002M1XS5',
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
