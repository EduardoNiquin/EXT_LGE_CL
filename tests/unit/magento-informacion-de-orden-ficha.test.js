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
import { mainContentOf, parseOrderDetail } from '../../src/features/magento/informacion_de_orden/detail-parse.js';
import { buildMatrix, buildRecord, makeMissingRecord } from '../../src/features/magento/informacion_de_orden/csv.js';
import { DEFAULT_SECTIONS, ESSENTIAL_COLUMNS, expandSections } from '../../src/features/magento/informacion_de_orden/constants.js';
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
    <th>Global Shipping Info</th>
  </tr></thead>
  <tbody class="even">
    <tr>
      <td>$453,981.00</td><td>Ordered 1<br>Invoiced 1</td><td>$453,981.00</td>
      <td><b>86MRGB95BSA.AWH</b></td><td>Picking</td><td>CL01</td><td>TRK-1</td><td>16-09-2026</td>
      <td>Rule Name: Envio Normal RM + Pack OMO Expected delivery date: N/A Installation Service: Si</td>
    </tr>
    <tr><td colspan="9">subfila de cantidades</td></tr>
  </tbody>
  <tbody class="odd">
    <tr>
      <td>$99,990.00</td><td>Ordered 2</td><td>$199,980.00</td>
      <td><b>OTRO.SKU</b></td><td>Pending</td><td>CL02</td><td></td><td>18-09-2026</td>
      <td>N/A</td>
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
    // El rotulo de la seccion se unifica: la columna es la misma vengan los
    // datos en tabla o como texto suelto.
    expect(field('Envio', 'Metodo de envio')).toBe('Item ID 1 - Entrega agendada');
  });

  it('lee los totales, cuya etiqueta incluye el nombre de la promocion', () => {
    // El parser entrega el texto de la ficha; el CSV es el que lo normaliza.
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

// Las pruebas de abajo miran la union completa de columnas; el perfil corto
// (ESSENTIAL_COLUMNS) tiene su propio describe al final.
const TODO = { allColumns: true };

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
    const { headers, rows } = buildMatrix([record], TODO);
    expect(headers[0]).toBe('Orden');
    expect(rows[0][0]).toBe('123001427905');
    expect(rows[0][headers.indexOf('URL')]).toBe(href);
    expect(rows[0][headers.indexOf('Estado (ficha)')]).toBe('Picking for Delivery');
  });

  it('crea una columna por cada campo de la ficha', () => {
    const { headers, rows } = buildMatrix([record], TODO);
    expect(headers).toContain('Cliente - Customer Name');
    expect(headers).toContain('Direccion - Billing Address');
    expect(headers).toContain('Totales - Grand Total');
    expect(rows[0][headers.indexOf('Cliente - Customer Name')]).toBe('Susana Alvarez Perez');
    expect(rows[0][headers.indexOf('Totales - Grand Total')]).toBe('588565.00');
  });

  it('los items de una orden con varios productos van como JSON alineado', () => {
    const { headers, rows } = buildMatrix([record], TODO);
    expect(rows[0][headers.indexOf('Items')]).toBe('2');
    expect(rows[0][headers.indexOf('Item - SKU')]).toBe('["86MRGB95BSA.AWH","OTRO.SKU"]');
    expect(rows[0][headers.indexOf('Item - Bodega')]).toBe('["CL01","CL02"]');
    expect(rows[0][headers.indexOf('Item - Precio')]).toBe('[453981,99990]');
    // El item sin tracking deja su hueco: la posicion sigue siendo la del item.
    expect(rows[0][headers.indexOf('Item - Tracking')]).toBe('["TRK-1",null]');
  });

  it('con un solo item la celda no se envuelve en un array', () => {
    const uno = buildRecord({ item: { increment_id: '1' }, detail: parse(FICHA_MARKETPLACE) });
    const { headers, rows } = buildMatrix([uno], TODO);
    expect(rows[0][headers.indexOf('Items')]).toBe('1');
    expect(rows[0][headers.indexOf('Item - SKU')]).toBe('SKU.MKT');
  });

  it('el historial va como JSON y el pago sale del grid', () => {
    const { headers, rows } = buildMatrix([record], TODO);
    expect(rows[0][headers.indexOf('Notas')]).toBe('2');
    const historial = JSON.parse(rows[0][headers.indexOf('Historial')]);
    expect(historial).toHaveLength(2);
    // Fecha ordenable, y el comentario "Etiqueta: valor" abierto a objeto.
    expect(historial[0].fecha).toBe('2026-09-14 13:12:30');
    expect(historial[0].estado).toBe('Processing');
    expect(historial[0].comentario.Estado).toBe('AUTHORIZED');
    expect(historial[0].comentario.texto).toBe('Transaccion Aprobada');
    // El comentario que YA es JSON se anida en vez de quedar como texto.
    expect(historial[1].comentario).toEqual({ holded: 'picking_for_delivery', global: null });
    expect(rows[0][headers.indexOf('Codigo autorizacion')]).toBe('307840');
    expect(rows[0][headers.indexOf('Ultimos 4')]).toBe('4805');
  });

  it('dos ordenes con campos distintos no se corren de columna', () => {
    const otro = buildRecord({ item: { increment_id: '123001427216' }, detail: parse(FICHA_MARKETPLACE) });
    const { headers, rows } = buildMatrix([record, otro], TODO);
    expect(rows[0]).toHaveLength(headers.length);
    expect(rows[1]).toHaveLength(headers.length);
    // La orden de marketplace no tiene IP: su celda queda vacia, no desplazada.
    expect(rows[1][headers.indexOf('Orden - Placed from IP')]).toBe('');
    expect(rows[1][headers.indexOf('Orden - Order Status')]).toBe('Delivery Completed');
    expect(rows[1][0]).toBe('123001427216');
  });

  it('una ficha que fallo sale igual, con el motivo', () => {
    const fallida = makeMissingRecord('123001427999', { status: 'error', error: 'La ficha respondio 500.' });
    const { headers, rows } = buildMatrix([record, fallida], TODO);
    expect(rows[1][0]).toBe('123001427999');
    expect(rows[1][headers.length - 2]).toBe('Error');
    expect(rows[1][headers.length - 1]).toBe('La ficha respondio 500.');
  });
});

// El perfil corto: las columnas que se miran a diario, siempre las mismas y en
// el mismo orden aunque la corrida no las traiga todas.
describe('el perfil corto de columnas', () => {
  const item = {
    increment_id: '123001427905',
    payment_method: 'mercadopago_global_credit_card',
    additional_information: JSON.stringify({
      paymentResponse: { id: 178904668430, status: 'approved', installments: 12 },
    }),
  };
  const record = buildRecord({ item, detail: parse(FICHA) });

  it('emite ESSENTIAL_COLUMNS mas las de control, en ese orden', () => {
    const { headers, rows } = buildMatrix([record]);
    expect(headers).toEqual([...ESSENTIAL_COLUMNS, 'Estado captura', 'Error']);
    expect(rows[0]).toHaveLength(headers.length);
    expect(headers).not.toContain('Cliente - Customer Name');
    expect(headers).not.toContain('URL');
  });

  it('una columna que esta en la lista pero no en los datos sale vacia, no falta', () => {
    const { headers, rows } = buildMatrix([record]);
    const i = headers.indexOf('Pago - Statement Descriptor:');
    expect(i).toBeGreaterThan(-1);
    expect(rows[0][i]).toBe('');
  });

  it('los importes salen como numero plano', () => {
    const { headers, rows } = buildMatrix([record]);
    expect(rows[0][headers.indexOf('Totales - Grand Total')]).toBe('588565.00');
    expect(rows[0][headers.indexOf('Totales - Subtotal (Price source: ERP)')]).toBe('653961.00');
  });

  it('el bloque de envio de cada item se abre a objeto', () => {
    const { headers, rows } = buildMatrix([record]);
    const envio = JSON.parse(rows[0][headers.indexOf('Item - Envio')]);
    expect(envio[0]['Rule Name']).toBe('Envio Normal RM + Pack OMO');
    expect(envio[0]['Installation Service']).toBe('Si');
    // El item sin bloque conserva su texto, no se inventa un objeto.
    expect(envio[1]).toBe('N/A');
  });

  it('la fecha larga pasa a formato ordenable', () => {
    const { headers, rows } = buildMatrix([record]);
    expect(rows[0][headers.indexOf('Orden - Order Date (America/Santiago)')]).toBe('2026-09-14 09:12:20');
  });

  it('una ficha que fallo sigue diciendo por que', () => {
    const fallida = makeMissingRecord('123001427999', { status: 'error', error: 'La ficha respondio 500.' });
    const { headers, rows } = buildMatrix([fallida]);
    expect(rows[0][0]).toBe('123001427999');
    expect(rows[0][headers.length - 2]).toBe('Error');
    expect(rows[0][headers.length - 1]).toBe('La ficha respondio 500.');
  });
});

describe('recorte del HTML al contenido principal', () => {
  it('se queda con <main id="anchor-content"> y deja fuera el menu del admin', () => {
    const menu = '<li>menu</li>'.repeat(50);
    const html = `<html><body><nav class="admin__menu">${menu}</nav>
      <main id="anchor-content" class="page-content">${FICHA}</main>
      <footer>pie</footer><script>var x = 1;</script></body></html>`;
    const trimmed = mainContentOf(html);
    expect(trimmed.startsWith('<main')).toBe(true);
    expect(trimmed.endsWith('</main>')).toBe(true);
    expect(trimmed).not.toContain('admin__menu');
    expect(trimmed).not.toContain('<footer>');
    // Lo que importa sigue ahi y se parsea igual que entero.
    expect(parse(trimmed).orderNumber).toBe('123001427905');
    expect(parse(trimmed).fields.length).toBe(parse(html).fields.length);
  });

  it('sin el marcador devuelve el HTML entero (login, otro layout)', () => {
    const login = '<html><body><div class="login-container">Sign in</div></body></html>';
    expect(mainContentOf(login)).toBe(login);
    expect(mainContentOf('')).toBe('');
    expect(mainContentOf(null)).toBe('');
  });
});

describe('el log del ERP con el markup real (labels, no tabla)', () => {
  // Tal como lo sirve el admin (16-09-2026), embebido en la ficha.
  const LOGS_REALES = `
    <section class="admin__page-section gerp-export-log">
      <div class="gerp-export-log-item" style="margin: 0 0 5rem">
        <h3>ERP Export Log #8474172</h3>
        <label class="title">Action Type: </label> <span style="font-weight: bold">order</span> <br>
        <label class="title">Cust PO NO: </label> <span style="font-weight: bold">ORDER_123001428405</span> <br>
        <label class="title">Status: </label> <span class="export-success-status-detail">success</span> <br>
        <label class="title">Created At: </label> <span> Sep 15, 2026, 3:13:50 AM</span> <br>
        <label class="title">Request Body: </label> <span><textarea name="request_body" disabled>{ "header": { "SYSTEM_CODE": "OBS" } }</textarea></span>
      </div>
      <div class="gerp-export-log-item">
        <h3>ERP Export Log #8474200</h3>
        <label class="title">Action Type: </label> <span>cancel</span> <br>
        <label class="title">Status: </label> <span>fail</span> <br>
      </div>
    </section>
    <section class="admin__page-section osms-export-log">
      <h3 style="text-align: center">No Data Found</h3>
    </section>`;

  // La ficha de prueba trae su propio bloque ERP en tabla: se saca para probar el real.
  const SIN_TABLA = FICHA.replace(/<div class="gerp-export-log">[\s\S]*?<\/table>\s*<\/div>/, '');
  const detail = parse(`${SIN_TABLA}${LOGS_REALES}`);
  const field = (section, label) => detail.fields.find((f) => f.section === section && f.label === label)?.value;

  it('casa cada label con su valor, incluido el JSON del textarea', () => {
    expect(field('ERP', 'Log')).toBe('#8474172');
    expect(field('ERP', 'Action Type')).toBe('order');
    expect(field('ERP', 'Status')).toBe('success');
    expect(field('ERP', 'Created At')).toBe('Sep 15, 2026, 3:13:50 AM');
    expect(field('ERP', 'Request Body')).toBe('{ "header": { "SYSTEM_CODE": "OBS" } }');
  });

  it('un segundo envio al ERP no pisa al primero: va con sufijo', () => {
    expect(field('ERP', 'Log (2)')).toBe('#8474200');
    expect(field('ERP', 'Action Type (2)')).toBe('cancel');
    expect(field('ERP', 'Status (2)')).toBe('fail');
  });

  it('el OSMS sin datos dice que se miro y no habia nada', () => {
    expect(field('OSMS', 'Log')).toBe('No Data Found');
    expect(detail.logsEmbedded).toEqual({ erp: true, osms: true });
  });

  it('la ficha de prueba con tabla sigue leyendo el log por la tabla', () => {
    const conTabla = parse(FICHA);
    const erp = (label) => conTabla.fields.find((f) => f.section === 'ERP' && f.label === label)?.value;
    expect(erp('Status')).toBe('success');
    expect(conTabla.logsEmbedded.erp).toBe(true);
  });
});
