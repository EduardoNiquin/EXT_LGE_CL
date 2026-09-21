// Capa pura de "Facturas": del Invoice Master File al plan de carga. El fixture
// es la factura de Mercado Pago 2943361 tal como se cargo a mano el 2026-09-15
// (docs/features/facturas-flujo-gevs.md): los numeros esperados son los que
// quedaron en GEVS. La nota de credito se prueba con el mismo fixture en
// negativo, que es como la trae el Excel de Finanzas (todo con el signo cambiado).

import { describe, expect, it } from 'vitest';
import { leerMapa, leerMaster1, leerMaster2, normalizar } from '../../src/features/facturas/reglas/hojas.js';
import { agruparDocumentos } from '../../src/features/facturas/reglas/agrupar.js';
import { armarReceta } from '../../src/features/facturas/reglas/receta.js';
import { calcularMontos, redondear } from '../../src/features/facturas/reglas/calculo.js';
import { armarDescripcion, fechaGevs, mesDeImpactMonth } from '../../src/features/facturas/reglas/descripcion.js';
import { evaluarElegibilidad } from '../../src/features/facturas/reglas/validar.js';
import { armarPlan, emparejarAdjuntos } from '../../src/features/facturas/reglas/plan.js';

const FECHA_MP = new Date(2026, 7, 25);

const NETOS_MP = [
  ['Refrigeration', 'CNT', 1508792.3878151153],
  ['Cooking', 'CVT', 549.6401311587051],
  ['Dishwasher', 'CDT', 64184.81988863551],
  ['WM', 'DFT', 3153038.821222038],
  ['VCC', 'DVT', 0],
  ['Television', 'GLT', 1999164.7574092748],
  ['Audio', 'PNT', 159502.40841765926],
  ['Monitor', 'GTT', 211100.50968184744],
  ['RAC', 'DGT', 151982.73567036],
  ['Air Cleaner', 'DLT', 7226.919763911649],
  ['SAC', 'DMT', 0],
];

// Layout de Master 1 desde 2026-09: "Doc Type" al principio y las columnas
// "INVOICE ROUND AMOUNT" / "INVOICE ROUND VAT" (el ROUND de Finanzas).
const ENCABEZADO_MASTER1 = [
  'Doc Type', 'Year', 'Cut Date', 'Invoice Received', 'Impact Month', 'Invoice Registered', 'Invoice Date',
  'Invoice Number', 'Customer', 'OBS/3P', 'BU', 'Division', 'Invoice Net Amt (CLP)', 'VAT (CLP)', 'Total Amt (CLP)',
  'INVOICE ROUND AMOUNT', 'INVOICE ROUND VAT', 'Commission Type', 'Invoice Status', 'Invoice URL',
];
const COL = Object.fromEntries(ENCABEZADO_MASTER1.map((h, i) => [h, i]));

function filaMaster1({
  division, bu, neto, vat = 0, total = null, roundVat = null, status = 'Pending', numero = 2943361, url = null,
  customer = 'MERCADO PAGO', docType = 'Invoice', redondeado = redondear(neto),
}) {
  return [docType, 2026, 'JUL 26 to AUG 25', 'AUG', 'AUG (Provision)', 'Pending', FECHA_MP, numero, customer, 'OBS', bu, division,
    neto, vat, total ?? neto * 1.19, redondeado, roundVat, 'Monthly Commission', status, url];
}

/** `signo: -1` deja el fixture como nota de credito (sin -0: Excel tampoco los tiene). */
function matrizMaster1({ signo = 1, ...opciones } = {}) {
  const con = (n) => (n === 0 ? 0 : n * signo);
  return [
    [null, null], // filas de titulo antes del encabezado, como en el archivo real
    [null, 'Incluir al final toda la info de Map2'],
    ENCABEZADO_MASTER1,
    ...NETOS_MP.map(([division, bu, neto]) => filaMaster1({ division, bu, neto: con(neto), ...opciones })),
    filaMaster1({
      division: 'TOTAL', bu: 'TOTAL', neto: con(7255543), vat: con(1378553.17), total: con(8634096.17), roundVat: con(1378553),
      url: '2026-08-BILL-MercadoPago (2).pdf', ...opciones,
    }),
  ];
}

const MATRIZ_MASTER2 = [
  ['STEPS', 1, 2, 3],
  [null, 'Payee', 'Doc No', 'Doc Type', 'System Module', 'Invoice Type', 'Invoice No', 'Date', 'Payee Code',
    'Total Amount in Invoice Detail', 'Description (F/CN-123 + title + MMYY)', 'Expense', 'TAX', 'Credit-Account',
    'Debit-Department', 'Manual BU', 'Button of "Add"', 'TAX_CODE column', 'VAT Tax Code', 'Debit-Account'],
  [null, 'MERCADO PAGO', 33, 'Invoice', 'Complex voucher', 'Vendor Invoice (CHL)', 'Find', 'Select', 'CL005108', null,
    'PG Commission MERCADO PAGO, 1.0%-2.3% - ', null, null, 21117701, 20148, null, null, null, 'CLIDD19', 51357755],
  [null, 'MERCADO PAGO', 61, 'Credit Note', 'Complex voucher', 'Vendor Invoice (CHL)', 'Find', 'Select', 'CL005108', null,
    'PG Commission MERCADO PAGO, 1.0%-2.3% - ', null, null, 21117701, 20148, null, null, null, 'CLIDD19', 51357755],
  [null, 'OMS SOPTEC LG.com Variable Commission', 33, 'Invoice', 'Commission & Charge_Others', 'Vendor Invoice (CHL)', 'Find',
    'Select', 'CL004879', 'Paste', 'Commission Variable OMS -', 'Others', 'VAT', null, 20148, null, null, null, null, 51357755],
];

const MATRIZ_MAP = [
  ['Copy'],
  [2026, null, null, null, null, 'Customer', 'OBS/3P', 'Variable/Fixed', 'Department Code', 'Payee Code', 'Debit Account'],
  [null, null, 'BU', 'GBU', null, '3P Marketplace (Common)', '3P', null, 20167, null, 51357755],
  [null, null, 'Refrigeration', 'CNT', null, 'MERCADO PAGO', 'OBS', 'Variable', 20148, 'CL005108', 51357755],
  [null, null, 'Cooking', 'CVT', null, 'TRANSBANK', 'OBS', 'Variable', 20148, 'CL003010', 51357755],
];

function documentoMp(opciones) {
  return agruparDocumentos(leerMaster1(matrizMaster1(opciones)))[0];
}

function recetaMp(docType = 'invoice') {
  return armarReceta({ master2: leerMaster2(MATRIZ_MASTER2), mapa: leerMapa(MATRIZ_MAP), customer: 'MERCADO PAGO', docType });
}

const ADJUNTOS = [
  { id: 'a1', nombre: 'F 2943361- Mercado Pago Commission - August 2026.pdf', tipo: 'application/pdf' },
  { id: 'a2', nombre: 'Reporte_Facturacion_MercadoPago_Ago2026 (1).xlsx', tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { id: 'a3', nombre: 'otra cosa.pdf', tipo: 'application/pdf' },
];

describe('hojas', () => {
  it('ubica el encabezado de Master 1 por contenido y normaliza las filas', () => {
    const filas = leerMaster1(matrizMaster1());
    expect(filas).toHaveLength(12);
    expect(filas[0]).toMatchObject({
      year: 2026, customer: 'MERCADO PAGO', bu: 'CNT', division: 'Refrigeration', invoiceNumber: '2943361',
      docType: 'invoice', status: 'pending', impactMonth: 'AUG (Provision)', redondeadoClp: 1508792,
    });
    expect(filas[0].invoiceDate).toBe('2026-08-25');
    expect(filas[11].invoiceUrl).toBe('2026-08-BILL-MercadoPago (2).pdf');
  });

  it('deja el numero como string y la fecha invalida como texto', () => {
    const matriz = matrizMaster1();
    matriz[3][COL['Invoice Date']] = 'sep';
    matriz[3][COL['Invoice Number']] = null;
    const [fila] = leerMaster1(matriz);
    expect(fila.invoiceDate).toBe('sep');
    expect(fila.invoiceNumber).toBe('');
  });

  it('lee un archivo viejo (sin las columnas ROUND ni Doc Type al principio) dejando el redondeo en null', () => {
    const sinColumnas = matrizMaster1().map((fila) => {
      const sin = fila.filter((_, i) => i !== COL['INVOICE ROUND AMOUNT'] && i !== COL['INVOICE ROUND VAT']);
      return sin.length > 2 ? [...sin.slice(1), sin[0]] : sin; // Doc Type al final, como antes
    });
    const [fila] = leerMaster1(sinColumnas);
    expect(fila).toMatchObject({ customer: 'MERCADO PAGO', docType: 'invoice', netoClp: NETOS_MP[0][2], redondeadoClp: null });
  });

  it('lee Master 2 y Map', () => {
    const recetas = leerMaster2(MATRIZ_MASTER2);
    expect(recetas).toHaveLength(3);
    expect(recetas[0]).toMatchObject({ customer: 'MERCADO PAGO', docType: 'invoice', systemModule: 'complex voucher', vatCode: 'CLIDD19', creditAccount: '21117701', debitAccount: '51357755' });
    expect(leerMapa(MATRIZ_MAP)).toEqual([
      { customer: '3P Marketplace (Common)', department: '20167', payeeCode: '', debitAccount: '51357755' },
      { customer: 'MERCADO PAGO', department: '20148', payeeCode: 'CL005108', debitAccount: '51357755' },
      { customer: 'TRANSBANK', department: '20148', payeeCode: 'CL003010', debitAccount: '51357755' },
    ]);
  });

  it('normaliza sin acentos ni espacios dobles', () => {
    expect(normalizar('  Invoice   Número ')).toBe('invoice numero');
  });
});

describe('agrupar', () => {
  it('convierte las 12 filas en un documento con 11 lineas y su total', () => {
    const doc = documentoMp();
    expect(doc.lineas).toHaveLength(11);
    expect(doc.lineas.map((l) => l.bu)).toEqual(['CNT', 'CVT', 'CDT', 'DFT', 'DVT', 'GLT', 'PNT', 'GTT', 'DGT', 'DLT', 'DMT']);
    expect(doc.lineas[0]).toEqual({ bu: 'CNT', division: 'Refrigeration', neto: NETOS_MP[0][2], redondeado: 1508792 });
    expect(doc.total).toEqual({ neto: 7255543, vat: 1378553.17, total: 8634096.17 });
    expect(doc.invoiceUrl).toBe('2026-08-BILL-MercadoPago (2).pdf');
    expect(doc.filas).toBe(12);
  });

  it('separa facturas por cliente + numero + fecha + corte + tipo', () => {
    const matriz = matrizMaster1();
    const otra = matrizMaster1({ numero: 2864715 }).slice(3);
    const docs = agruparDocumentos(leerMaster1([...matriz, ...otra]));
    expect(docs.map((d) => d.invoiceNumber)).toEqual(['2943361', '2864715']);
  });

  it('marca ambiguo cuando una BU se repite con otro monto', () => {
    const matriz = matrizMaster1();
    matriz.push(filaMaster1({ division: 'Refrigeration', bu: 'CNT', neto: 1 }));
    expect(agruparDocumentos(leerMaster1(matriz))[0].ambiguo).toBe(true);
  });
});

describe('receta', () => {
  it('toma los codigos de Map y el resto de Master 2', () => {
    const { receta, avisos } = recetaMp();
    expect(avisos).toEqual([]);
    expect(receta).toEqual({
      customer: 'MERCADO PAGO', docType: 'invoice', systemModule: 'complex voucher', invoiceTypeId: '55001',
      payeeCode: 'CL005108', debitDepartment: '20148', debitAccount: '51357755', creditAccount: '21117701',
      vatCode: 'CLIDD19', titulo: 'PG Commission MERCADO PAGO, 1.0%-2.3%',
    });
  });

  it('avisa cuando Map y Master 2 no coinciden y gana Map', () => {
    const mapa = leerMapa(MATRIZ_MAP).map((c) => (c.customer === 'MERCADO PAGO' ? { ...c, department: '20999' } : c));
    const { receta, avisos } = armarReceta({ master2: leerMaster2(MATRIZ_MASTER2), mapa, customer: 'MERCADO PAGO', docType: 'invoice' });
    expect(receta.debitDepartment).toBe('20999');
    expect(avisos).toEqual(['Department: Map dice 20999 y Master 2 dice 20148; se usa Map.']);
  });

  it('devuelve null si el cliente no tiene fila en Master 2', () => {
    expect(armarReceta({ master2: [], mapa: [], customer: 'NADIE', docType: 'invoice' }).receta).toBeNull();
  });
});

describe('calculo', () => {
  it('redondea como ROUND de Excel (mitades lejos de cero)', () => {
    expect(redondear(159502.41)).toBe(159502);
    expect(redondear(549.64)).toBe(550);
    expect(redondear(2.5)).toBe(3);
    expect(redondear(-2.5)).toBe(-3);
    expect(redondear(0)).toBe(0);
  });

  it('reproduce la hoja Round para la factura de Mercado Pago', () => {
    const montos = calcularMontos(documentoMp().lineas);
    expect(montos.filas.map((f) => [f.gbu, f.monto])).toEqual([
      ['DIV:CNT', 1508792], ['DIV:CVT', 550], ['DIV:CDT', 64185], ['DIV:DFT', 3153039], ['DIV:GLT', 1999165],
      ['DIV:PNT', 159502], ['DIV:GTT', 211101], ['DIV:DGT', 151983], ['DIV:DLT', 7227],
    ]);
    expect(montos).toMatchObject({ net: 7255544, iva: 1378553, credit: 8634097, n: 10 });
  });

  it('en negativo (nota de credito) todo queda negativo y cuadra', () => {
    const montos = calcularMontos([{ bu: 'CNT', neto: -100.5 }, { bu: 'GLT', neto: -0.2 }]);
    expect(montos).toMatchObject({ net: -101, iva: -19, credit: -120, n: 2 });
  });
});

describe('descripcion', () => {
  it('arma la Description como se cargo en GEVS', () => {
    expect(armarDescripcion({ docType: 'invoice', invoiceNumber: '2943361', titulo: 'PG Commission MERCADO PAGO, 1.0%-2.3%', impactMonth: 'AUG (Provision)', year: 2026 }))
      .toBe('F 2943361 - PG Commission MERCADO PAGO, 1.0%-2.3% - August 2026');
    expect(armarDescripcion({ docType: 'credit note', invoiceNumber: '10', titulo: 'T', impactMonth: 'SEP (Ingresar )', year: 2026 }))
      .toBe('CN 10 - T - September 2026');
  });

  it('devuelve vacio si falta cualquier pieza o el tipo no tiene prefijo', () => {
    expect(armarDescripcion({ docType: 'invoice', invoiceNumber: '', titulo: 'T', impactMonth: 'AUG', year: 2026 })).toBe('');
    expect(armarDescripcion({ docType: 'invoice', invoiceNumber: '1', titulo: 'T', impactMonth: 'XYZ', year: 2026 })).toBe('');
    expect(armarDescripcion({ docType: 'debit note', invoiceNumber: '1', titulo: 'T', impactMonth: 'AUG', year: 2026 })).toBe('');
    expect(mesDeImpactMonth('jul (Provision)')).toBe('July');
  });

  it('formatea fechas como dd/MM/yyyy', () => {
    expect(fechaGevs('2026-08-25')).toBe('25/08/2026');
    expect(fechaGevs('sep')).toBe('');
    expect(fechaGevs('')).toBe('');
  });
});

describe('validar', () => {
  it('acepta una Pending completa con receta Complex voucher', () => {
    expect(evaluarElegibilidad(documentoMp(), recetaMp().receta)).toEqual({ elegible: true, motivos: [] });
  });

  it('acepta una nota de credito con todo en negativo', () => {
    const doc = documentoMp({ docType: 'Credit Note', signo: -1 });
    expect(doc.docType).toBe('credit note');
    expect(evaluarElegibilidad(doc, recetaMp('credit note').receta)).toEqual({ elegible: true, motivos: [] });
  });

  it('explica cada motivo de rechazo', () => {
    const { receta } = recetaMp();
    expect(evaluarElegibilidad(documentoMp({ status: 'Approving' }), receta).motivos).toEqual(['ya registrada en GEVS (Approving)']);
    expect(evaluarElegibilidad(documentoMp({ status: 'Draft' }), receta).motivos[0]).toMatch(/Draft/);
    expect(evaluarElegibilidad(documentoMp({ numero: null }), receta).motivos).toEqual(['sin numero de factura']);
    expect(evaluarElegibilidad(documentoMp(), null).motivos).toEqual(['sin receta para este cliente']);
    const otroModulo = { ...receta, systemModule: 'itms' };
    expect(evaluarElegibilidad(documentoMp(), otroModulo).motivos).toEqual(['va por "itms", no por Complex Voucher']);
  });

  it('rechaza el signo cambiado y los tipos de documento sin soporte', () => {
    expect(evaluarElegibilidad(documentoMp({ docType: 'Credit Note' }), recetaMp('credit note').receta).motivos)
      .toEqual(['montos con el signo cambiado: una nota de credito lleva todo en negativo']);
    expect(evaluarElegibilidad(documentoMp({ signo: -1 }), recetaMp().receta).motivos)
      .toEqual(['montos con el signo cambiado: una factura lleva todo en positivo']);
    expect(evaluarElegibilidad(documentoMp({ docType: 'Debit Note' }), recetaMp().receta).motivos)
      .toEqual(['tipo de documento "debit note" no soportado']);
  });
});

describe('plan', () => {
  it('empareja la factura por numero y el detalle por ser el unico de su tipo', () => {
    const doc = documentoMp();
    const porRol = emparejarAdjuntos(ADJUNTOS, doc);
    expect(porRol.factura.id).toBe('a1');
    expect(porRol.detalle.id).toBe('a2');
  });

  it('no adivina cuando hay varios candidatos, salvo que uno lleve el numero', () => {
    const doc = documentoMp();
    const dosPdf = emparejarAdjuntos([ADJUNTOS[2], { id: 'a4', nombre: 'otro.pdf' }], doc);
    expect(dosPdf.factura).toBeNull();
    const dosXlsx = emparejarAdjuntos([ADJUNTOS[1], { id: 'a5', nombre: 'detalle 2943361.xlsb' }], doc);
    expect(dosXlsx.detalle.id).toBe('a5');
  });

  it('un rol asignado a mano manda sobre el nombre', () => {
    const manual = emparejarAdjuntos([{ id: 'x', nombre: 'sin numero.pdf', rol: 'factura' }], documentoMp());
    expect(manual.factura.id).toBe('x');
    expect(manual.detalle).toBeNull();
  });

  it('arma el plan exacto de la factura de Mercado Pago', () => {
    const plan = armarPlan({ documento: documentoMp(), receta: recetaMp().receta, adjuntos: ADJUNTOS });
    expect(plan.errores).toEqual([]);
    expect(plan.avisos).toEqual([]);
    expect(plan.docType).toBe('invoice');
    expect(plan.cabecera).toEqual({
      invoiceTypeId: '55001', invoiceNo: '2943361', invoiceDate: '25/08/2026', payeeCode: 'CL005108',
      description: 'F 2943361 - PG Commission MERCADO PAGO, 1.0%-2.3% - August 2026',
    });
    expect(plan.credito).toEqual({ account: '21117701', amount: 8634097 });
    expect(plan.debito.department).toBe('20148');
    expect(plan.debito.account).toBe('51357755');
    expect(plan.debito.filas).toHaveLength(9);
    expect(plan.debito.filas[0]).toEqual({ bu: 'CNT', division: 'Refrigeration', gbu: 'DIV:CNT', amount: 1508792 });
    expect(plan.debito.iva).toEqual({ lineType: 'VAT', taxCode: 'CLIDD19', amount: 1378553, account: '11330101' });
    expect(plan.dff).toEqual({ issueDate: '25/08/2026', supplyPrice: 7255544, originalTaxAmount: 1378553, supplier: 'CL005108', taxRateCode: 'CLIDD19' });
    expect(plan.adjuntos.map((a) => [a.rol, a.id])).toEqual([['factura', 'a1'], ['detalle', 'a2']]);
    expect(plan.resumen).toMatchObject({ net: 7255544, iva: 1378553, credit: 8634097, filasDebit: 10, totalMaster1: 8634096.17 });
    expect(plan.resumen.diferencia).toBeCloseTo(0.83, 2);
  });

  it('arma el plan de una nota de credito: prefijo CN y todo en negativo, misma pantalla', () => {
    const plan = armarPlan({ documento: documentoMp({ docType: 'Credit Note', signo: -1 }), receta: recetaMp('credit note').receta, adjuntos: ADJUNTOS });
    expect(plan.errores).toEqual([]);
    expect(plan.avisos).toEqual([]);
    expect(plan.docType).toBe('credit note');
    expect(plan.cabecera).toMatchObject({ invoiceTypeId: '55001', payeeCode: 'CL005108', description: 'CN 2943361 - PG Commission MERCADO PAGO, 1.0%-2.3% - August 2026' });
    expect(plan.credito).toEqual({ account: '21117701', amount: -8634097 });
    expect(plan.debito.filas.map((f) => f.amount)).toEqual([-1508792, -550, -64185, -3153039, -1999165, -159502, -211101, -151983, -7227]);
    expect(plan.debito.iva).toEqual({ lineType: 'VAT', taxCode: 'CLIDD19', amount: -1378553, account: '11330101' });
    expect(plan.dff).toMatchObject({ supplyPrice: -7255544, originalTaxAmount: -1378553, supplier: 'CL005108', taxRateCode: 'CLIDD19' });
    expect(plan.resumen).toMatchObject({ net: -7255544, iva: -1378553, credit: -8634097, filasDebit: 10, totalMaster1: -8634096.17 });
  });

  it('marca errores cuando faltan adjuntos o la fecha no sirve', () => {
    const plan = armarPlan({ documento: { ...documentoMp(), invoiceDate: 'sep' }, receta: recetaMp().receta, adjuntos: [] });
    expect(plan.errores).toEqual(['La fecha de factura no es valida.', 'Falta el adjunto "factura".', 'Falta el adjunto "detalle".']);
  });

  it('no deja cargar si el ROUND de Finanzas no coincide con el calculado', () => {
    const matriz = matrizMaster1();
    matriz[3][COL['INVOICE ROUND AMOUNT']] = 1508793; // CNT ajustada a mano (o Excel sin recalcular)
    const documento = agruparDocumentos(leerMaster1(matriz))[0];
    const plan = armarPlan({ documento, receta: recetaMp().receta, adjuntos: ADJUNTOS });
    expect(plan.errores).toEqual(['INVOICE ROUND AMOUNT de Master 1 no coincide con el redondeo calculado en CNT (Excel 1508793, calculado 1508792): revisa el Excel.']);
  });

  it('avisa si el credito se aleja mas de 1 CLP del total de Master 1', () => {
    const doc = documentoMp();
    doc.total = { ...doc.total, total: 8634000 };
    const plan = armarPlan({ documento: doc, receta: recetaMp().receta, adjuntos: ADJUNTOS });
    expect(plan.avisos).toHaveLength(1);
    expect(plan.avisos[0]).toMatch(/difiere del Total Amt/);
  });
});
