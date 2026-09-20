// Plan: exactamente lo que se va a escribir en GEVS para la factura elegida.
// Es la revision humana antes de tocar la pantalla.

import { cargarContexto } from '../contexto.js';
import { escapeHtml, formatClp } from '../../../../shared/ui/format.js';

export async function render(container) {
  const ctx = await cargarContexto();
  if (!ctx.documento) {
    container.innerHTML = '<p class="ct-empty">Elige una factura en la pestana Datos.</p>';
    return;
  }
  if (!ctx.plan) {
    container.innerHTML = `<p class="ct-empty">${escapeHtml(ctx.avisosReceta.join(' ') || 'Sin receta para este cliente.')}</p>`;
    return;
  }
  const { plan, elegibilidad, avisosReceta, yaProcesada } = ctx;
  const notas = [
    ...plan.errores.map((e) => ['error', e]),
    ...(elegibilidad.elegible ? [] : elegibilidad.motivos.map((m) => ['warn', `No elegible: ${m}`])),
    ...(yaProcesada ? [['warn', `Ya procesada el ${new Date(yaProcesada.fecha).toLocaleString()} (batch ${yaProcesada.batchId || '-'}${yaProcesada.reference ? `, ${yaProcesada.reference}` : ''}).`]] : []),
    ...plan.avisos.map((a) => ['warn', a]),
    ...avisosReceta.map((a) => ['warn', a]),
  ];

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">${escapeHtml(plan.customer)} - factura ${escapeHtml(plan.invoiceNumber)}</h3>
        <p class="lt-hint">${escapeHtml(plan.commissionType)} / ${escapeHtml(plan.cutDate)}</p>
        ${notas.map(([nivel, texto]) => `<div class="ct-state ct-state--${nivel}">${escapeHtml(texto)}</div>`).join('')}
        ${tabla('Cabecera', [
          ['Invoice Type', 'Vendor Invoice(CHL)'],
          ['Invoice No', plan.cabecera.invoiceNo],
          ['Invoice Date', plan.cabecera.invoiceDate],
          ['Payee Code', plan.cabecera.payeeCode],
          ['Description', plan.cabecera.description],
        ])}
        ${tabla('Credit', [['Account', plan.credito.account], ['Amount', formatClp(plan.credito.amount)]])}
        ${tabla(`Debit (${plan.resumen.filasDebit} filas, Department ${escapeHtml(plan.debito.department)}, Account ${escapeHtml(plan.debito.account)})`, [
          ...plan.debito.filas.map((f, i) => [`${i + 1}. ${f.gbu}`, formatClp(f.amount)]),
          [`${plan.debito.filas.length + 1}. VAT ${plan.debito.iva.taxCode}`, formatClp(plan.debito.iva.amount)],
        ])}
        ${tabla('DFF (fila IVA)', [
          ['ISSUE_DATE', plan.dff.issueDate],
          ['SUPPLY_PRICE', formatClp(plan.dff.supplyPrice)],
          ['ORIGINAL_TAX_AMOUNT', formatClp(plan.dff.originalTaxAmount)],
          ['SUPPLIER', plan.dff.supplier],
          ['TAX_RATE_CODE', plan.dff.taxRateCode],
        ])}
        ${tabla('Adjuntos', plan.adjuntos.length ? plan.adjuntos.map((a) => [a.rol, a.nombre]) : [['-', 'ninguno']])}
        ${tabla('Cuadre', [
          ['Neto redondeado', formatClp(plan.resumen.net)],
          ['IVA', formatClp(plan.resumen.iva)],
          ['Credito (= neto + IVA)', formatClp(plan.resumen.credit)],
          ['Total Amt en Master 1', formatClp(plan.resumen.totalMaster1)],
        ])}
      </section>
    </div>`;
}

function tabla(titulo, filas) {
  return `
    <div class="io-table-wrap">
      <table class="io-table">
        <thead><tr><th colspan="2">${titulo}</th></tr></thead>
        <tbody>${filas.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td title="${escapeHtml(v)}">${escapeHtml(v)}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
}
