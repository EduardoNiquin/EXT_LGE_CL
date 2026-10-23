// Lectura del .xlsx real con SheetJS. El archivo tiene datos financieros y no
// se versiona (docs/features/Facturas/ esta en .gitignore): si no esta, el test
// se salta. La copia es la de 2026-09-21 (Doc Type al principio y columnas
// INVOICE ROUND AMOUNT / VAT); los numeros esperados de FALABELLA 494026 son
// los que la extension cargo en GEVS ese dia (registro-extension-2026-09-21_*.md).

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { leerMasterFile } from '../../src/features/facturas/reglas/excel.js';
import { agruparDocumentos } from '../../src/features/facturas/reglas/agrupar.js';
import { armarReceta } from '../../src/features/facturas/reglas/receta.js';
import { evaluarElegibilidad } from '../../src/features/facturas/reglas/validar.js';
import { armarPlan } from '../../src/features/facturas/reglas/plan.js';

const RUTA = new URL('../../docs/features/Facturas/Invoice Master File 260831-v2.xlsx', import.meta.url);
const hayArchivo = existsSync(RUTA);

describe.skipIf(!hayArchivo)('excel (Invoice Master File real)', () => {
  const buffer = hayArchivo ? readFileSync(RUTA) : null;
  const libro = hayArchivo ? leerMasterFile(new Uint8Array(buffer).buffer) : null;
  const docs = hayArchivo ? agruparDocumentos(libro.master1) : [];

  function planDe(customer, invoiceNumber, adjuntos) {
    const documento = docs.find((d) => d.customer === customer && d.invoiceNumber === invoiceNumber);
    const { receta } = armarReceta({ master2: libro.master2, mapa: libro.mapa, customer: documento.customer, docType: documento.docType });
    return { documento, receta, plan: armarPlan({ documento, receta, adjuntos }) };
  }

  it('ubica las tres hojas y lee sus filas', () => {
    expect(libro.master1).toHaveLength(624);
    expect(libro.master1[0]).toMatchObject({ docType: 'invoice', customer: 'FALABELLA (DIRECT)', bu: 'CNT', redondeadoClp: 24645503 });
    expect(libro.master2.length).toBeGreaterThanOrEqual(14);
    expect(libro.mapa.map((c) => c.customer)).toContain('MERCADO PAGO');
    expect(docs).toHaveLength(51);
  });

  it('arma el plan de MP 2943361 igual que la carga manual', () => {
    const { documento, plan } = planDe('MERCADO PAGO', '2943361', [
      { id: '1', nombre: 'F 2943361- Mercado Pago Commission - August 2026.pdf', tipo: 'application/pdf' },
      { id: '2', nombre: 'Reporte_Facturacion_MercadoPago_Ago2026 (1).xlsx', tipo: '' },
    ]);
    expect(documento.invoiceDate).toBe('2026-08-25');
    expect(plan.errores).toEqual([]);
    expect(plan.cabecera.invoiceDate).toBe('25/08/2026');
    expect(plan.cabecera.description).toBe('F 2943361 - PG Commission MERCADO PAGO, 1.0%-2.3% - August 2026');
    expect(plan.debito.filas.map((f) => f.amount)).toEqual([1508792, 550, 64185, 3153039, 1999165, 159502, 211101, 151983, 7227]);
    expect(plan.resumen).toMatchObject({ net: 7255544, iva: 1378553, credit: 8634097, filasDebit: 10 });
  });

  it('arma el plan de FALABELLA 494026 como la corrida real del 2026-09-21', () => {
    const { documento, receta, plan } = planDe('FALABELLA (DIRECT)', '494026', [
      { id: '1', nombre: 'F 494026 - FALABELLA Direct Commission - August 2026.pdf', tipo: 'application/pdf' },
      { id: '2', nombre: 'InvoiceReport_FACL-760146102-2026-07-21-2026-08-20 - August 2026.xlsb', tipo: '' },
    ]);
    expect(evaluarElegibilidad(documento, receta)).toEqual({ elegible: true, motivos: [] });
    expect(plan.errores).toEqual([]);
    expect(plan.cabecera).toMatchObject({
      invoiceNo: '494026', invoiceDate: '21/08/2026', payeeCode: 'CL004831',
      description: 'F 494026 - Commission 3P FALABELLA Direct (Integration May 2026), 10%-13% - August 2026',
    });
    expect(plan.debito.department).toBe('20168');
    expect(plan.debito.filas.map((f) => [f.gbu, f.amount])).toEqual([
      ['DIV:CNT', 39026564], ['DIV:CDT', 473161], ['DIV:DFT', 90612106], ['DIV:GLT', 57911327],
      ['DIV:PNT', 5584928], ['DIV:GTT', 8834892], ['DIV:DGT', 887074],
    ]);
    expect(plan.adjuntos.map((a) => a.rol)).toEqual(['factura', 'detalle']);
    expect(plan.resumen).toMatchObject({ net: 203330052, iva: 38632710, credit: 241962762, filasDebit: 8 });
  });

  it('arma el plan de la nota de credito FALABELLA 459689 con todo en negativo', () => {
    const { documento, receta, plan } = planDe('FALABELLA (DIRECT)', '459689', [
      { id: '1', nombre: 'CN 459689.pdf', tipo: 'application/pdf' },
      { id: '2', nombre: 'detalle.xlsx', tipo: '' },
    ]);
    expect(documento.docType).toBe('credit note');
    expect(evaluarElegibilidad(documento, receta)).toEqual({ elegible: true, motivos: [] });
    expect(plan.errores).toEqual([]);
    expect(plan.cabecera).toMatchObject({
      invoiceNo: '459689', invoiceDate: '21/08/2026', payeeCode: 'CL004831',
      description: 'CN 459689 - Commission 3P FALABELLA Direct (Integration May 2026), 10%-13% - August 2026',
    });
    expect(plan.debito.filas.map((f) => [f.gbu, f.amount])).toEqual([
      ['DIV:CNT', -15797376], ['DIV:CDT', -191528], ['DIV:DFT', -36678441], ['DIV:GLT', -23441649],
      ['DIV:PNT', -2260696], ['DIV:GTT', -3576234], ['DIV:DGT', -359074],
    ]);
    expect(plan.debito.iva.amount).toBe(-15637950);
    expect(plan.credito.amount).toBe(-97942948);
    expect(plan.dff).toMatchObject({ issueDate: '21/08/2026', supplyPrice: -82304998, originalTaxAmount: -15637950 });
    expect(plan.resumen).toMatchObject({ net: -82304998, iva: -15637950, credit: -97942948, filasDebit: 8 });
  });
});

// Copia de 2026-10-06: Finanzas renombro columnas de Master 1 (fecha en "Invoice
// Received", mes en "Cut Date Month", "Invoice Status" con el mes) y el
// encabezado del titulo en Master 2. Lo que antes era Pending ya esta AP Completed.
const RUTA_261006 = new URL('../../docs/features/Facturas/Invoice Master File 261006.xlsx', import.meta.url);
const hayArchivo261006 = existsSync(RUTA_261006);

describe.skipIf(!hayArchivo261006)('excel 2026-10 (layout con Cut Date Month)', () => {
  const libro = hayArchivo261006 ? leerMasterFile(new Uint8Array(readFileSync(RUTA_261006)).buffer) : null;
  const docs = hayArchivo261006 ? agruparDocumentos(libro.master1) : [];
  const conReceta = docs.map((documento) => ({
    documento,
    receta: armarReceta({ master2: libro.master2, mapa: libro.mapa, customer: documento.customer, docType: documento.docType }).receta,
  }));

  it('lee el layout nuevo y los titulos de Master 2', () => {
    expect(libro.master1).toHaveLength(912);
    expect(docs).toHaveLength(76);
    expect(libro.master2.filter((r) => r.systemModule === 'complex voucher').every((r) => r.titulo)).toBe(true);
    const fala = docs.find((d) => d.invoiceNumber === '494026');
    expect(fala).toMatchObject({ invoiceDate: '2026-08-21', cutDateMonth: 'AUG', status: 'ap completed on sep' });
  });

  it('elige solo las pendientes de registrar completas y sin Logistic Cost', () => {
    const elegibles = conReceta
      .filter(({ documento, receta }) => evaluarElegibilidad(documento, receta).elegible)
      .map(({ documento }) => `${documento.customer} ${documento.invoiceNumber}`);
    expect(elegibles).toEqual([
      'PARIS (FULLKOM) 4063', 'WALMART (FULLKOM) 4064', 'RIPLEY (FULLKOM) 4066', 'WALMART (FULLKOM) 4067', 'MERCADO PAGO 3016125',
    ]);
    const logistic = conReceta.find(({ documento }) => documento.invoiceNumber === '4015');
    expect(evaluarElegibilidad(logistic.documento, logistic.receta).motivos).toEqual(['"Logistic Cost" no tiene receta en Master 2 (su Description es otra)']);
  });

  it('arma el plan de MP 3016125 con el mes de Cut Date Month', () => {
    const { documento, receta } = conReceta.find(({ documento: d }) => d.invoiceNumber === '3016125');
    const plan = armarPlan({ documento, receta, adjuntos: [
      { id: '1', nombre: 'F 3016125.pdf', tipo: 'application/pdf' }, { id: '2', nombre: 'detalle.xlsx', tipo: '' },
    ] });
    expect(plan.errores).toEqual([]);
    expect(plan.cabecera).toMatchObject({
      invoiceNo: '3016125', invoiceDate: '25/09/2026', payeeCode: 'CL005108',
      description: 'F 3016125 - PG Commission MERCADO PAGO, 1.0%-2.3% - September 2026',
    });
    expect(plan.resumen).toMatchObject({ net: 5803315, iva: 1102630, credit: 6905945, filasDebit: 10 });
  });
});
