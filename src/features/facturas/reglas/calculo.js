// Lo que hacia la hoja "Round": de los netos por BU a los montos que se
// escriben en GEVS. Ver docs/features/facturas-datos.md, seccion Round.
//
//   linea_i = round(neto_i)        entero mas cercano, mitades lejos de cero (ROUND de Excel)
//   NET'    = sum(linea_i)
//   IVA'    = round(NET' * 0.19)
//   CREDIT  = NET' + IVA'          cuadra debito = credito por construccion
//   N       = lineas != 0 + 1      la fila de IVA

import { GEVS } from '../constants.js';

/** ROUND(x, 0) de Excel: las mitades se alejan de cero (Math.round no). */
export function redondear(x) {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/**
 * @param {Array<{bu:string, division?:string, neto:number}>} lineas
 * @returns {{ filas: Array<{bu, division, neto, monto, gbu}>, net: number, iva: number, credit: number, n: number }}
 */
export function calcularMontos(lineas) {
  const filas = lineas
    .map((l) => ({ bu: l.bu, division: l.division ?? '', neto: l.neto, monto: redondear(l.neto), gbu: `DIV:${l.bu}` }))
    .filter((f) => f.monto !== 0);

  const net = filas.reduce((acc, f) => acc + f.monto, 0);
  const iva = redondear(net * GEVS.IVA);
  return { filas, net, iva, credit: net + iva, n: filas.length + 1 };
}
