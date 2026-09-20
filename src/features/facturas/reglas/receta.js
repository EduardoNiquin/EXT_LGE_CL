// La receta de un cliente: que payee, cuentas, departamento y tax code lleva su
// voucher. Sale de dos hojas que deberian coincidir:
//   - Map: la fuente (Payee Code, Department, Debit Account).
//   - Master 2_STEPS: titulo de la Description, Credit-Account, VAT Tax Code,
//     Invoice Type y System Module; sus Payee/Department/Debit Account son
//     VLOOKUP a Map y llegan como valores cacheados, asi que solo se contrastan.

import { GEVS } from '../constants.js';
import { normalizar } from './hojas.js';

const TITULO_SUFIJO_RE = /\s*-\s*$/;

/**
 * @param {object} o
 * @param {object[]} o.master2  salida de leerMaster2
 * @param {object[]} o.mapa     salida de leerMapa
 * @param {string} o.customer
 * @param {string} o.docType    normalizado ('invoice' | 'credit note' | ...)
 * @returns {{ receta: object|null, avisos: string[] }}
 */
export function armarReceta({ master2, mapa, customer, docType }) {
  const cliente = normalizar(customer);
  const enMapa = mapa.find((c) => normalizar(c.customer) === cliente) || null;
  const pasos = master2.find((r) => normalizar(r.customer) === cliente && r.docType === docType) || null;
  const avisos = [];

  if (!pasos) return { receta: null, avisos: [`Sin receta en Master 2 para "${customer}" (${docType}).`] };
  if (!enMapa) avisos.push(`"${customer}" no esta en la hoja Map: se usan los codigos de Master 2.`);

  const contrastar = (campo, deMapa, deMaster2) => {
    if (deMapa && deMaster2 && deMapa !== deMaster2) {
      avisos.push(`${campo}: Map dice ${deMapa} y Master 2 dice ${deMaster2}; se usa Map.`);
    }
    return deMapa || deMaster2 || '';
  };

  const invoiceTypeId = GEVS.INVOICE_TYPE_POR_NOMBRE[normalizar(pasos.invoiceType)] || '';
  if (!invoiceTypeId) avisos.push(`Invoice Type "${pasos.invoiceType}" desconocido: se usa Vendor Invoice(CHL).`);

  return {
    avisos,
    receta: {
      customer,
      docType,
      systemModule: pasos.systemModule,
      invoiceTypeId: invoiceTypeId || GEVS.INVOICE_TYPE_VENDOR_CHL,
      payeeCode: contrastar('Payee Code', enMapa?.payeeCode, pasos.payeeCode),
      debitDepartment: contrastar('Department', enMapa?.department, pasos.debitDepartment),
      debitAccount: contrastar('Debit Account', enMapa?.debitAccount, pasos.debitAccount),
      creditAccount: pasos.creditAccount,
      vatCode: pasos.vatCode,
      titulo: pasos.titulo.replace(TITULO_SUFIJO_RE, '').trim(),
    },
  };
}
