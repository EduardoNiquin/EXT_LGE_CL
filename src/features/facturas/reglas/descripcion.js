// La Description del voucher (cabecera y todas las filas Debit):
//   F 2943361 - PG Commission MERCADO PAGO, 1.0%-2.3% - August 2026
//   <prefijo> <numero> - <titulo de la receta> - <mes del Cut Date Month> <Year>
//
// El mes sale de Master 1 col "Cut Date Month" (`JUL`); hasta 2026-09 salia de
// "Impact Month" (`AUG (Provision)`). Las dos empiezan con el mes en 3 letras.

import { MESES_EN, TIPOS_DOCUMENTO } from '../constants.js';

/** "JUL" o "AUG (Provision)" -> el mes en ingles ("July", "August"); '' si no se reconoce. */
export function mesEnIngles(valor) {
  const clave = String(valor ?? '').trim().slice(0, 3).toUpperCase();
  return MESES_EN[clave] || '';
}

export function armarDescripcion({ docType, invoiceNumber, titulo, cutDateMonth, year }) {
  const prefijo = TIPOS_DOCUMENTO[docType]?.prefijo;
  const mes = mesEnIngles(cutDateMonth);
  if (!prefijo || !invoiceNumber || !titulo || !mes || !year) return '';
  return `${prefijo} ${invoiceNumber} - ${titulo} - ${mes} ${year}`;
}

export const FECHA_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** De 'yyyy-mm-dd' a dd/MM/yyyy, el formato de los campos de fecha de GEVS. '' si no es fecha. */
export function fechaGevs(fechaIso) {
  const m = FECHA_ISO_RE.exec(String(fechaIso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
