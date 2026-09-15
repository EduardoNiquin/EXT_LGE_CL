// @vitest-environment happy-dom
//
// El parser de la ficha de la orden, que es de donde sale la informacion del
// modulo. Se trabaja sobre HTML real (la estructura medida en
// docs/intrucciones.md seccion 5) parseado con DOMParser, igual que en runtime.
//
// Lo que se cuida aca es lo que el doc marca como trampa: las filas CAMBIAN
// entre ordenes (marketplace no trae IP ni tabla de pago, la zona horaria
// cambia de nombre, el descuento lleva el nombre de la promocion), asi que nada
// se puede leer por posicion ni dar por presente.

import { describe, expect, it } from 'vitest';
import { parseOrderDetail } from '../../src/features/magento/informacion_de_orden/detail-parse.js';
import { buildMatrix, buildRecord, makeMissingRecord } from '../../src/features/magento/informacion_de_orden/csv.js';
import { DEFAULT_SECTIONS, expandSections } from '../../src/features/magento/informacion_de_orden/constants.js';
import { readField } from '../../src/features/magento/buscar-orden/transactions.js';

const SECTIONS = expandSections(DEFAULT_SECTIONS);

const parse = (html, sections = SECTIONS) => parseOrderDetail(
  new DOMParser().parseFromString(html, 'text/html'),
  { sections },
);

// Ficha completa: una orden de tarjeta con dos productos.
const FICHA = `
<div class="order-view-account-information">
  <div class="admin__page-section-item order-information">
    <div class="admin__page-section-item-title"><span class="title">Order # 123001427905</span></div>
    <table class="order-information-table">
      <tr><th>Order Date</th><td>Sep 14, 2026, 1:12:20 PM</td></tr>
      <tr><th>Order Date (America/Santiago)</th><td>Sep 14, 2026, 9:12:20 AM</td></tr>
      <tr><th>Order Status</th><td><span id="order_status">Picking for Delivery</span></td></tr>
      <tr><th>Purchased From</th><td>Main Website<br>Chile<br>Chile Default Store View</td></tr>
      <tr><th>Placed from IP</th><td>200.1.2.3</td></tr>
      <tr><th>Devices</th><td>PC</td></tr>
    </table>
  </div>
  <div class="admin__page-section-item">
    <table class="order-account-information-table">
      <tr><th>Customer Name</th><td>Susana Alvarez Perez</td></tr>
      <tr><th>Email</th><td><a href="mailto:susana@example.com">susana@example.com</a></td></tr>
      <tr><th>Customer Group</th><td>General</td></tr>
    </table>
  </div>
</div>

<div class="order-addresses">
  <div class="admin__page-section-item">
    <div class="admin__page-section-item-title"><span class="title">Billing Address</span>
      <a href="/obsadm/sales/order/address/address_id/61398535/">Edit</a></div>
    <address>Susana Alvarez<br>Av. Siempre Viva 742, Depto 31<br>Providencia, Region Metropolitana<br>T: +56912345678</address>
  </div>
  <div class="admin__page-section-item">
    <div class="admin__page-section-item-title"><span class="title">Shipping Address</span></div>
    <address>Susana Alvarez<br>Av. Siempre Viva 742<br>Providencia</address>
  </div>
</div>

<div class="order-view-billing-shipping">
  <div class="order-payment-method">
    <div class="order-payment-method-title">Tarjeta de credito - Mercado Pago</div>
    <table class="data-table">
      <tr><th>Payment id (Mercado Pago):</th><td>178904668430</td></tr>
      <tr><th>Card Number:</th><td>xxxx-4805</td></tr>
      <tr><th>Installments:</th><td>12</td></tr>
      <tr><th>Payment Status:</th><td>approved</td></tr>
    </table>
  </div>
  <div class="order-shipping-method">
    <table><tr><th>Shipping &amp; Handling Information</th><td>Item ID 1 - Entrega agendada</td></tr></table>
  </div>
</div>

<table class="edit-order-table">
  <thead><tr>
    <th>Price</th><th>Qty</th><th>Row Total</th><th>Model</th><th>Item Status</th>
    <th>Warehouse Code</th><th>Tracking Number</th><th>Estimated Delivery Date</th>
  </tr></thead>
  <tbody class="even">
    <tr>
      <td>$453,981.00</td><td>Ordered 1<br>Invoiced 1</td><td>$453,981.00</td>
      <td><b>86MRGB95BSA.AWH</b></td><td>Picking</td><td>CL01</td><td>TRK-1</td><td>16-09-2026</td>
    </tr>
    <tr><td colspan="8">subfila de cantidades</td></tr>
  </tbody>
  <tbody class="odd">
    <tr>
      <td>$99,990.00</td><td>Ordered 2</td><td>$199,980.00</td>
      <td><b>OTRO.SKU</b></td><td>Pending</td><td>CL02</td><td></td><td>18-09-2026</td>
    </tr>
  </tbody>
</table>

<div class="order-totals">
  <table><tbody>
    <tr class="col-0"><td class="label">Subtotal (Price source: ERP)</td><td>$653,961.00</td></tr>
    <tr><td class="label">Discount (LGSANTANDER10 - 10%)</td><td>-$65,396.00</td></tr>
    <tr><td class="label">Grand Total</td><td>$588,565.00</td></tr>
    <tr><td class="label">Total Paid</td><td>$588,565.00</td></tr>
  </tbody></table>
</div>

<div class="custom-section">
  <p>Require Invoice: Yes</p>
  <p>VAT ID: 76.123.456-7</p>
</div>

<ul class="note-list">
  <li class="note-list-item">
    <span class="note-list-date">Sep 14, 2026</span>
    <span class="note-list-time">1:12:30 PM</span>
    <span class="note-list-status">Processing</span>
    <div class="note-list-comment">Transaccion Aprobada<br>Estado: AUTHORIZED<br>Codigo de respuesta: 0<br>Codigo de autorizacion: 464143<br>Orden de compra: 123001427905</div>
  </li>
  <li class="note-list-item">
    <span class="note-list-date">Sep 14, 2026</span>
    <span class="note-list-time">1:20:00 PM</span>
    <span class="note-list-status">Picking for Delivery</span>
    <div class="note-list-comment">{"holded":"picking_for_delivery","global":null}</div>
  </li>
</ul>

<div class="gerp-export-log">
  <table>
    <thead><tr><th>Action Type</th><th>Status</th><th>Created At</th></tr></thead>
    <tbody><tr><td>order</td><td>success</td><td>2026-09-14 13:13:00</td></tr></tbody>
  </table>
</div>`;

// Marketplace: el caso que rompe parsers. Sin IP, sin tabla de pago (solo el
// titulo) y con la zona horaria en otro huso.
const FICHA_MARKETPLACE = `
<div class="order-information">
  <div class="admin__page-section-item-title"><span class="title">Order # 123001427216</span></div>
  <table class="order-information-table">
    <tr><th>Order Date</th><td>Sep 10, 2026, 8:00:00 AM</td></tr>
    <tr><th>Order Date (Europe/London)</th><td>Sep 10, 2026, 9:00:00 AM</td></tr>
    <tr><th>Order Status</th><td><span id="order_status">Delivery Completed</span></td></tr>
  </table>
</div>
<div class="order-payment-method">
  <div class="order-payment-method-title">Marketplace Payment - ecommPay</div>
</div>
<table class="edit-order-table">
  <thead><tr><th>Model</th><th>Qty</th></tr></thead>
  <tbody><tr><td>SKU.MKT</td><td>Ordered 1</td></tr></tbody>
</table>`;

describe('parseOrderDetail', () => {
  const detail = parse(FICHA);
  const field = (section, label) => detail.fields.find((f) => f.section === section && f.label === label)?.value;

  it('lee el numero de orden y el estado', () => {
    expect(detail.orderNumber).toBe('123001427905');
    expect(detail.status).toBe('Picking for Delivery');
  });

  it('lee las dos tablas de cabecera por etiqueta, no por posicion', () => {
    expect(field('Orden', 'Order Date')).toContain('Sep 14, 2026');
    // La etiqueta lleva el nombre de la zona horaria, que cambia por orden.
    expect(field('Orden', 'Order Date (America/Santiago)')).toContain('9:12:20 AM');
    expect(field('Orden', 'Placed from IP')).toBe('200.1.2.3');
    expect(field('Orden', 'Purchased From')).toBe('Main Website / Chile / Chile Default Store View');
    expect(field('Cliente', 'Customer Name')).toBe('Susana Alvarez Perez');
    expect(field('Cliente', 'Email')).toBe('susana@example.com');
  });

  it('trae las direcciones completas (lo que el grid enmascara)', () => {
    expect(field('Direccion', 'Billing Address')).toBe(
      'Susana Alvarez / Av. Siempre Viva 742, Depto 31 / Providencia, Region Metropolitana / T: +56912345678',
    );
    expect(field('Direccion', 'Shipping Address')).toContain('Av. Siempre Viva 742');
  });

  it('lee el bloque de pago y el metodo de envio', () => {
    expect(field('Pago', 'Metodo')).toBe('Tarjeta de credito - Mercado Pago');
    expect(field('Pago', 'Payment id (Mercado Pago):')).toBe('178904668430');
    expect(field('Pago', 'Installments:')).toBe('12');
    expect(field('Envio', 'Shipping & Handling Information')).toBe('Item ID 1 - Entrega agendada');
  });

  it('lee los totales, cuya etiqueta incluye el nombre de la promocion', () => {
    expect(field('Totales', 'Grand Total')).toBe('$588,565.00');
    expect(field('Totales', 'Discount (LGSANTANDER10 - 10%)')).toBe('-$65,396.00');
    expect(field('Totales', 'Subtotal (Price source: ERP)')).toBe('$653,961.00');
  });

  it('lee un item por tbody, casando las columnas con el thead', () => {
    expect(detail.items).toHaveLength(2);
    expect(detail.items[0].Model).toBe('86MRGB95BSA.AWH');
    expect(detail.items[0].Qty).toBe('Ordered 1 / Invoiced 1');
    expect(detail.items[0]['Warehouse Code']).toBe('CL01');
    expect(detail.items[0]['Estimated Delivery Date']).toBe('16-09-2026');
    expect(detail.items[1].Model).toBe('OTRO.SKU');
  });

  it('lee el historial y decodifica la nota de la pasarela', () => {
    expect(detail.notes).toHaveLength(2);
    expect(detail.notes[0].noteStatus).toBe('Processing');
    expect(detail.transactions).toHaveLength(1);
    expect(detail.transactions[0].gateway).toBe('webpay');
    expect(readField(detail.transactions[0], ['codigo de autorizacion'])).toBe('464143');
    expect(readField(detail.transactions[0], ['estado'])).toBe('AUTHORIZED');
  });

  it('lee Full In House y el log del ERP', () => {
    expect(field('In House', 'Require Invoice')).toBe('Yes');
    expect(field('ERP', 'Status')).toBe('success');
    expect(field('ERP', 'Action Type')).toBe('order');
  });

  it('respeta las secciones apagadas', () => {
    const solo = parse(FICHA, expandSections({ info: true, payment: false, history: false, logs: false }));
    expect(solo.fields.some((f) => f.section === 'Pago')).toBe(false);
    expect(solo.fields.some((f) => f.section === 'ERP')).toBe(false);
    expect(solo.notes).toHaveLength(0);
    expect(solo.fields.some((f) => f.section === 'Cliente')).toBe(true);
    // Los items van siempre: son el cuerpo de la orden.
    expect(solo.items).toHaveLength(2);
  });
});

describe('fichas que no tienen todo', () => {
  it('marketplace: sin IP y con un bloque de pago sin tabla', () => {
    const detail = parse(FICHA_MARKETPLACE);
    expect(detail.orderNumber).toBe('123001427216');
    expect(detail.fields.some((f) => f.label === 'Placed from IP')).toBe(false);
    // El titulo se emite igual aunque no haya filas: si no, la orden quedaria
    // sin ninguna senal de como se pago.
    expect(detail.fields.find((f) => f.section === 'Pago')?.value).toBe('Marketplace Payment - ecommPay');
    expect(detail.items).toHaveLength(1);
  });

  it('un HTML que no es una ficha no revienta', () => {
    const detail = parse('<html><body><h1>Access Denied</h1></body></html>');
    expect(detail.orderNumber).toBe('');
    expect(detail.fields).toEqual([]);
    expect(detail.items).toEqual([]);
    expect(detail.notes).toEqual([]);
  });
});

describe('el CSV que sale de la ficha', () => {
  const item = {
    increment_id: '123001427905',
    entity_id: '35732098',
    created_at: '2026-09-14 13:12:20',
    status: 'picking_for_delivery',
    base_grand_total: '$588,565.00',
    payment_method: 'mercadopago_global_credit_card',
    additional_information: JSON.stringify({
      paymentResponse: {
        id: 178904668430,
        status: 'approved',
        authorization_code: '307840',
        payment_method_id: 'master',
        installments: 12,
        card: { last_four_digits: '4805' },
      },
    }),
  };
  const href = 'https://shop.lg.com/obsadm/sales/order/view/order_id/35732098/key/abc/';
  const record = buildRecord({ item, detail: parse(FICHA), viewHref: href });

  it('pone la orden primero y el enlace en su columna', () => {
    const { headers, rows } = buildMatrix([record]);
    expect(headers[0]).toBe('Orden');
    expect(rows[0][0]).toBe('123001427905');
    expect(rows[0][headers.indexOf('URL')]).toBe(href);
    expect(rows[0][headers.indexOf('Estado (ficha)')]).toBe('Picking for Delivery');
  });

  it('crea una columna por cada campo de la ficha', () => {
    const { headers, rows } = buildMatrix([record]);
    expect(headers).toContain('Cliente - Customer Name');
    expect(headers).toContain('Direccion - Billing Address');
    expect(headers).toContain('Totales - Grand Total');
    expect(rows[0][headers.indexOf('Cliente - Customer Name')]).toBe('Susana Alvarez Perez');
    expect(rows[0][headers.indexOf('Totales - Grand Total')]).toBe('$588,565.00');
  });

  it('resume los items en una sola fila', () => {
    const { headers, rows } = buildMatrix([record]);
    expect(rows[0][headers.indexOf('Items')]).toBe('2');
    expect(rows[0][headers.indexOf('Item - SKU')]).toBe('86MRGB95BSA.AWH | OTRO.SKU');
    expect(rows[0][headers.indexOf('Item - Bodega')]).toBe('CL01 | CL02');
    // El item sin tracking no corre la columna del otro.
    expect(rows[0][headers.indexOf('Item - Tracking')]).toBe('TRK-1');
  });

  it('resume el historial y suma el pago del grid', () => {
    const { headers, rows } = buildMatrix([record]);
    expect(rows[0][headers.indexOf('Notas')]).toBe('2');
    expect(rows[0][headers.indexOf('Historial')]).toContain('AUTHORIZED');
    expect(rows[0][headers.indexOf('Codigo autorizacion')]).toBe('307840');
    expect(rows[0][headers.indexOf('Ultimos 4')]).toBe('4805');
  });

  it('dos ordenes con campos distintos no se corren de columna', () => {
    const otro = buildRecord({ item: { increment_id: '123001427216' }, detail: parse(FICHA_MARKETPLACE) });
    const { headers, rows } = buildMatrix([record, otro]);
    expect(rows[0]).toHaveLength(headers.length);
    expect(rows[1]).toHaveLength(headers.length);
    // La orden de marketplace no tiene IP: su celda queda vacia, no desplazada.
    expect(rows[1][headers.indexOf('Orden - Placed from IP')]).toBe('');
    expect(rows[1][headers.indexOf('Orden - Order Status')]).toBe('Delivery Completed');
    expect(rows[1][0]).toBe('123001427216');
  });

  it('una ficha que fallo sale igual, con el motivo', () => {
    const fallida = makeMissingRecord('123001427999', { status: 'error', error: 'La ficha respondio 500.' });
    const { headers, rows } = buildMatrix([record, fallida]);
    expect(rows[1][0]).toBe('123001427999');
    expect(rows[1][headers.length - 2]).toBe('Error');
    expect(rows[1][headers.length - 1]).toBe('La ficha respondio 500.');
  });
});
