// Flujo: aplicar 1 ó 2 Product Tags dentro del modal "Marketing Info" abierto.
// Asume que `searchProductBySku` ya abrió el modal #dialog2.
//
// Por cada tag (1 ó 2), llena las 4 columnas de la fila correspondiente del
// bloque "LG Offer to display on PDP/PBP" — categoría/grupo/tag, type, use,
// user type, y la schedule (begin/end day/time). Después aplica el doble save
// (STG + PROD, opcional saltar PROD).
//
// Particularidades del DOM (ver Pedida.md):
//   - Los 3 selectores de la columna "Tag" son: select#productTagCategoryN +
//     combobox #productTagGroupN + combobox #productTagN. El group depende
//     de la category (sus opciones se populan al cambiar el primero) y el
//     tag depende del group. Por eso después de cada uno hay que esperar a
//     que el siguiente listbox tenga <li>.
//   - Los listboxes de los combos comparten id ("cb1-listbox" / "cb2-listbox"
//     en varios lugares) — usamos `selectComboboxByInput` que resuelve por
//     estructura DOM, no por id.
//   - El select visible de User Type es `select#useTypeN` (el de id
//     `productTagNUserType` es un hidden duplicado).

import {
  SELECTORS,
  STEPS,
  MSGBOX_TEXTS,
  PRODUCT_TAG_SELECTORS as PT,
  PRODUCT_TAG_CATEGORIES,
  PRODUCT_TAG_TYPES,
  PRODUCT_TAG_MAX,
} from '../../constants.js';
import { setChecked, setInputValue, setSelectValue } from '../../../../shared/dom/events.js';
import { sleep, waitForElement } from '../../../../shared/dom/wait.js';
import { selectComboboxByInput, ComboboxOptionNotFoundError } from '../gp1/combobox.js';
import {
  clickMessageboxButton,
  waitForNoMessagebox,
} from '../gp1/messagebox.js';
import { waitForModalClosed } from '../gp1/modal.js';
import { validateDateTimeRange } from '../validators.js';

// Re-export para que el handler que captura errores por SKU pueda
// distinguir esta clase sin tener que importar desde el módulo de combobox.
export { ComboboxOptionNotFoundError };

/**
 * @param {object} args
 * @param {Array<TagSpec>} args.tags  1 o 2 tags a aplicar. Cada uno: { category, group, tag, type, beginDay, beginTime, endDay, endTime }
 * @param {boolean} [args.skipProd=true]
 * @param {string} [args.userType='ALL']
 * @param {(step:string, detail?:object)=>void} [args.onStep]
 * @param {AbortSignal} [args.signal]
 */
export async function applyProductTags(args) {
  const {
    tags,
    skipProd = true,
    userType = 'ALL',
    onStep = () => {},
    signal,
  } = args;

  validateTags(tags);

  // Llenar cada fila en orden (1 primero, después 2).
  for (let i = 0; i < tags.length; i++) {
    const tagIndex = i + 1; // 1 ó 2
    const tag = tags[i];
    await fillTagRow({ tagIndex, tag, userType, onStep, signal });
  }

  // Pequeño respiro para asegurar que los datepickers comitearon sus valores.
  await sleep(250, signal);

  // === STG ===
  onStep(STEPS.PROD_SAVE_STG);
  const saveStg = await waitForElement(SELECTORS.saveStg, { signal });
  saveStg.click();

  onStep(STEPS.PROD_CONFIRM_STG);
  await clickMessageboxButton('YES', { bodyContains: MSGBOX_TEXTS.CONFIRM_SAVE, signal });

  onStep(STEPS.PROD_ACK_STG);
  await clickMessageboxButton('OK', { bodyContains: MSGBOX_TEXTS.SUCCESS_STG, signal });

  // === PROD ===
  if (skipProd) {
    onStep(STEPS.DONE, { skippedProd: true });
    return { ok: true, skippedProd: true };
  }

  await waitForNoMessagebox({ signal, timeout: 5000 }).catch(() => null);

  onStep(STEPS.PROD_SAVE_PROD);
  const saveProd = await waitForElement(SELECTORS.saveProd, { signal });
  saveProd.click();

  onStep(STEPS.PROD_CONFIRM_PROD);
  await clickMessageboxButton('YES', { bodyContains: MSGBOX_TEXTS.CONFIRM_SAVE, signal });

  onStep(STEPS.PROD_ACK_PROD);
  await clickMessageboxButton('OK', { bodyContains: MSGBOX_TEXTS.SUCCESS_PROD, signal });

  // El modal se cierra solo tras el último OK; lo confirmamos para no chocar
  // con el siguiente SKU.
  await waitForNoMessagebox({ signal, timeout: 5000 }).catch(() => null);
  await waitForModalClosed({ signal, timeout: 5000 }).catch(() => null);

  onStep(STEPS.DONE, { skippedProd: false });
  return { ok: true, skippedProd: false };
}

// -----------------------------------------------------------------------------
// internals
// -----------------------------------------------------------------------------

async function fillTagRow({ tagIndex, tag, userType, onStep, signal }) {
  const { category, group, tag: tagValue, type, beginDay, beginTime, endDay, endTime } = tag;

  // 1. Checkbox de la fila
  onStep(STEPS.PROD_CHECK_ROW, { tagIndex });
  const rowChk = await waitForElement(PT.chk(tagIndex), { signal });
  setChecked(rowChk, true);

  // 2. 1st Category (select normal: Product/Promotion)
  onStep(STEPS.PROD_CATEGORY, { tagIndex, category });
  const catSel = await waitForElement(PT.categorySel(tagIndex), { signal });
  setSelectValue(catSel, category);
  // El siguiente combo (group) se populates dependiente de category — sleep corto.
  await sleep(150, signal);

  // 3. Group (combobox, depende de category — opciones dinámicas de GP1)
  onStep(STEPS.PROD_GROUP, { tagIndex, group });
  await selectComboboxByInput({
    inputSelector: PT.groupInput(tagIndex),
    label: group,
    signal,
  });
  await sleep(150, signal);

  // 4. Tag value (combobox, depende de group)
  onStep(STEPS.PROD_TAG_VALUE, { tagIndex, tag: tagValue });
  await selectComboboxByInput({
    inputSelector: PT.valueInput(tagIndex),
    label: tagValue,
    signal,
  });

  // 5. Type (select: gradient/solid/line)
  onStep(STEPS.PROD_TYPE, { tagIndex, type });
  const typeSel = await waitForElement(PT.typeSel(tagIndex), { signal });
  setSelectValue(typeSel, type);

  // 6. Use checkbox
  onStep(STEPS.PROD_USE, { tagIndex });
  const useChk = await waitForElement(PT.useFlag(tagIndex), { signal });
  setChecked(useChk, true);

  // 7. User Type — siempre "ALL" salvo override
  onStep(STEPS.PROD_USER_TYPE, { tagIndex, userType });
  const userTypeSel = await waitForElement(PT.userType(tagIndex), { signal });
  setSelectValue(userTypeSel, userType);

  // 8. Schedule
  onStep(STEPS.PROD_DATES, { tagIndex, beginDay, beginTime, endDay, endTime });
  const beginDayEl  = await waitForElement(PT.beginDay(tagIndex),  { signal });
  const beginTimeEl = await waitForElement(PT.beginTime(tagIndex), { signal });
  const endDayEl    = await waitForElement(PT.endDay(tagIndex),    { signal });
  const endTimeEl   = await waitForElement(PT.endTime(tagIndex),   { signal });
  setInputValue(beginDayEl,  beginDay);
  setInputValue(beginTimeEl, beginTime);
  setInputValue(endDayEl,    endDay);
  setInputValue(endTimeEl,   endTime);

  onStep(STEPS.PROD_TAG_DONE, { tagIndex });
}

function validateTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error('Se requiere al menos 1 product tag');
  }
  if (tags.length > PRODUCT_TAG_MAX) {
    throw new Error(`Máximo ${PRODUCT_TAG_MAX} product tags por SKU`);
  }
  tags.forEach((t, i) => {
    const n = i + 1;
    if (!t || typeof t !== 'object') throw new Error(`Tag ${n} inválido`);
    if (!t.category) throw new Error(`Tag ${n}: category requerido`);
    if (!PRODUCT_TAG_CATEGORIES.includes(t.category)) {
      throw new Error(`Tag ${n}: category "${t.category}" no es válido. Opciones: ${PRODUCT_TAG_CATEGORIES.join(', ')}`);
    }
    if (!t.group)    throw new Error(`Tag ${n}: group requerido`);
    if (!t.tag)      throw new Error(`Tag ${n}: tag requerido`);
    if (!t.type)     throw new Error(`Tag ${n}: type requerido`);
    if (!PRODUCT_TAG_TYPES.includes(t.type)) {
      throw new Error(`Tag ${n}: type "${t.type}" no es válido. Opciones: ${PRODUCT_TAG_TYPES.join(', ')}`);
    }
    validateDateTimeRange({
      prefix: `Tag ${n}`,
      beginDay:  t.beginDay,
      beginTime: t.beginTime,
      endDay:    t.endDay,
      endTime:   t.endTime,
    });
  });
}
