// Las tres piezas que deciden si una orden se da por encontrada, y que fallan
// en silencio si se rompen: leer la nota de la pasarela, comparar lo tecleado
// con lo que dice la nota, y armar el CSV que el usuario se lleva.
//
// No hay jsdom en el proyecto: se trabaja con el texto de la nota (que es lo
// que el content script le pasa a estas funciones) y con runs de mentira.

import { describe, expect, it } from 'vitest';
import { buildTransaction, detectGateway, parseNoteComment, readField } from '../../src/features/magento/buscar-orden/transactions.js';
import { buildCriteria, evaluateOrder, transactionMatches, valueMatches } from '../../src/features/magento/buscar-orden/match.js';
import { buildMatrix } from '../../src/features/magento/buscar-orden/csv.js';
import { gridDateRange } from '../../src/features/magento/buscar-orden/content/flows/run.js';
import { pickPageSizeOption } from '../../src/features/magento/buscar-orden/content/grid.js';
import { rangeDays } from '../../src/features/magento/buscar-orden/popup/section.js';
import { GATEWAY, ORDER_STATUS } from '../../src/features/magento/buscar-orden/constants.js';

// Nota real de una compra con Webpay (los <br> ya vienen como saltos de linea).
const WEBPAY_NOTE = [
  'Transacción Aprobada',
  '',
  'VCI: TSY',
  'Estado: AUTHORIZED',
  'Código de respuesta: 0',
  'Monto: 341990',
  'Código de autorización: 002187',
  'Tipo de pago: VD',
  'Cuotas: 0',
  'ID de sesión: 1296933667',
  'Orden de compra: 123001395247',
  'Número de tarjeta: 0018',
  'Fecha de transacción: 26-07-2026 18:58:39 +01:00',
].join('\n');

const MERCADOPAGO_NOTE = [
  'Notificación automática de Mercado Pago: El pago fue aprobado.',
  'Número de Pago: 169680708947',
  'Estado: approved',
  'Detalle del Estado: accredited',
].join('\n');

describe('parseNoteComment', () => {
  it('separa los pares de una nota de Webpay y guarda el titulo', () => {
    const parsed = parseNoteComment(WEBPAY_NOTE);
    expect(parsed.title).toBe('Transacción Aprobada');
    expect(parsed.values['Código de autorización']).toBe('002187');
    expect(parsed.values['Fecha de transacción']).toBe('26-07-2026 18:58:39 +01:00');
  });

  it('la frase de cabecera de MercadoPago no se cuela como campo', () => {
    const parsed = parseNoteComment(MERCADOPAGO_NOTE);
    expect(parsed.title).toContain('El pago fue aprobado');
    expect(Object.keys(parsed.values)).toEqual(['Número de Pago', 'Estado', 'Detalle del Estado']);
  });

  it('acepta notas en JSON', () => {
    const parsed = parseNoteComment('{"status":"rejected","status_detail":"cc_rejected_high_risk"}');
    expect(parsed.isJson).toBe(true);
    expect(parsed.values.status_detail).toBe('cc_rejected_high_risk');
  });
});

describe('detectGateway', () => {
  it('reconoce Webpay por VCI / codigo de respuesta', () => {
    expect(detectGateway(parseNoteComment(WEBPAY_NOTE))).toBe(GATEWAY.WEBPAY);
  });

  it('reconoce MercadoPago por su frase y sus campos', () => {
    expect(detectGateway(parseNoteComment(MERCADOPAGO_NOTE))).toBe(GATEWAY.MERCADOPAGO);
  });

  it('una nota de historial no es de ninguna pasarela', () => {
    expect(detectGateway(parseNoteComment('Esperando pago del cliente'))).toBe(GATEWAY.UNKNOWN);
  });
});

describe('readField', () => {
  it('encuentra el campo aunque la etiqueta venga con acentos', () => {
    const tx = buildTransaction({ comment: WEBPAY_NOTE });
    expect(readField(tx, ['codigo de autorizacion'])).toBe('002187');
    expect(readField(tx, ['id de sesion'])).toBe('1296933667');
  });

  it('devuelve vacio si el campo no esta', () => {
    expect(readField(buildTransaction({ comment: MERCADOPAGO_NOTE }), ['vci'])).toBe('');
  });
});

describe('valueMatches', () => {
  it('compara sin importar mayusculas ni espacios', () => {
    expect(valueMatches(' authorized ', 'AUTHORIZED')).toBe(true);
  });

  it('ignora los puntos de miles al comparar montos', () => {
    expect(valueMatches('341.990', '341990', { numeric: true })).toBe(true);
  });

  it('ignora los ceros a la izquierda de un codigo de autorizacion', () => {
    expect(valueMatches('2187', '002187')).toBe(true);
  });

  it('no da por bueno un valor distinto', () => {
    expect(valueMatches('002187', '009999')).toBe(false);
  });

  it('un campo vacio no filtra nada', () => {
    expect(valueMatches('', 'lo que sea')).toBe(true);
  });
});

describe('transactionMatches', () => {
  const criteria = buildCriteria({
    gateways: [GATEWAY.WEBPAY],
    fields: { [GATEWAY.WEBPAY]: { authCode: '002187', status: 'AUTHORIZED' } },
  });

  it('exige que se cumplan TODOS los campos pedidos', () => {
    expect(transactionMatches(buildTransaction({ comment: WEBPAY_NOTE }), criteria)).toBe(true);
    const otra = buildTransaction({ comment: WEBPAY_NOTE.replace('002187', '004444') });
    expect(transactionMatches(otra, criteria)).toBe(false);
  });

  it('una transaccion de otra pasarela nunca coincide', () => {
    expect(transactionMatches(buildTransaction({ comment: MERCADOPAGO_NOTE }), criteria)).toBe(false);
  });

  it('sin criterios se toma todo (modo "capturar el rango completo")', () => {
    expect(transactionMatches(buildTransaction({ comment: MERCADOPAGO_NOTE }), [])).toBe(true);
  });

  it('una pasarela marcada sin campos toma todas sus transacciones', () => {
    const soloPasarela = buildCriteria({ gateways: [GATEWAY.MERCADOPAGO], fields: {} });
    expect(transactionMatches(buildTransaction({ comment: MERCADOPAGO_NOTE }), soloPasarela)).toBe(true);
    expect(transactionMatches(buildTransaction({ comment: WEBPAY_NOTE }), soloPasarela)).toBe(false);
  });
});

describe('evaluateOrder', () => {
  it('devuelve cual de las notas coincidio, no solo que hubo una', () => {
    const criteria = buildCriteria({
      gateways: [GATEWAY.MERCADOPAGO],
      fields: { [GATEWAY.MERCADOPAGO]: { paymentId: '169680708947' } },
    });
    const transactions = [
      buildTransaction({ comment: WEBPAY_NOTE }),
      buildTransaction({ comment: MERCADOPAGO_NOTE }),
    ];
    expect(evaluateOrder(transactions, criteria)).toEqual({ matched: true, matchedIndexes: [1] });
  });

  it('una orden sin notas no coincide', () => {
    expect(evaluateOrder([], []).matched).toBe(false);
  });
});

describe('buildMatrix', () => {
  const run = {
    items: [
      {
        incrementId: '123001395247',
        entityId: '34924237',
        viewHref: 'https://shop.lg.com/obsadm/sales/order/view/order_id/34924237/',
        status: ORDER_STATUS.OK,
        matched: true,
        matchedIndexes: [0],
        summary: { ID: '123001395247', Status: 'Processing', 'Customer Email': 'a@b.cl' },
        transactions: [buildTransaction({ when: 'Jul 26, 2026 7:01:02 PM', noteStatus: 'Place Order', comment: WEBPAY_NOTE })],
      },
      {
        incrementId: '123001394986',
        entityId: '34924100',
        viewHref: 'https://shop.lg.com/obsadm/sales/order/view/order_id/34924100/',
        status: ORDER_STATUS.OK,
        matched: false,
        matchedIndexes: [],
        summary: { ID: '123001394986' },
        transactions: [],
      },
      { incrementId: '999', entityId: '1', status: ORDER_STATUS.PENDING, transactions: [] },
    ],
  };

  it('deja fuera las ordenes que todavia no se revisaron', () => {
    const { rows } = buildMatrix(run, { onlyMatches: false });
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.includes('999'))).toBe(false);
  });

  it('una orden sin transacciones igual aparece, con el aviso', () => {
    const { headers, rows } = buildMatrix(run, { onlyMatches: false });
    const fila = rows.find((row) => row[0] === '123001394986');
    expect(fila[headers.indexOf('Pasarela')]).toBe('Sin datos de transaccion');
  });

  it('cada campo de la nota es una columna', () => {
    const { headers, rows } = buildMatrix(run, { onlyMatches: true });
    expect(rows).toHaveLength(1);
    expect(rows[0][headers.indexOf('Tx - Código de autorización')]).toBe('002187');
    expect(rows[0][headers.indexOf('Coincide')]).toBe('SI');
  });
});

describe('gridDateRange', () => {
  it('traduce el <input type=date> al formato del datepicker de Magento', () => {
    expect(gridDateRange({ from: '2026-07-26', to: '2026-08-25' }))
      .toEqual({ from: '7/26/2026', to: '8/25/2026' });
  });

  it('un valor vacio no inventa una fecha', () => {
    expect(gridDateRange({}).from).toBe('');
  });
});

// El recorrido del listado: cuantas ordenes se piden por pagina (cada pagina de
// mas es una vuelta completa contra el servidor) y si el rango que teclea el
// usuario cabe en lo que Magento acepta (sobre un mes, el grid falla).
describe('pickPageSizeOption', () => {
  const opciones = (sizes) => sizes.map((size) => ({ textContent: ` ${size} ` }));

  it('elige el tamano pedido cuando el grid lo ofrece', () => {
    expect(pickPageSizeOption(opciones([20, 30, 50, 100, 200]), 200).size).toBe(200);
  });

  it('cae en el mayor disponible si no esta el pedido', () => {
    expect(pickPageSizeOption(opciones([20, 30, 50]), 200).size).toBe(50);
  });

  it('devuelve null si el selector no trae numeros', () => {
    expect(pickPageSizeOption([], 200)).toBeNull();
    expect(pickPageSizeOption([{ textContent: 'Custom' }], 200)).toBeNull();
  });
});

describe('rangeDays', () => {
  it('cuenta los dias entre extremos', () => {
    expect(rangeDays('2026-08-01', '2026-08-08')).toBe(7);
    expect(rangeDays('2026-08-08', '2026-08-08')).toBe(0);
  });

  it('marca en negativo el rango al reves', () => {
    expect(rangeDays('2026-08-10', '2026-08-01')).toBe(-9);
  });

  it('avisa cuando la fecha no es una fecha', () => {
    expect(Number.isNaN(rangeDays('', '2026-08-01'))).toBe(true);
  });
});
