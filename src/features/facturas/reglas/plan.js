// El PLAN DE CARGA: el valor exacto de cada campo que el driver escribe en GEVS
// para una factura. Es lo que el popup muestra para revisar y lo que el content
// ejecuta; el driver no calcula nada, solo copia lo que dice el plan.

import { GEVS, ROLES_OBLIGATORIOS, ROL_ADJUNTO } from '../constants.js';
import { calcularMontos } from './calculo.js';
import { armarDescripcion, fechaGevs } from './descripcion.js';

// Diferencia tolerada entre el credito que se carga y el total de Master 1: el
// redondeo por linea puede mover 1 CLP (decision validada con Finanzas).
const TOLERANCIA_CLP = 1;

const EXTENSIONES_POR_ROL = {
  [ROL_ADJUNTO.FACTURA]: ['.pdf'],
  [ROL_ADJUNTO.DETALLE]: ['.xlsx', '.xls', '.csv'],
};

/**
 * Elige que adjunto cumple cada rol para un documento. Un rol asignado a mano
 * en el popup manda; si no, por nombre: el PDF que trae el numero de factura es
 * la factura, y el detalle (un reporte que no suele llevar el numero) se toma
 * si es el unico archivo de su tipo. Lo demas se asigna a mano.
 *
 * @param {Array<{id:string, nombre:string, rol?:string}>} adjuntos
 * @param {object} documento
 * @returns {{ [rol]: adjunto|null }}
 */
export function emparejarAdjuntos(adjuntos, documento) {
  const numero = String(documento.invoiceNumber || '');
  const resultado = {};
  for (const [rol, extensiones] of Object.entries(EXTENSIONES_POR_ROL)) {
    const asignado = adjuntos.find((a) => a.rol === rol);
    const candidatos = adjuntos.filter((a) => !a.rol && extensiones.some((ext) => a.nombre.toLowerCase().endsWith(ext)));
    const conNumero = numero ? candidatos.filter((a) => a.nombre.includes(numero)) : [];
    resultado[rol] = asignado
      || (conNumero.length === 1 ? conNumero[0] : null)
      || (candidatos.length === 1 ? candidatos[0] : null);
  }
  return resultado;
}

/**
 * @param {object} o
 * @param {object} o.documento salida de agruparDocumentos
 * @param {object} o.receta    salida de armarReceta (no null)
 * @param {Array<{id, nombre, tipo, rol?}>} [o.adjuntos] archivos disponibles
 * @returns {object} plan; `plan.errores` no vacio significa que NO se puede ejecutar
 */
export function armarPlan({ documento, receta, adjuntos = [] }) {
  const montos = calcularMontos(documento.lineas);
  const description = armarDescripcion({
    docType: documento.docType,
    invoiceNumber: documento.invoiceNumber,
    titulo: receta.titulo,
    impactMonth: documento.impactMonth,
    year: documento.year,
  });
  const invoiceDate = fechaGevs(documento.invoiceDate);
  const porRol = emparejarAdjuntos(adjuntos, documento);

  const errores = [];
  const avisos = [];
  if (!description) errores.push('No se pudo armar la Description (falta numero, titulo, Impact Month o Year).');
  if (!invoiceDate) errores.push('La fecha de factura no es valida.');
  if (!montos.filas.length) errores.push('Ninguna BU tiene monto.');
  for (const campo of ['payeeCode', 'debitDepartment', 'debitAccount', 'creditAccount', 'vatCode']) {
    if (!receta[campo]) errores.push(`La receta no tiene ${campo}.`);
  }
  for (const rol of ROLES_OBLIGATORIOS) {
    if (!porRol[rol]) errores.push(`Falta el adjunto "${rol}".`);
  }

  const diferencia = documento.total ? montos.credit - documento.total.total : null;
  if (diferencia != null && Math.abs(diferencia) > TOLERANCIA_CLP) {
    avisos.push(`El credito (${montos.credit}) difiere del Total Amt de Master 1 (${documento.total.total}) en ${diferencia.toFixed(2)} CLP.`);
  }

  return {
    clave: documento.clave,
    customer: documento.customer,
    invoiceNumber: documento.invoiceNumber,
    cutDate: documento.cutDate,
    commissionType: documento.commissionType,
    cabecera: {
      invoiceTypeId: receta.invoiceTypeId,
      invoiceNo: documento.invoiceNumber,
      invoiceDate,
      payeeCode: receta.payeeCode,
      description,
    },
    credito: { account: receta.creditAccount, amount: montos.credit },
    debito: {
      department: receta.debitDepartment,
      account: receta.debitAccount,
      productType: GEVS.PRODUCT_TYPE_DIV,
      filas: montos.filas.map((f) => ({ bu: f.bu, division: f.division, gbu: f.gbu, amount: f.monto })),
      iva: { lineType: GEVS.LINE_TYPE_VAT, taxCode: receta.vatCode, amount: montos.iva, account: GEVS.VAT_ACCOUNT },
    },
    dff: {
      issueDate: invoiceDate,
      supplyPrice: montos.net,
      originalTaxAmount: montos.iva,
      supplier: receta.payeeCode,
      taxRateCode: receta.vatCode,
    },
    adjuntos: ROLES_OBLIGATORIOS
      .map((rol) => porRol[rol] && { rol, id: porRol[rol].id, nombre: porRol[rol].nombre, tipo: porRol[rol].tipo })
      .filter(Boolean),
    resumen: {
      net: montos.net,
      iva: montos.iva,
      credit: montos.credit,
      filasDebit: montos.n,
      totalMaster1: documento.total?.total ?? null,
      diferencia,
    },
    avisos,
    errores,
  };
}
