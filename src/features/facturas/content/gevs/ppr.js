// Esperar a que OAF termine lo que dispara una accion. Medido en GEVS real
// (2026-09-19, docs/features/facturas-flujo-gevs.md):
//
//   - Campos con `_uixspu` / `_LovInputVTF` en su onchange (y los botones Add,
//     Apply del DFF, Reset) hacen un PPR por el iframe `_pprIFrame`: tarda 1.5 a
//     3.6 s y al terminar el iframe dispara `load`. Esa es la señal.
//   - Campos con `submitForm` (Invoice Type, montos Debit, icono DFF, Save,
//     Submit, Add File) navegan de verdad: este documento muere y el siguiente
//     retoma por verificar(). Aqui solo se espera al `pagehide`.
//   - Campos sin handler (Invoice No, Description, montos del DFF) no hacen nada.
//
// `_pprBlocking` existe pero vive en el mundo MAIN: desde el content script no se
// ve, por eso se usa el iframe.

import { PPR_SETTLE_MS, PPR_TIMEOUT_MS } from '../../constants.js';
import { sleep } from '../../../../shared/dom/wait.js';
import { WaitTimeoutError } from '../../../../shared/dom/wait.js';

const PPR_IFRAME = 'iframe[name="_pprIFrame"]';
const NAVEGACION_TIMEOUT_MS = 8000;

export const ACCION = { NAVEGA: 'navega', PPR: 'ppr', NADA: 'nada' };

/** Que hace OAF cuando cambia este elemento (o se pulsa este boton). */
export function tipoDeAccion(el) {
  const codigo = `${el?.getAttribute?.('onchange') || ''} ${el?.getAttribute?.('onclick') || ''}`;
  if (/submitForm\(/.test(codigo) && !/_uixspu\(/.test(codigo)) return ACCION.NAVEGA;
  if (/_uixspu\(|_LovInputVTF\(/.test(codigo)) return ACCION.PPR;
  return ACCION.NADA;
}

function esperarEvento(objetivo, evento, timeout, signal) {
  return new Promise((resolve) => {
    const fin = (valor) => { clearTimeout(timer); objetivo.removeEventListener(evento, onEvento); signal?.removeEventListener('abort', onAbort); resolve(valor); };
    const onEvento = () => fin(true);
    const onAbort = () => fin(false);
    const timer = setTimeout(() => fin(false), timeout);
    objetivo.addEventListener(evento, onEvento, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Espera lo que corresponda a `accion` (el elemento que se toco). Llamar
 * DESPUES de disparar la accion pero en el mismo turno: el `load` del PPR llega
 * como minimo 1.5 s despues, asi que no se pierde.
 *
 * @param {Element} el
 * @param {object} [o]
 * @param {AbortSignal} [o.signal]
 * @param {string} [o.description]
 * @returns {Promise<string>} el tipo de accion esperado
 */
export async function esperarAccion(el, { signal, description = 'la respuesta de GEVS' } = {}) {
  const tipo = tipoDeAccion(el);
  if (tipo === ACCION.NAVEGA) {
    await esperarEvento(window, 'pagehide', NAVEGACION_TIMEOUT_MS, signal);
    return tipo;
  }
  if (tipo === ACCION.PPR) {
    const iframe = document.querySelector(PPR_IFRAME);
    if (!iframe) throw new Error('No esta el iframe de PPR (_pprIFrame): esta no parece una pantalla de OAF.');
    const llego = await esperarEvento(iframe, 'load', PPR_TIMEOUT_MS, signal);
    if (!llego && !signal?.aborted) throw new WaitTimeoutError(`Timeout (${PPR_TIMEOUT_MS}ms) esperando ${description}`);
    await sleep(PPR_SETTLE_MS, signal);
    return tipo;
  }
  await sleep(PPR_SETTLE_MS, signal);
  return tipo;
}
