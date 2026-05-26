import { SELECTORS, STEPS, MSGBOX_TEXTS } from '../../constants.js';
import { setInputValue, setChecked, setSelectValue } from '../../../../shared/dom/events.js';
import { waitForElement, sleep } from '../../../../shared/dom/wait.js';
import { selectComboboxOption } from '../gp1/combobox.js';
import {
  clickMessageboxButton,
  waitForNoMessagebox,
} from '../gp1/messagebox.js';
import { waitForModalClosed } from '../gp1/modal.js';
import { validateDateTimeRange } from '../validators.js';

/**
 * Aplica un Tag de Delivery dentro del modal de Marketing Info abierto.
 * Asume que `searchProductBySku` ya abrió el modal.
 *
 * Pasos (ver Pedida.md):
 *   1. Marcar checkbox de la fila Delivery (#deliveryTagChk)
 *   2. Seleccionar tag en combobox cb2 ("Despacho Gratis RM" por default)
 *   3. Marcar #deliveryTagUseFlag
 *   4. Setear #deliveryTagUserType = 'ALL'
 *   5. Setear las 4 fechas/horas
 *   6. Click "SAVE TO STG" → confirm YES → ack OK
 *   7. (Opcional, si !skipProd) Click "SAVE TO PROD" → confirm YES → ack OK
 *
 * @param {object} args
 * @param {string} args.tagLabel
 * @param {string} args.beginDay   formato YYYY-MM-DD
 * @param {string} args.beginTime  formato HH:MM
 * @param {string} args.endDay
 * @param {string} args.endTime
 * @param {boolean} [args.skipProd=true]
 * @param {string} [args.userType='ALL']
 * @param {(step: string, detail?: object) => void} [args.onStep]
 * @param {AbortSignal} [args.signal]
 */
export async function applyDeliveryTag(args) {
  const {
    tagLabel,
    beginDay,
    beginTime,
    endDay,
    endTime,
    skipProd = true,
    userType = 'ALL',
    onStep = () => {},
    signal,
  } = args;

  validateInputs(args);

  onStep(STEPS.DELIV_CHECK_ROW);
  const rowChk = await waitForElement(SELECTORS.deliveryRowChk, { signal });
  setChecked(rowChk, true);

  onStep(STEPS.DELIV_SELECT_TAG, { tagLabel });
  await selectComboboxOption({
    inputSelector:   SELECTORS.deliveryTagInput,
    buttonSelector:  SELECTORS.deliveryComboBtn,
    listboxSelector: SELECTORS.deliveryListbox,
    label:           tagLabel,
    signal,
  });

  onStep(STEPS.DELIV_CHECK_USE);
  const useChk = await waitForElement(SELECTORS.deliveryUseFlag, { signal });
  setChecked(useChk, true);

  onStep(STEPS.DELIV_USER_TYPE, { userType });
  const userTypeSel = await waitForElement(SELECTORS.deliveryUserType, { signal });
  setSelectValue(userTypeSel, userType);

  onStep(STEPS.DELIV_DATES, { beginDay, beginTime, endDay, endTime });
  const beginDayEl  = await waitForElement(SELECTORS.deliveryBeginDay,  { signal });
  const beginTimeEl = await waitForElement(SELECTORS.deliveryBeginTime, { signal });
  const endDayEl    = await waitForElement(SELECTORS.deliveryEndDay,    { signal });
  const endTimeEl   = await waitForElement(SELECTORS.deliveryEndTime,   { signal });
  setInputValue(beginDayEl,  beginDay);
  setInputValue(beginTimeEl, beginTime);
  setInputValue(endDayEl,    endDay);
  setInputValue(endTimeEl,   endTime);

  // Le damos un respiro al widget de fechas (datePick) por si tiene validación async.
  await sleep(200, signal);

  // === STG ===
  onStep(STEPS.DELIV_SAVE_STG);
  const saveStg = await waitForElement(SELECTORS.saveStg, { signal });
  saveStg.click();

  onStep(STEPS.DELIV_CONFIRM_STG);
  await clickMessageboxButton('YES', { bodyContains: MSGBOX_TEXTS.CONFIRM_SAVE, signal });

  onStep(STEPS.DELIV_ACK_STG);
  await clickMessageboxButton('OK', { bodyContains: MSGBOX_TEXTS.SUCCESS_STG, signal });

  // === PROD ===
  if (skipProd) {
    onStep(STEPS.DONE, { skippedProd: true });
    return { ok: true, skippedProd: true };
  }

  await waitForNoMessagebox({ signal, timeout: 5000 }).catch(() => null);

  onStep(STEPS.DELIV_SAVE_PROD);
  const saveProd = await waitForElement(SELECTORS.saveProd, { signal });
  saveProd.click();

  onStep(STEPS.DELIV_CONFIRM_PROD);
  await clickMessageboxButton('YES', { bodyContains: MSGBOX_TEXTS.CONFIRM_SAVE, signal });

  onStep(STEPS.DELIV_ACK_PROD);
  await clickMessageboxButton('OK', { bodyContains: MSGBOX_TEXTS.SUCCESS_PROD, signal });

  // Esperar a que cierren modales para no chocar con el próximo SKU.
  await waitForNoMessagebox({ signal, timeout: 5000 }).catch(() => null);
  await waitForModalClosed({ signal, timeout: 5000 }).catch(() => null);

  onStep(STEPS.DONE, { skippedProd: false });
  return { ok: true, skippedProd: false };
}

function validateInputs({ tagLabel, beginDay, beginTime, endDay, endTime }) {
  if (!tagLabel) throw new Error('tagLabel requerido');
  validateDateTimeRange({ prefix: 'Delivery', beginDay, beginTime, endDay, endTime });
}
