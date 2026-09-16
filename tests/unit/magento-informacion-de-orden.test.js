// Las piezas puras del modulo "Informacion de Orden": armar la consulta al
// grid (que es lo que resuelve el enlace de cada orden), leer lo que devuelve
// el admin y normalizar el pago de cada pasarela.
//
// El parser de la ficha y el CSV viven en `*-ficha.test.js`, que necesita DOM.

import { describe, expect, it } from 'vitest';
import { buildGridParams, buildGridUrl, rangeDays, splitDateRange, toGridDate } from '../../src/features/magento/informacion_de_orden/grid-request.js';
import {
  extractGridData,
  extractUpdateUrl,
  filterErrorMessage,
  isFilterError,
  moneyValue,
  parseJsonField,
  stripHtml,
} from '../../src/features/magento/informacion_de_orden/grid-parse.js';
import { normalizePayment } from '../../src/features/magento/informacion_de_orden/payment.js';
import { parseOrderNumbers } from '../../src/features/magento/informacion_de_orden/parse-input.js';
import { GATEWAY, clampConcurrency } from '../../src/features/magento/informacion_de_orden/constants.js';
import {
  addTiming,
  describeSummary,
  emptyStats,
  formatDuration,
  formatMs,
  summarizeRun,
} from '../../src/features/magento/informacion_de_orden/stats.js';

const GRID_KEY_URL = 'https://shop.lg.com/obsadm/mui/index/render/key/0e4ffabc123/';

function gridHtml({ items = [], totalRecords = items.length } = {}) {
  const payload = {
    '*': {
      Magento_Ui: {
        'sales_order_grid.sales_order_grid_data_source': {
          update_url: GRID_KEY_URL,
          data: { items, totalRecords },
        },
      },
    },
  };
  return `<html><body><script type="text/x-magento-init">${JSON.stringify(payload)}</script></body></html>`;
}

describe('grid-request', () => {
  it('formatea la fecha como M/DD/YYYY, con el mes sin cero a la izquierda', () => {
    expect(toGridDate('2026-09-01')).toBe('9/01/2026');
    expect(toGridDate('2026-12-31')).toBe('12/31/2026');
    expect(toGridDate('')).toBe('');
    expect(toGridDate('01-09-2026')).toBe('');
  });

  it('manda siempre los tres filtros que LG exige', () => {
    const params = buildGridParams({ from: '2026-09-01', to: '2026-09-15' });
    expect(params.get('filters[created_at][from]')).toBe('9/01/2026');
    expect(params.get('filters[created_at][to]')).toBe('9/15/2026');
    expect(params.get('filters[store_id][]')).toBe('123');
    expect(params.get('namespace')).toBe('sales_order_grid');
    expect(params.get('isAjax')).toBe('true');
    // Sin numero de orden no se manda el filtro (traeria el rango entero igual).
    expect(params.get('filters[increment_id]')).toBeNull();
  });

  it('agrega el numero de orden y achica la pagina en modo lista', () => {
    const params = buildGridParams({ from: '2026-09-01', to: '2026-09-15', incrementId: ' 123001427905 ' });
    expect(params.get('filters[increment_id]')).toBe('123001427905');
    expect(params.get('paging[pageSize]')).toBe('10');
  });

  it('arma la URL sin pisar la query del endpoint', () => {
    const url = buildGridUrl(`${GRID_KEY_URL}?viejo=1`, { from: '2026-09-01', to: '2026-09-02' });
    expect(url.startsWith(`${GRID_KEY_URL}?`)).toBe(true);
    expect(url).not.toContain('viejo=1');
  });

  it('cuenta los dias del rango', () => {
    expect(rangeDays('2026-09-01', '2026-09-15')).toBe(14);
    expect(rangeDays('2026-09-15', '2026-09-01')).toBe(-14);
    expect(Number.isNaN(rangeDays('', '2026-09-01'))).toBe(true);
  });

  it('divide rangos largos en bloques sin superposicion, desde el mas reciente', () => {
    expect(splitDateRange('2026-06-01', '2026-09-09')).toEqual([
      { from: '2026-08-12', to: '2026-09-09' },
      { from: '2026-07-14', to: '2026-08-11' },
      { from: '2026-06-15', to: '2026-07-13' },
      { from: '2026-06-01', to: '2026-06-14' },
    ]);
  });

  it('un rango que Magento acepta entero queda en un solo bloque', () => {
    expect(splitDateRange('2026-09-01', '2026-09-15')).toEqual([{ from: '2026-09-01', to: '2026-09-15' }]);
    // 29 dias de calendario es el maximo que paso en la prueba contra el admin.
    expect(splitDateRange('2026-08-12', '2026-09-09')).toHaveLength(1);
    expect(splitDateRange('2026-08-11', '2026-09-09')).toHaveLength(2);
    // Un solo dia sigue siendo un bloque valido.
    expect(splitDateRange('2026-09-09', '2026-09-09')).toEqual([{ from: '2026-09-09', to: '2026-09-09' }]);
  });

  it('un rango imposible no devuelve bloques (el motor lo trata como error)', () => {
    expect(splitDateRange('2026-09-15', '2026-09-01')).toEqual([]);
    expect(splitDateRange('', '2026-09-01')).toEqual([]);
    expect(splitDateRange('2026-09-01', '2026-13-40')).toEqual([]);
  });
});

describe('grid-parse', () => {
  it('reconoce el ORDER_FILTER_ERROR, que llega con HTTP 200', () => {
    expect(isFilterError('ORDER_FILTER_ERROR The "Purchase Date" date filter is required...')).toBe(true);
    expect(isFilterError('  ORDER_FILTER_ERROR algo')).toBe(true);
    expect(isFilterError('<html></html>')).toBe(false);
  });

  it('traduce los tres rechazos del servidor', () => {
    expect(filterErrorMessage('ORDER_FILTER_ERROR The "Purchase Date" date filter is required when applying column filters.'))
      .toContain('Purchase Date');
    expect(filterErrorMessage('ORDER_FILTER_ERROR The "Purchase Point" is required when applying column filters.'))
      .toContain('Purchase Point');
    expect(filterErrorMessage('ORDER_FILTER_ERROR Date range cannot exceed 1 month. Please adjust your filters.'))
      .toContain('28 dias');
  });

  it('saca el JSON embebido en el HTML del grid', () => {
    const html = gridHtml({ items: [{ increment_id: '123001427905' }], totalRecords: 1 });
    expect(extractGridData(html)).toEqual({ items: [{ increment_id: '123001427905' }], totalRecords: 1 });
  });

  it('se queda con el grid que trae filas cuando hay mas de uno montado', () => {
    const vacio = '<script type="text/x-magento-init">{"a":{"data":{"items":[],"totalRecords":0}}}</script>';
    const html = vacio + gridHtml({ items: [{ increment_id: '1' }], totalRecords: 1 });
    expect(extractGridData(html).items).toHaveLength(1);
  });

  it('devuelve null si no hay datos del grid', () => {
    expect(extractGridData('<html><body>nada</body></html>')).toBeNull();
  });

  it('resuelve el update_url del JSON y, si falta, del HTML con barras escapadas', () => {
    expect(extractUpdateUrl(gridHtml())).toBe(GRID_KEY_URL);
    const escapado = '<div data-x="https:\\/\\/shop.lg.com\\/obsadm\\/mui\\/index\\/render\\/key\\/abc123\\/"></div>';
    expect(extractUpdateUrl(escapado)).toBe('https://shop.lg.com/obsadm/mui/index/render/key/abc123/');
    expect(extractUpdateUrl('<html></html>')).toBe('');
  });

  it('limpia el HTML que traen varios campos del grid', () => {
    expect(stripHtml('<b>86MRGB95BSA.AWH</b>')).toBe('86MRGB95BSA.AWH');
    expect(stripHtml('uno<br>dos')).toBe('uno / dos');
    expect(stripHtml('Caf&eacute; &amp; t&eacute;')).toBe('Caf & t');
    expect(stripHtml(null)).toBe('');
    expect(stripHtml({ a: 1 })).toBe('');
  });

  it('deja los importes en un numero que la planilla entienda', () => {
    expect(moneyValue('$453,981.00')).toBe('453981.00');
    expect(moneyValue('453981.0000')).toBe('453981.0000');
    expect(moneyValue('')).toBe('');
    expect(moneyValue('N/A')).toBe('N/A');
  });

  it('parsea los campos que llegan como string JSON', () => {
    expect(parseJsonField('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonField('no es json')).toBeNull();
    expect(parseJsonField('')).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Pagos: un caso por cada variante medida en el doc.
// -----------------------------------------------------------------------------

const WEBPAY_VN = {
  increment_id: '123001427943',
  payment_method: 'transbank_webpay',
  additional_information: JSON.stringify({
    raw_details_info: {
      vci: 'TSY',
      status: 'AUTHORIZED',
      responseCode: 0,
      amount: 453981,
      authorizationCode: '464143',
      paymentTypeCode: 'VN',
      installmentsNumber: 0,
      sessionId: '1304809849',
      buyOrder: '123001427943',
      cardNumber: '1043',
      cardDetail: { card_number: '1043' },
    },
  }),
};

const WEBPAY_SI = {
  increment_id: '123001426338',
  payment_method: 'transbank_webpay',
  additional_information: JSON.stringify({
    raw_details_info: {
      status: 'AUTHORIZED',
      responseCode: 0,
      paymentTypeCode: 'SI',
      installmentsNumber: 3,
      installmentsAmount: 18662,
      authorizationCode: '002187',
      cardNumber: '0018',
    },
  }),
};

const MP_BASIC = {
  increment_id: '123001427928',
  payment_method: 'fih_mercadopago_basic',
  additional_information: JSON.stringify({
    method_title: 'Otras formas de pago - Mercado Pago',
    paymentResponse: {
      id: 177954021141,
      external_reference: '123001427928',
      status: 'approved',
      status_detail: 'accredited',
      transaction_amount: 1164801,
      installments: 1,
      payment_method_id: 'visa',
      payment_type_id: 'credit_card',
      payment_method: { id: 'visa', type: 'credit_card', data: { threeds: 'AUTHENTICATED' } },
      authorization_code: '1Q6XQ5',
      card: { bin: '41913202', last_four_digits: '0884' },
      fee_details: [{ amount: 31916, fee_payer: 'collector', type: 'mercadopago_fee' }],
      transaction_details: { net_received_amount: 1132885, total_paid_amount: 1164801 },
    },
  }),
};

// La variante que mas rompe parsers: con saldo de MP, `card` llega como [].
const MP_ACCOUNT_MONEY = {
  increment_id: '123001426389',
  payment_method: 'fih_mercadopago_basic',
  additional_information: JSON.stringify({
    method_title: 'Otras formas de pago - Mercado Pago',
    paymentResponse: {
      id: 169680708947,
      external_reference: '123001426389',
      status: 'approved',
      status_detail: 'accredited',
      transaction_amount: 341990,
      installments: 1,
      payment_method_id: 'account_money',
      payment_type_id: 'account_money',
      card: [],
      statement_descriptor: null,
    },
  }),
};

const MP_GLOBAL = {
  increment_id: '123001427905',
  payment_method: 'mercadopago_global_credit_card',
  additional_information: JSON.stringify({
    method_title: 'Tarjeta de credito - Mercado Pago',
    token: '12bb1538219150da6488812314481d7d',
    cc_type: 'MC',
    paymentResponse: {
      id: 178904668430,
      external_reference: '123001427905',
      status: 'approved',
      status_detail: 'accredited',
      transaction_amount: 453981,
      installments: 12,
      payment_method_id: 'master',
      payment_type_id: 'credit_card',
      authorization_code: '307840',
      card: { last_four_digits: '4805' },
      transaction_details: { net_received_amount: 441542 },
      fee_details: [{ amount: 12439 }],
    },
  }),
};

const MARKETPLACE = {
  increment_id: '123001427216',
  payment_method: 'marketplace_payment',
  marketplace_name: 'FALABELLA',
  marketplace_order_id: '3251641874',
  additional_information: JSON.stringify({
    card_operator: '',
    reference_code: null,
    payment_name: 'ecommPay',
  }),
};

describe('normalizePayment', () => {
  it('Webpay sin cuotas', () => {
    const pay = normalizePayment(WEBPAY_VN);
    expect(pay.gateway).toBe(GATEWAY.WEBPAY);
    expect(pay.authCode).toBe('464143');
    expect(pay.last4).toBe('1043');
    expect(pay.installments).toBe('0');
    expect(pay.paymentTypeLabel).toContain('sin cuotas');
    expect(pay.pgStatus).toBe('AUTHORIZED');
    expect(pay.pgStatusDetail).toBe('responseCode 0');
    expect(pay.threeDs).toBe('TSY');
    expect(pay.reference).toBe('123001427943');
  });

  it('Webpay en cuotas', () => {
    const pay = normalizePayment(WEBPAY_SI);
    expect(pay.installments).toBe('3');
    expect(pay.paymentTypeLabel).toBe('Cuotas sin interes');
    expect(pay.authCode).toBe('002187');
  });

  it('MercadoPago pasarela con tarjeta', () => {
    const pay = normalizePayment(MP_BASIC);
    expect(pay.gateway).toBe(GATEWAY.MERCADOPAGO);
    expect(pay.txId).toBe('177954021141');
    expect(pay.authCode).toBe('1Q6XQ5');
    expect(pay.brand).toBe('visa');
    expect(pay.last4).toBe('0884');
    expect(pay.fee).toBe('31916');
    expect(pay.netAmount).toBe('1132885');
    expect(pay.threeDs).toBe('AUTHENTICATED');
    expect(pay.reference).toBe('123001427928');
  });

  it('MercadoPago con saldo: card es un array vacio y no debe romper', () => {
    const pay = normalizePayment(MP_ACCOUNT_MONEY);
    expect(pay.gateway).toBe(GATEWAY.MERCADOPAGO);
    expect(pay.brand).toBe('account_money');
    expect(pay.last4).toBe('');
    expect(pay.fee).toBe('');
    expect(pay.netAmount).toBe('');
    expect(pay.amount).toBe('341990');
  });

  it('MercadoPago incrustado', () => {
    const pay = normalizePayment(MP_GLOBAL);
    expect(pay.txId).toBe('178904668430');
    expect(pay.installments).toBe('12');
    expect(pay.brand).toBe('master');
    expect(pay.last4).toBe('4805');
    expect(pay.netAmount).toBe('441542');
  });

  it('Marketplace no trae campos de pago: se cae a las columnas del grid', () => {
    const pay = normalizePayment(MARKETPLACE);
    expect(pay.gateway).toBe(GATEWAY.MARKETPLACE);
    expect(pay.methodTitle).toBe('ecommPay');
    expect(pay.brand).toBe('FALABELLA');
    expect(pay.reference).toBe('3251641874');
  });

  it('un metodo desconocido devuelve el modelo vacio, no una excepcion', () => {
    expect(normalizePayment({ payment_method: 'free' }).gateway).toBe(GATEWAY.UNKNOWN);
    expect(normalizePayment(null).gateway).toBe(GATEWAY.UNKNOWN);
    expect(normalizePayment({ payment_method: 'x', additional_information: 'roto{' }).authCode).toBe('');
  });
});

// -----------------------------------------------------------------------------
// Entrada del usuario y concurrencia
// -----------------------------------------------------------------------------

describe('parseOrderNumbers', () => {
  it('acepta comas, puntos y comas y saltos de linea', () => {
    const { numbers } = parseOrderNumbers('123001427905, 123001427943;\n123001427216');
    expect(numbers).toEqual(['123001427905', '123001427943', '123001427216']);
  });

  it('digiere un CSV con encabezado y columnas de sobra', () => {
    const { numbers } = parseOrderNumbers('Orden,Monto\n"123001427905",1000\n"123001427943",2000');
    expect(numbers).toEqual(['123001427905', '123001427943']);
  });

  it('quita repetidas y avisa', () => {
    const { numbers, warnings } = parseOrderNumbers('123001427905\n123001427905');
    expect(numbers).toEqual(['123001427905']);
    expect(warnings.join(' ')).toContain('repetida');
  });

  it('ignora lo que no parece numero de orden', () => {
    const { numbers, warnings } = parseOrderNumbers('123001427905, 12, texto');
    expect(numbers).toEqual(['123001427905']);
    expect(warnings.join(' ')).toContain('12');
  });
});

describe('clampConcurrency', () => {
  it('acepta cualquier entero positivo y cae al default con basura', () => {
    expect(clampConcurrency(1)).toBe(1);
    expect(clampConcurrency(8)).toBe(8);
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(99)).toBe(99);
    expect(clampConcurrency('x')).toBe(6);
    expect(clampConcurrency(undefined)).toBe(6);
    expect(clampConcurrency('')).toBe(6);
  });
});

describe('stats: donde se va el tiempo', () => {
  const timing = { ttfbMs: 2000, downloadMs: 400, parseMs: 30, logsMs: 900, bytes: 400 * 1024, requests: 3, retries: 1 };

  it('acumula los tiempos de cada ficha sin mutar el anterior', () => {
    const base = emptyStats();
    const once = addTiming(base, timing);
    const twice = addTiming(once, timing);
    expect(base.count).toBe(0);
    expect(once.count).toBe(1);
    expect(twice).toMatchObject({ count: 2, requests: 6, retries: 2, ttfbMs: 4000, downloadMs: 800, bytes: 800 * 1024 });
    // Un run viejo sin stats no revienta.
    expect(addTiming(undefined, timing).count).toBe(1);
    expect(addTiming(once, null)).toBe(once);
  });

  it('resume ritmo, lo que falta y los promedios por ficha', () => {
    const run = {
      active: true,
      total: 100,
      doneCount: 20,
      fetchStartedAt: 1000,
      stats: addTiming(addTiming(emptyStats(), timing), timing),
    };
    const summary = summarizeRun(run, 1000 + 60000);
    expect(summary.perMinute).toBe(20);
    expect(summary.pending).toBe(80);
    expect(summary.etaMs).toBe(4 * 60000);
    expect(summary).toMatchObject({ avgTtfbMs: 2000, avgDownloadMs: 400, avgLogsMs: 900, kbPerOrder: 400, retries: 2 });
    expect(describeSummary(summary)).toBe('20,0 fichas/min - espera 2,0 s y descarga 400 ms por ficha - logs 900 ms mas - 400 KB por ficha - 2 reintento(s)');
  });

  it('sin fichas entradas no hay resumen, y terminado se mide hasta finishedAt', () => {
    expect(summarizeRun(null)).toBeNull();
    expect(summarizeRun({ active: true, doneCount: 0, fetchStartedAt: 1 })).toBeNull();
    expect(summarizeRun({ active: true, doneCount: 3 })).toBeNull();
    const done = summarizeRun({ active: false, doneCount: 30, total: 30, fetchStartedAt: 10000, finishedAt: 130000, stats: emptyStats() }, 999999);
    expect(done.elapsedMs).toBe(120000);
    expect(done.perMinute).toBe(15);
    expect(done.pending).toBe(0);
  });

  it('formatea duraciones y milisegundos para leerlos', () => {
    expect(formatDuration(45000)).toBe('45 s');
    expect(formatDuration(750000)).toBe('12 min 30 s');
    expect(formatDuration(3900000)).toBe('1 h 05 min');
    expect(formatMs(350)).toBe('350 ms');
    expect(formatMs(2840)).toBe('2,8 s');
  });
});
