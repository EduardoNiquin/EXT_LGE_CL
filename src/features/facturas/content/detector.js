// Que pantalla de GEVS es ESTE frame.
//
// Medido en GEVS real (2026-09-19): el formulario de Complex Voucher vive en el
// TOP frame, primero bajo `RF.jsp?...batchId=0` y, tras el primer cambio, bajo
// `OA.jsp?page=...ComplexVoucherEntryPG`. Por eso la pantalla de carga se
// reconoce por el DOM y no por la URL. La ventana LOV es un frameset: el frame
// con la tabla es el que tiene `#InquiryTable`.

import { PANTALLA, SELECTORS, URL_LOV_TAX_RE, URL_UPLOAD_RE, URL_UPLOAD_RESULT_RE } from '../constants.js';

/** `batchId` de la URL de este frame: 0 en un voucher nuevo, el asignado tras Save. */
export function batchIdDe(url = location.href) {
  const valor = new URL(url).searchParams.get('batchId');
  return valor == null ? null : Number(valor);
}

function esInquiry() {
  return /Inquiry/i.test(document.title) || /InquiryPG/.test(document.querySelector(SELECTORS.form)?.getAttribute('action') || '');
}

export function tipoPantalla() {
  const url = location.href;
  if (URL_UPLOAD_RESULT_RE.test(url)) return PANTALLA.UPLOAD_RESULT;
  if (URL_UPLOAD_RE.test(url)) return PANTALLA.UPLOAD;
  if (URL_LOV_TAX_RE.test(url) && document.querySelector(SELECTORS.lov.tabla)) return PANTALLA.LOV_TAX;
  // Solo el top frame: cada PPR carga la pagina ENTERA dentro de `_pprIFrame`
  // (medido), y el content script de ese iframe veria "la pantalla" tambien.
  if (window !== window.top || !document.querySelector(SELECTORS.form)) return PANTALLA.OTRA;
  if (esInquiry()) return PANTALLA.INQUIRY;
  if (document.querySelector(SELECTORS.botones.submit) && document.querySelector(SELECTORS.debito.tabla)) return PANTALLA.ENTRY;
  return PANTALLA.OTRA;
}

export function diagnose() {
  const pantalla = tipoPantalla();
  return {
    detected: pantalla === PANTALLA.ENTRY,
    pantalla,
    batchId: batchIdDe(),
    url: location.href,
    title: document.title,
    isTopFrame: window === window.top,
    form: !!document.querySelector(SELECTORS.form),
    submit: !!document.querySelector(SELECTORS.botones.submit),
    filasDebit: document.querySelectorAll(SELECTORS.debito.amounts).length,
    iframes: Array.from(document.querySelectorAll('iframe, frame')).map((f) => f.name || f.id || f.getAttribute('src') || '(sin nombre)').slice(0, 12),
  };
}
