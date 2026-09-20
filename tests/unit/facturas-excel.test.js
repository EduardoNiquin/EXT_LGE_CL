// Lectura del .xlsx real con SheetJS. El archivo tiene datos financieros y no
// se versiona: si no esta, el test se salta.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { leerMasterFile } from '../../src/features/facturas/reglas/excel.js';
import { agruparDocumentos } from '../../src/features/facturas/reglas/agrupar.js';
import { armarReceta } from '../../src/features/facturas/reglas/receta.js';
import { armarPlan } from '../../src/features/facturas/reglas/plan.js';

const RUTA = new URL('../../docs/features/Facturas/Invoice Master File 260831.xlsx', import.meta.url);
const hayArchivo = existsSync(RUTA);

describe.skipIf(!hayArchivo)('excel (Invoice Master File real)', () => {
  const buffer = hayArchivo ? readFileSync(RUTA) : null;
  const libro = hayArchivo ? leerMasterFile(new Uint8Array(buffer).buffer) : null;

  it('ubica las tres hojas y lee sus filas', () => {
    expect(libro.master1).toHaveLength(624);
    expect(libro.master2.length).toBeGreaterThanOrEqual(14);
    expect(libro.mapa.map((c) => c.customer)).toContain('MERCADO PAGO');
  });

  it('agrupa 51 documentos y arma el plan de MP 2943361 igual que la carga manual', () => {
    const docs = agruparDocumentos(libro.master1);
    expect(docs).toHaveLength(51);

    const mp = docs.find((d) => d.customer === 'MERCADO PAGO' && d.invoiceNumber === '2943361');
    expect(mp.invoiceDate).toBe('2026-08-25');
    const { receta } = armarReceta({ master2: libro.master2, mapa: libro.mapa, customer: mp.customer, docType: mp.docType });
    const plan = armarPlan({ documento: mp, receta, adjuntos: [
      { id: '1', nombre: 'F 2943361- Mercado Pago Commission - August 2026.pdf', tipo: 'application/pdf' },
      { id: '2', nombre: 'Reporte_Facturacion_MercadoPago_Ago2026 (1).xlsx', tipo: '' },
    ] });

    expect(plan.errores).toEqual([]);
    expect(plan.cabecera.invoiceDate).toBe('25/08/2026');
    expect(plan.cabecera.description).toBe('F 2943361 - PG Commission MERCADO PAGO, 1.0%-2.3% - August 2026');
    expect(plan.debito.filas.map((f) => f.amount)).toEqual([1508792, 550, 64185, 3153039, 1999165, 159502, 211101, 151983, 7227]);
    expect(plan.resumen).toMatchObject({ net: 7255544, iva: 1378553, credit: 8634097, filasDebit: 10 });
  });
});
