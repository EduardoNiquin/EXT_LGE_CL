// Content script de "Facturas". Corre en todos los frames: el que reconoce la
// pantalla de Complex Voucher responde al popup y ejecuta la corrida; los
// demas (LOV, iframe de upload, Inquiry) hacen su parte desde el mismo tick.

import { MESSAGES, PANTALLA, STORAGE_KEYS } from '../constants.js';
import { diagnose } from './detector.js';
import { abortActiveRun, tickIfActive } from './flows/run.js';
import { wireReloadTickLifecycle } from '../../../shared/run-store/index.js';
import { logger } from '../../../shared/utils/logger.js';

const log = logger('facturas');

function handleMessage(message, _sender, sendResponse) {
  if (message?.type !== MESSAGES.GET_PAGE_DATA) return false;
  const diag = diagnose();
  if (diag.pantalla === PANTALLA.ENTRY) {
    sendResponse({ ok: true, ...diag });
    return true;
  }
  // Este frame no tiene la pantalla: se le da tiempo al que si (el iframe) a
  // contestar primero; si nadie lo hizo, vale el diagnostico de este.
  setTimeout(() => {
    try { sendResponse({ ok: false, reason: 'no es la pantalla de Complex Voucher', ...diag }); } catch { /* canal cerrado */ }
  }, diag.isTopFrame ? 200 : 80);
  return true;
}

export function init() {
  chrome.runtime.onMessage.addListener(handleMessage);
  wireReloadTickLifecycle({ runKey: STORAGE_KEYS.RUN, tickIfActive, abortActiveRun, delay: 300, topFrameOnly: false, log });
}
