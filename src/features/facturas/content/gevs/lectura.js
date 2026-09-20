// Foto de lo que hay en la pantalla de Complex Voucher, con la misma forma que
// el plan: es lo que se compara antes de guardar y lo que devuelve
// `__extLgeCl.facturas.leerPantalla()`.

import { SELECTORS } from '../../constants.js';
import { batchIdDe, tipoPantalla } from '../detector.js';
import { contarFilasDebit, el, leerValor, mensajes } from './campos.js';

function filaDebit(i) {
  const d = SELECTORS.debito;
  return {
    lineType: leerValor(d.lineType(i)),
    taxCode: leerValor(d.taxCode(i)),
    department: leerValor(d.department(i)),
    account: leerValor(d.account(i)),
    amount: leerValor(d.amount(i)),
    productType: leerValor(d.productType(i)),
    product: leerValor(d.product(i)),
    description: leerValor(d.description(i)),
  };
}

export function leerPantalla() {
  const c = SELECTORS.cabecera;
  const filas = contarFilasDebit();
  return {
    pantalla: tipoPantalla(),
    url: location.href,
    batchId: batchIdDe(),
    mensajes: mensajes(),
    cabecera: {
      invoiceTypeId: leerValor(c.invoiceType),
      invoiceNo: leerValor(c.invoiceNo),
      invoiceDate: leerValor(c.invoiceDate),
      accountingDate: leerValor(c.accountingDate),
      payeeCode: leerValor(c.payeeCode),
      payeeNo: leerValor(c.payeeNo),
      payeeName: leerValor(c.payeeName),
      termsDate: leerValor(c.termsDate),
      dueDate: leerValor(c.dueDate),
      description: leerValor(c.description),
    },
    credito: {
      department: leerValor(SELECTORS.credito.department),
      account: leerValor(SELECTORS.credito.account),
      amount: leerValor(SELECTORS.credito.amount),
    },
    debito: Array.from({ length: filas }, (_, i) => filaDebit(i)),
    dff: el(SELECTORS.dff.apply) ? {
      issueDate: leerValor(SELECTORS.dff.issueDate),
      supplyPrice: leerValor(SELECTORS.dff.supplyPrice),
      originalTaxAmount: leerValor(SELECTORS.dff.originalTaxAmount),
      supplier: leerValor(SELECTORS.dff.supplier),
      taxRateCode: leerValor(SELECTORS.dff.taxRateCode),
    } : null,
    adjuntos: Array.from(document.querySelectorAll(SELECTORS.adjuntos.enlaces)).map((a) => a.textContent.trim()),
  };
}
