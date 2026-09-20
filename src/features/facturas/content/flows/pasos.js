// Los pasos de la carga, en el orden de PASOS (constants.js). Cada paso tiene
//   verificar(ctx) -> true si la pantalla ya esta como el plan pide,
//   ejecutar(ctx)  -> escribe lo que falta y espera la respuesta de OAF.
// El motor (run.js) llama verificar primero SIEMPRE: asi un reload a mitad de
// paso no repite escrituras. Varias acciones terminan en una navegacion real y
// este documento muere: el siguiente documento retoma por verificar().
//
// Lo que hace cada campo (PPR, navegacion o nada) se midio en GEVS real el
// 2026-09-19: ver docs/features/facturas-flujo-gevs.md.
//
// `ctx` = { run, plan, signal, patch(fields) }.

import { GEVS, PASOS, SELECTORS } from '../../constants.js';
import { clic, contarFilasDebit, el, elegir, escribir, leerValor, lupaDe, mensajes, mismoMonto } from '../gevs/campos.js';
import { ACCION, esperarAccion, tipoDeAccion } from '../gevs/ppr.js';
import { leerPantalla } from '../gevs/lectura.js';
import { batchIdDe } from '../detector.js';
import { anotar } from '../bitacora.js';
import { waitFor } from '../../../../shared/dom/wait.js';

const { cabecera: C, credito: CR, debito: D, dff: DFF, botones: B } = SELECTORS;
const LOV_TIMEOUT_MS = 45000;
const FILA_TIMEOUT_MS = 12000;

const VERBO = { escribir: 'Escribe', elegir: 'Elige', clic: 'Pulsa' };

function ultimaFila(plan) {
  return plan.resumen.filasDebit - 1;
}

function filasItem(plan) {
  return plan.debito.filas.map((fila, i) => ({ i, fila }));
}

function campoOk(selector, valor, monto = false) {
  const actual = leerValor(selector);
  return monto ? mismoMonto(actual, valor) : actual === String(valor);
}

/**
 * Toda accion sobre la pantalla pasa por aqui: se anota en la bitacora ANTES de
 * hacerla (si navega, este documento muere y no habria despues), se hace y se
 * espera lo que OAF responda; si hubo respuesta en este documento, se anota
 * cuanto tardo.
 */
async function actuar(accion, selector, valor, hacer, { signal, description }) {
  const respuesta = tipoDeAccion(el(selector));
  anotar(`${VERBO[accion]} ${selector}${valor == null ? '' : ` = "${valor}"`}`, { elemento: { selector }, valor, respuesta });
  const t0 = Date.now();
  await esperarAccion(hacer(), { signal, description });
  if (respuesta !== ACCION.NAVEGA) anotar(`GEVS respondio (${respuesta}) en ${((Date.now() - t0) / 1000).toFixed(1)} s`, { detalle: { selector, respuesta, ms: Date.now() - t0 } });
}

/** Escribe solo si el campo no tiene ya el valor, y espera lo que OAF haga con el. */
async function asegurar(selector, valor, { monto = false, signal } = {}) {
  if (campoOk(selector, valor, monto)) return false;
  await actuar('escribir', selector, valor, () => escribir(selector, valor), { signal, description: `la respuesta tras escribir ${selector}` });
  return true;
}

async function asegurarSelect(selector, value, { signal } = {}) {
  if (campoOk(selector, value)) return false;
  await actuar('elegir', selector, value, () => elegir(selector, value), { signal, description: `la respuesta tras elegir ${selector}` });
  return true;
}

async function pulsar(selector, { signal, description } = {}) {
  await actuar('clic', selector, null, () => clic(selector), { signal, description });
}

// --- comparacion final -----------------------------------------------------

/** Diferencias entre la pantalla y el plan; vacio = todo cuadra. */
export function diferencias(pantalla, plan) {
  const out = [];
  const cmp = (nombre, actual, esperado, monto = false) => {
    const ok = monto ? mismoMonto(actual, esperado) : String(actual ?? '').trim() === String(esperado);
    if (!ok) out.push(`${nombre}: pantalla "${actual}", plan "${esperado}"`);
  };
  cmp('Invoice Type', pantalla.cabecera.invoiceTypeId, plan.cabecera.invoiceTypeId);
  cmp('Invoice No', pantalla.cabecera.invoiceNo, plan.cabecera.invoiceNo);
  cmp('Invoice Date', pantalla.cabecera.invoiceDate, plan.cabecera.invoiceDate);
  cmp('Payee Code', pantalla.cabecera.payeeCode, plan.cabecera.payeeCode);
  cmp('Description', pantalla.cabecera.description, plan.cabecera.description);
  if (!pantalla.cabecera.payeeNo) out.push('Payee Biz-No vacio: el payee no se resolvio');
  cmp('Credit Account', pantalla.credito.account, plan.credito.account);
  cmp('Credit Amount', pantalla.credito.amount, plan.credito.amount, true);

  if (pantalla.debito.length !== plan.resumen.filasDebit) {
    out.push(`Filas Debit: pantalla ${pantalla.debito.length}, plan ${plan.resumen.filasDebit}`);
    return out;
  }
  plan.debito.filas.forEach((fila, i) => {
    const p = pantalla.debito[i];
    cmp(`Fila ${i + 1} Line Type`, p.lineType, GEVS.LINE_TYPE_ITEM);
    cmp(`Fila ${i + 1} Department`, p.department, plan.debito.department);
    cmp(`Fila ${i + 1} Account`, p.account, plan.debito.account);
    cmp(`Fila ${i + 1} Amount`, p.amount, fila.amount, true);
    cmp(`Fila ${i + 1} Product tipo`, p.productType, plan.debito.productType);
    cmp(`Fila ${i + 1} Product`, p.product, fila.gbu);
    cmp(`Fila ${i + 1} Description`, p.description, plan.cabecera.description);
  });
  // La fila VAT conserva el departamento por defecto del usuario (medido y asi
  // quedo tambien en la carga manual): no se compara.
  const iva = pantalla.debito[pantalla.debito.length - 1];
  cmp('Fila IVA Line Type', iva.lineType, plan.debito.iva.lineType);
  cmp('Fila IVA Tax Code', iva.taxCode, plan.debito.iva.taxCode);
  cmp('Fila IVA Account', iva.account, plan.debito.iva.account);
  cmp('Fila IVA Amount', iva.amount, plan.debito.iva.amount, true);
  cmp('Fila IVA Description', iva.description, plan.cabecera.description);
  if (iva.product) out.push(`Fila IVA Product deberia ir vacio y tiene "${iva.product}"`);

  const sumaDebit = pantalla.debito.reduce((acc, f) => acc + Number(f.amount.replace(/\./g, '').replace(',', '.') || 0), 0);
  if (sumaDebit !== plan.credito.amount) out.push(`Suma Debit ${sumaDebit} != Credit ${plan.credito.amount}`);
  if (/error/i.test(pantalla.mensajes)) out.push(`GEVS muestra: ${pantalla.mensajes}`);
  return out;
}

// --- pasos -------------------------------------------------------------------

const IMPL = {
  precondiciones: {
    verificar: ({ run, plan }) => !!plan && (run.batchId == null ? batchIdDe() === 0 : batchIdDe() === run.batchId),
    ejecutar: ({ run, plan }) => {
      if (!plan) throw new Error('La corrida no tiene plan de carga.');
      throw new Error(`La pantalla tiene batchId ${batchIdDe()} y se esperaba ${run.batchId ?? 0}. Abre un Complex Voucher nuevo.`);
    },
  },

  // Elegirlo navega (submitForm) y recien entonces aparecen los demas campos.
  'invoice-type': {
    verificar: ({ plan }) => campoOk(C.invoiceType, plan.cabecera.invoiceTypeId) && !!el(C.invoiceNo),
    ejecutar: ({ plan, signal }) => asegurarSelect(C.invoiceType, plan.cabecera.invoiceTypeId, { signal }),
  },

  payee: {
    verificar: ({ plan }) => campoOk(C.payeeCode, plan.cabecera.payeeCode)
      && leerValor(C.payeeName).includes(plan.cabecera.payeeCode)
      && !!leerValor(C.payeeNo),
    ejecutar: async ({ plan, signal }) => {
      await asegurar(C.payeeCode, plan.cabecera.payeeCode, { signal });
      // El PPR del payee rellena nombre, RUT, grupo, metodo y plazo; si no llegan, el codigo no existe.
      await waitFor(() => leerValor(C.payeeName).includes(plan.cabecera.payeeCode) && !!leerValor(C.payeeNo), {
        timeout: 15000, signal, description: `que GEVS resuelva el payee ${plan.cabecera.payeeCode}`,
      });
    },
  },

  'invoice-no': {
    verificar: ({ plan }) => campoOk(C.invoiceNo, plan.cabecera.invoiceNo),
    ejecutar: ({ plan, signal }) => asegurar(C.invoiceNo, plan.cabecera.invoiceNo, { signal }),
  },

  // Tipear dd/MM/yyyy basta (medido): no hace falta el calendario. Terms Date se copia sola.
  'invoice-date': {
    verificar: ({ plan }) => campoOk(C.invoiceDate, plan.cabecera.invoiceDate),
    ejecutar: ({ plan, signal }) => asegurar(C.invoiceDate, plan.cabecera.invoiceDate, { signal }),
  },

  description: {
    verificar: ({ plan }) => campoOk(C.description, plan.cabecera.description),
    ejecutar: ({ plan, signal }) => asegurar(C.description, plan.cabecera.description, { signal }),
  },

  // Solo la cuenta: el monto lo recalcula GEVS con la suma de los debitos en
  // cada navegacion, asi que se asegura al final (paso credito-amount).
  credito: {
    verificar: ({ plan }) => campoOk(CR.account, plan.credito.account),
    ejecutar: ({ plan, signal }) => asegurar(CR.account, plan.credito.account, { signal }),
  },

  // Antes de Add: las filas nuevas heredan el departamento de la fila 0.
  'debito-dept': {
    verificar: ({ plan }) => campoOk(D.department(0), plan.debito.department),
    ejecutar: ({ plan, signal }) => asegurar(D.department(0), plan.debito.department, { signal }),
  },

  'debito-add': {
    verificar: ({ plan }) => contarFilasDebit() === plan.resumen.filasDebit,
    ejecutar: async ({ plan, signal }) => {
      const objetivo = plan.resumen.filasDebit;
      let filas = contarFilasDebit();
      if (filas > objetivo) throw new Error(`Hay ${filas} filas Debit y el plan pide ${objetivo}: borra las que sobran a mano.`);
      while (filas < objetivo) {
        await pulsar(B.add, { signal, description: 'la fila Debit nueva' });
        await waitFor(() => contarFilasDebit() > filas, { timeout: FILA_TIMEOUT_MS, signal, description: 'que aparezca la fila Debit nueva' });
        filas = contarFilasDebit();
      }
    },
  },

  'iva-line-type': {
    verificar: ({ plan }) => campoOk(D.lineType(ultimaFila(plan)), plan.debito.iva.lineType),
    ejecutar: ({ plan, signal }) => asegurarSelect(D.lineType(ultimaFila(plan)), plan.debito.iva.lineType, { signal }),
  },

  // "CLIDD19" casa con 10 codigos, asi que la validacion de OAF abre la ventana
  // LOV (con las emergentes permitidas por el SW); content/lov.js elige la fila
  // exacta y al cerrarse GEVS pone la cuenta 11330101. Si no se abrio sola, se
  // pulsa la lupa.
  'iva-tax-code': {
    verificar: ({ plan }) => campoOk(D.taxCode(ultimaFila(plan)), plan.debito.iva.taxCode) && campoOk(D.account(ultimaFila(plan)), plan.debito.iva.account),
    ejecutar: async ({ plan, signal, patch }) => {
      const i = ultimaFila(plan);
      const { taxCode, account } = plan.debito.iva;
      const resuelto = () => campoOk(D.taxCode(i), taxCode) && campoOk(D.account(i), account);
      await patch({ esperaLov: { campo: D.taxCode(i), valor: taxCode } });
      await asegurar(D.taxCode(i), taxCode, { signal });
      const solo = await waitFor(resuelto, { timeout: 8000, signal, description: 'la ventana LOV automatica' }).catch(() => false);
      if (!solo) {
        anotar(`Pulsa la lupa de ${D.taxCode(i)} (la ventana LOV no se abrio sola)`, { elemento: { selector: D.taxCode(i) } });
        lupaDe(D.taxCode(i)).click();
        await waitFor(resuelto, { timeout: LOV_TIMEOUT_MS, signal, description: `que la fila IVA quede con ${taxCode} y cuenta ${account} (ventana LOV)` });
      }
      await patch({ esperaLov: null });
    },
  },

  'debito-account': {
    verificar: ({ plan }) => filasItem(plan).every(({ i }) => campoOk(D.account(i), plan.debito.account)),
    ejecutar: async ({ plan, signal }) => {
      for (const { i } of filasItem(plan)) await asegurar(D.account(i), plan.debito.account, { signal });
    },
  },

  // Cada monto navega (submitForm): se escribe uno y este documento muere; el
  // siguiente retoma aqui y escribe el que falte.
  'debito-amount': {
    verificar: ({ plan }) => filasItem(plan).every(({ i, fila }) => campoOk(D.amount(i), fila.amount, true)),
    progreso: ({ plan }) => filasItem(plan).filter(({ i, fila }) => campoOk(D.amount(i), fila.amount, true)).length,
    ejecutar: async ({ plan, signal }) => {
      for (const { i, fila } of filasItem(plan)) {
        if (await asegurar(D.amount(i), fila.amount, { monto: true, signal })) return;
      }
    },
  },

  'iva-amount': {
    verificar: ({ plan }) => campoOk(D.amount(ultimaFila(plan)), plan.debito.iva.amount, true),
    ejecutar: ({ plan, signal }) => asegurar(D.amount(ultimaFila(plan)), plan.debito.iva.amount, { monto: true, signal }),
  },

  'credito-amount': {
    verificar: ({ plan }) => campoOk(CR.amount, plan.credito.amount, true),
    ejecutar: ({ plan, signal }) => asegurar(CR.amount, plan.credito.amount, { monto: true, signal }),
  },

  producto: {
    verificar: ({ plan }) => filasItem(plan).every(({ i, fila }) => campoOk(D.productType(i), plan.debito.productType) && campoOk(D.product(i), fila.gbu)),
    ejecutar: async ({ plan, signal }) => {
      for (const { i, fila } of filasItem(plan)) {
        await asegurarSelect(D.productType(i), plan.debito.productType, { signal });
        await asegurar(D.product(i), fila.gbu, { signal });
      }
    },
  },

  'descripcion-filas': {
    verificar: ({ plan }) => Array.from({ length: plan.resumen.filasDebit }, (_, i) => i).every((i) => campoOk(D.description(i), plan.cabecera.description)),
    ejecutar: async ({ plan, signal }) => {
      for (let i = 0; i < plan.resumen.filasDebit; i++) await asegurar(D.description(i), plan.cabecera.description, { signal });
    },
  },

  // Abrir el panel navega; sus valores dejan de verse al aplicar. Se da por
  // hecho cuando se verificaron dentro del panel (run.dffListo) y el panel cerro.
  dff: {
    verificar: ({ run }) => !!run.dffListo && !el(DFF.apply),
    ejecutar: async ({ run, plan, signal, patch }) => {
      if (!el(DFF.apply)) {
        await pulsar(D.dff(ultimaFila(plan)), { signal, description: 'que abra el panel Account DFF' });
        return; // navego: el documento nuevo retoma con el panel abierto
      }
      const d = plan.dff;
      await asegurar(DFF.issueDate, d.issueDate, { signal });
      await asegurar(DFF.supplyPrice, d.supplyPrice, { monto: true, signal });
      await asegurar(DFF.originalTaxAmount, d.originalTaxAmount, { monto: true, signal });
      await asegurar(DFF.supplier, d.supplier, { signal });
      await asegurar(DFF.taxRateCode, d.taxRateCode, { signal });
      const faltan = [
        ['ISSUE_DATE', campoOk(DFF.issueDate, d.issueDate)],
        ['SUPPLY_PRICE', campoOk(DFF.supplyPrice, d.supplyPrice, true)],
        ['ORIGINAL_TAX_AMOUNT', campoOk(DFF.originalTaxAmount, d.originalTaxAmount, true)],
        ['SUPPLIER', campoOk(DFF.supplier, d.supplier)],
        ['TAX_RATE_CODE', campoOk(DFF.taxRateCode, d.taxRateCode)],
      ].filter(([, ok]) => !ok).map(([n]) => n);
      if (faltan.length) throw new Error(`El DFF no quedo como el plan: ${faltan.join(', ')}`);
      if (!run.dffListo) await patch({ dffListo: true });
      await pulsar(DFF.apply, { signal, description: 'que cierre el panel Account DFF' });
    },
  },

  verificar: {
    verificar: ({ run }) => !!run.verificado,
    ejecutar: async ({ plan, patch }) => {
      const difs = diferencias(leerPantalla(), plan);
      if (difs.length) throw new Error(`La pantalla no coincide con el plan: ${difs.join(' | ')}`);
      await patch({ verificado: true });
    },
  },

  guardar: {
    verificar: async ({ run, patch }) => {
      const batch = batchIdDe();
      if (!batch) return false;
      if (run.batchId == null) await patch({ batchId: batch });
      return true;
    },
    ejecutar: ({ signal }) => pulsar(B.save, { signal, description: 'Save' }),
  },

  adjuntos: {
    verificar: ({ plan }) => {
      const enPantalla = leerPantalla().adjuntos;
      return plan.adjuntos.every((a) => enPantalla.includes(a.nombre));
    },
    // Cada adjunto cuesta dos navegaciones (Add File y Apply): cuenta como avance el que ya se ve.
    progreso: ({ run, plan }) => {
      const enPantalla = leerPantalla().adjuntos;
      return plan.adjuntos.filter((a) => enPantalla.includes(a.nombre)).length * 2 + (run.adjuntoSubido ? 1 : 0);
    },
    // Mientras el iframe de upload trabaja, este frame solo espera (hasta 90 s).
    esperando: ({ run }) => !!run.adjuntoEnCurso && !run.adjuntoSubido
      && !leerPantalla().adjuntos.includes(run.adjuntoEnCurso.nombre)
      && Date.now() - run.adjuntoEnCurso.desde <= 90000,
    ejecutar: async ({ run, plan, signal, patch }) => {
      const enPantalla = leerPantalla().adjuntos;
      const enCurso = run.adjuntoEnCurso;
      if (enCurso && enPantalla.includes(enCurso.nombre)) {
        await patch({ adjuntoEnCurso: null, adjuntoSubido: false });
        return;
      }
      if (enCurso && run.adjuntoSubido) {
        // El iframe ya lo subio: Apply lo agrega al voucher (navega).
        await pulsar(B.fileApply, { signal, description: 'Apply del adjunto' });
        return;
      }
      if (enCurso) {
        // El iframe de upload esta trabajando; el cambio de adjuntoSubido dispara otro tick.
        if (Date.now() - enCurso.desde > 90000) throw new Error(`El adjunto "${enCurso.nombre}" no se subio en 90 s.`);
        return;
      }
      const siguiente = plan.adjuntos.find((a) => !enPantalla.includes(a.nombre));
      await patch({ adjuntoEnCurso: { ...siguiente, desde: Date.now() }, adjuntoSubido: false });
      await pulsar(B.addFile, { signal, description: 'que abra el iframe de upload' });
    },
  },

  'guardar-2': {
    // El mensaje "Saved Successfully" tambien queda del primer Save: solo cuenta
    // si este paso ya pidio el suyo (run.saveFinalPedido).
    verificar: ({ run }) => !!run.saveFinalPedido && /saved successfully/i.test(mensajes()),
    ejecutar: async ({ signal, patch }) => {
      await patch({ saveFinalPedido: true });
      await pulsar(B.save, { signal, description: 'Save final' });
    },
  },
  // No hay paso "Submit": lo hace la persona en GEVS (decision del usuario,
  // 2026-09-20). El motor entrega la pantalla al terminar guardar-2 y la
  // pantalla Inquiry confirma la Reference (flows/run.js).
};

export const PASOS_ENTRY = PASOS.map((p) => ({ ...p, ...IMPL[p.id] }));
