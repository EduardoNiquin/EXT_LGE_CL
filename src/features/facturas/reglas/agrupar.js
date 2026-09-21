// De las filas de Master 1 (una por factura x division) a DOCUMENTOS (una
// factura con sus lineas por BU y su fila TOTAL).

import { BUS, BU_TOTAL } from '../constants.js';

/** Identidad de una factura dentro del archivo. */
export function claveDocumento(fila) {
  return [fila.customer, fila.invoiceNumber, fila.invoiceDate, fila.cutDate, fila.commissionType, fila.docType]
    .map((v) => String(v ?? '').trim())
    .join('|');
}

/**
 * @param {object[]} filas salida de leerMaster1
 * @returns {object[]} documentos en orden de aparicion
 */
export function agruparDocumentos(filas) {
  const porClave = new Map();

  for (const fila of filas) {
    const clave = claveDocumento(fila);
    let doc = porClave.get(clave);
    if (!doc) {
      doc = {
        clave,
        customer: fila.customer,
        invoiceNumber: fila.invoiceNumber,
        invoiceDate: fila.invoiceDate,
        cutDate: fila.cutDate,
        commissionType: fila.commissionType,
        impactMonth: fila.impactMonth,
        year: fila.year,
        docType: fila.docType,
        status: fila.status,
        invoiceUrl: '',
        lineas: [],       // [{ bu, division, neto, redondeado }] en el orden de BUS
        total: null,      // { neto, vat, total } de la fila TOTAL
        ambiguo: false,   // una BU repetida con montos distintos
        filas: 0,
      };
      porClave.set(clave, doc);
    }
    doc.filas += 1;
    if (fila.invoiceUrl) doc.invoiceUrl = fila.invoiceUrl;

    if (fila.bu === BU_TOTAL) {
      doc.total = { neto: fila.netoClp ?? 0, vat: fila.vatClp ?? 0, total: fila.totalClp ?? 0 };
      continue;
    }
    const neto = fila.netoClp ?? 0;
    const previa = doc.lineas.find((l) => l.bu === fila.bu);
    if (previa) {
      if (previa.neto !== neto) doc.ambiguo = true;
      continue;
    }
    doc.lineas.push({ bu: fila.bu, division: fila.division, neto, redondeado: fila.redondeadoClp });
  }

  for (const doc of porClave.values()) {
    doc.lineas.sort((a, b) => BUS.indexOf(a.bu) - BUS.indexOf(b.bu));
  }
  return Array.from(porClave.values());
}
