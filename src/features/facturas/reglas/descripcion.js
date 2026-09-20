// La Description del voucher (cabecera y todas las filas Debit):
//   F 2943361 - PG Commission MERCADO PAGO, 1.0%-2.3% - August 2026
//   <prefijo> <numero> - <titulo de la receta> - <mes del Impact Month> <Year>

import { MESES_EN, PREFIJO_DESCRIPCION } from '../constants.js';

/** "AUG (Provision)" -> "August"; '' si no se reconoce. */
export function mesDeImpactMonth(impactMonth) {
  const clave = String(impactMonth ?? '').trim().slice(0, 3).toUpperCase();
  return MESES_EN[clave] || '';
}

export function armarDescripcion({ docType, invoiceNumber, titulo, impactMonth, year }) {
  const prefijo = PREFIJO_DESCRIPCION[docType];
  const mes = mesDeImpactMonth(impactMonth);
  if (!prefijo || !invoiceNumber || !titulo || !mes || !year) return '';
  return `${prefijo} ${invoiceNumber} - ${titulo} - ${mes} ${year}`;
}

export const FECHA_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** De 'yyyy-mm-dd' a dd/MM/yyyy, el formato de los campos de fecha de GEVS. '' si no es fecha. */
export function fechaGevs(fechaIso) {
  const m = FECHA_ISO_RE.exec(String(fechaIso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
