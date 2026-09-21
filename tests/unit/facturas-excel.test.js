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
