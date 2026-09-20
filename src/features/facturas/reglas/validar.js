// Que factura puede entrar al proceso y por que no. Los motivos van tal cual al
// popup, asi que estan escritos para una persona.

import { DOC_TYPE, ESTADO_FACTURA, GEVS } from '../constants.js';
import { FECHA_ISO_RE } from './descripcion.js';

const MOTIVO_ESTADO = {
  [ESTADO_FACTURA.APPROVING]: 'ya registrada en GEVS (Approving)',
  [ESTADO_FACTURA.AP_COMPLETED]: 'ya aprobada (AP Completed)',
  [ESTADO_FACTURA.DRAFT]: 'en borrador (Draft): fuera del alcance por ahora',
  [ESTADO_FACTURA.PENDING_REPORT]: 'Pending Report: fuera del alcance por ahora',
};

/**
 * @param {object} documento salida de agruparDocumentos
 * @param {object|null} receta salida de armarReceta
 * @returns {{ elegible: boolean, motivos: string[] }}
 */
export function evaluarElegibilidad(documento, receta) {
  const motivos = [];

  if (documento.status !== ESTADO_FACTURA.PENDING) {
    motivos.push(MOTIVO_ESTADO[documento.status] || `estado "${documento.status || 'vacio'}" desconocido`);
  }
  if (documento.docType !== DOC_TYPE.INVOICE) {
    motivos.push(documento.docType === DOC_TYPE.CREDIT_NOTE
      ? 'nota de credito: queda para la etapa 2'
      : `tipo de documento "${documento.docType}" no soportado`);
  }
  if (!receta) motivos.push('sin receta para este cliente');
  else if (receta.systemModule !== GEVS.MODULO_SOPORTADO) motivos.push(`va por "${receta.systemModule}", no por Complex Voucher`);
  if (!documento.invoiceNumber) motivos.push('sin numero de factura');
  if (!FECHA_ISO_RE.test(documento.invoiceDate)) {
    motivos.push(`fecha de factura invalida ("${documento.invoiceDate || 'vacia'}")`);
  }
  if (!documento.lineas.some((l) => l.neto !== 0)) motivos.push('sin montos por BU');
  if (!documento.total || !documento.total.neto) motivos.push('sin fila TOTAL o con total 0');
  if (documento.ambiguo) motivos.push('una BU aparece dos veces con montos distintos');

  return { elegible: motivos.length === 0, motivos };
}
