// Flujo: QUITAR el Tag de Delivery dentro del modal "Marketing Info" abierto.
// Asume que `searchProductBySku` ya abrió el modal #dialog2.
//
// Es la operación inversa a `applyDeliveryTag`: para "quitar" el tag basta con
// desactivarlo. Pasos (indicados por el usuario):
//   1. Marcar el checkbox de la fila Delivery (#deliveryTagChk) — es el dirty
//      trigger que le dice a GP1 "esta fila cambió, inclúyela en el save".
//   2. DESMARCAR el checkbox "Use" (#deliveryTagUseFlag) — deja el tag inactivo.
//   3. Click "SAVE TO STG" → confirm YES → ack OK.
//   4. (Opcional, si !skipProd) Click "SAVE TO PROD" → confirm YES → ack OK.
//
// No se toca el combobox del tag ni las fechas: sólo desactivamos lo que haya.

import { SELECTORS, STEPS, MSGBOX_TEXTS } from '../../constants.js';
import { setChecked } from '../../../../shared/dom/events.js';
import { waitForElement, sleep } from '../../../../shared/dom/wait.js';
import { clickMessageboxButton, waitForNoMessagebox } from '../gp1/messagebox.js';
import { waitForModalClosed } from '../gp1/modal.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('colocar-tags:delivery-remove');

/**
 * @param {object} args
 * @param {boolean} [args.skipProd=true]
 * @param {(step: string, detail?: object) => void} [args.onStep]
 * @param {AbortSignal} [args.signal]
 */
export async function removeDeliveryTag(args = {}) {
  const { skipProd = true, onStep = () => {}, signal } = args;

  log.info('removeDeliveryTag START', { skipProd });

  // 1. Row chk — dirty trigger / inclusión de la fila en el save.
  onStep(STEPS.DELREM_CHECK_ROW);
  const rowChk = await waitForElement(SELECTORS.deliveryRowChk, { signal });
  setChecked(rowChk, true);
  log.debug('row chk marcado', { checked: rowChk.checked });

  // 2. Use flag — DESMARCAR para desactivar el tag.
  onStep(STEPS.DELREM_UNCHECK_USE);
  const useChk = await waitForElement(SELECTORS.deliveryUseFlag, { signal });
  const useBefore = useChk.checked;
  setChecked(useChk, false);
  log.debug('use flag desmarcado', { before: useBefore, after: useChk.checked });

  // Respiro para que GP1 procese el cambio de estado antes del submit.
  await sleep(200, signal);

  // === STG ===
  onStep(STEPS.DELREM_SAVE_STG);
  const saveStg = await waitForElement(SELECTORS.saveStg, { signal });
  saveStg.click();

  onStep(STEPS.DELREM_CONFIRM_STG);
  await clickMessageboxButton('YES', { bodyContains: MSGBOX_TEXTS.CONFIRM_SAVE, signal });

  onStep(STEPS.DELREM_ACK_STG);
  await clickMessageboxButton('OK', { bodyContains: MSGBOX_TEXTS.SUCCESS_STG, signal });

  // === PROD ===
  if (skipProd) {
    onStep(STEPS.DONE, { skippedProd: true });
    return { ok: true, skippedProd: true };
  }

  await waitForNoMessagebox({ signal, timeout: 5000 }).catch(() => null);

  onStep(STEPS.DELREM_SAVE_PROD);
  const saveProd = await waitForElement(SELECTORS.saveProd, { signal });
  saveProd.click();

  onStep(STEPS.DELREM_CONFIRM_PROD);
  await clickMessageboxButton('YES', { bodyContains: MSGBOX_TEXTS.CONFIRM_SAVE, signal });

  onStep(STEPS.DELREM_ACK_PROD);
  await clickMessageboxButton('OK', { bodyContains: MSGBOX_TEXTS.SUCCESS_PROD, signal });

  // Esperar a que cierren modales para no chocar con el próximo SKU.
  await waitForNoMessagebox({ signal, timeout: 5000 }).catch(() => null);
  await waitForModalClosed({ signal, timeout: 5000 }).catch(() => null);

  onStep(STEPS.DONE, { skippedProd: false });
  return { ok: true, skippedProd: false };
}
