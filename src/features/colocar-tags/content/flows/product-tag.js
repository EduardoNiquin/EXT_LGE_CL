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
import { setChecked, setSelectValue } from '../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../shared/dom/wait.js';
import { selectComboboxByInput, ComboboxOptionNotFoundError } from '../gp1/combobox.js';
import {
  clickMessageboxButton,
  waitForNoMessagebox,
  getTopMessagebox,
  getMessageboxBodyText,
} from '../gp1/messagebox.js';
import { waitForModalClosed } from '../gp1/modal.js';
import { setDateRange } from '../gp1/daterange.js';
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

  // FASE 1: llenar todos los campos de cada fila en orden (1 → 2), SIN marcar
  // el checkbox de la fila todavía. El "row chk" (#productTagNChk) es lo que
  // le indica a GP1 "esta fila tiene data nueva, inclúyela en el save". Si
  // lo marcamos al principio, GP1 toma snapshot del estado vacío y al
  // formSubmit() detecta "no changes". Marcarlo al final actúa como el commit
  // explícito de la fila (igual a como lo hace un usuario humano).
  for (let i = 0; i < tags.length; i++) {
    const tagIndex = i + 1;
    const tag = tags[i];
    await fillTagRow({ tagIndex, tag, userType, onStep, signal });
  }

  // FASE 2: re-setear los Type. El handler de `productTagCategory2.on('change')`
  // (ver Pedida.md líneas 11691-11713) PISA `productTag1Type` según la
  // combinación cat1/cat2 (ej. si cat1='Promotion' y cat2='Product' fuerza
  // Tag1.Type='gradient'). Cuando se aplican 2 tags, el seteo de Tag1.Type
  // dentro de fillTagRow(1) queda invalidado al setear cat2 en fillTagRow(2).
  // Reaplicar al final garantiza el valor que pidió el usuario.
  for (let i = 0; i < tags.length; i++) {
    const tagIndex = i + 1;
    const typeSel = await waitForElement(PT.typeSel(tagIndex), { signal });
    setSelectValue(typeSel, tags[i].type);
  }

  // FASE 3: marcar los checkboxes de fila al final, en orden, con respiro
  // entre cada uno para que GP1 registre la "inclusión" de cada fila antes
  // de que entre la siguiente (y antes del formSubmit).
  for (let i = 0; i < tags.length; i++) {
    const tagIndex = i + 1;
    onStep(STEPS.PROD_CHECK_ROW, { tagIndex });
    const rowChk = await waitForElement(PT.chk(tagIndex), { signal });
    setChecked(rowChk, true);
    await sleep(150, signal);
  }

  // Pequeño respiro extra para que los datepickers comitearon sus valores.
  await sleep(200, signal);

  // === STG ===
  await performSave({
    saveBtnSelector: SELECTORS.saveStg,
    successText: MSGBOX_TEXTS.SUCCESS_STG,
    stepSave: STEPS.PROD_SAVE_STG,
    stepConfirm: STEPS.PROD_CONFIRM_STG,
    stepAck: STEPS.PROD_ACK_STG,
    onStep,
    signal,
  });

  // === PROD ===
  if (skipProd) {
    onStep(STEPS.DONE, { skippedProd: true });
    return { ok: true, skippedProd: true };
  }

  await waitForNoMessagebox({ signal, timeout: 5000 }).catch(() => null);

  await performSave({
    saveBtnSelector: SELECTORS.saveProd,
    successText: MSGBOX_TEXTS.SUCCESS_PROD,
    stepSave: STEPS.PROD_SAVE_PROD,
    stepConfirm: STEPS.PROD_CONFIRM_PROD,
    stepAck: STEPS.PROD_ACK_PROD,
    onStep,
    signal,
  });

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

  // OJO: el row chk (#productTagNChk) NO se marca acá — se marca después en
  // FASE 3 del orquestador. Marcarlo antes hace que GP1 considere "no
  // changes" al formSubmit().

  // 1. 1st Category (select normal: Product/Promotion)
  onStep(STEPS.PROD_CATEGORY, { tagIndex, category });
  const catSel = await waitForElement(PT.categorySel(tagIndex), { signal });
  setSelectValue(catSel, category);
  // El siguiente combo (group) se populates dependiente de category — sleep corto.
  await sleep(150, signal);

  // 2. Group (combobox, depende de category — opciones dinámicas de GP1)
  onStep(STEPS.PROD_GROUP, { tagIndex, group });
  await selectComboboxByInput({
    inputSelector: PT.groupInput(tagIndex),
    label: group,
    signal,
  });
  await sleep(150, signal);

  // 3. Tag value (combobox, depende de group)
  onStep(STEPS.PROD_TAG_VALUE, { tagIndex, tag: tagValue });
  await selectComboboxByInput({
    inputSelector: PT.valueInput(tagIndex),
    label: tagValue,
    signal,
  });

  // 4. Type (select: gradient/solid/line). NOTA: si hay 2 tags, el handler de
  // cat2 puede pisar este valor — el orquestador lo re-setea en FASE 2 luego
  // de llenar ambas filas.
  onStep(STEPS.PROD_TYPE, { tagIndex, type });
  const typeSel = await waitForElement(PT.typeSel(tagIndex), { signal });
  setSelectValue(typeSel, type);

  // 5. User Type — siempre "ALL" salvo override (el visible es `select#useTypeN`)
  onStep(STEPS.PROD_USER_TYPE, { tagIndex, userType });
  const userTypeSel = await waitForElement(PT.userType(tagIndex), { signal });
  setSelectValue(userTypeSel, userType);

  // 6. Schedule — vía setDateRange para evitar el rebote por orden de seteo
  // (ver gp1/daterange.js).
  onStep(STEPS.PROD_DATES, { tagIndex, beginDay, beginTime, endDay, endTime });
  const beginDayEl  = await waitForElement(PT.beginDay(tagIndex),  { signal });
  const beginTimeEl = await waitForElement(PT.beginTime(tagIndex), { signal });
  const endDayEl    = await waitForElement(PT.endDay(tagIndex),    { signal });
  const endTimeEl   = await waitForElement(PT.endTime(tagIndex),   { signal });
  setDateRange({ beginDayEl, beginTimeEl, endDayEl, endTimeEl, beginDay, beginTime, endDay, endTime });

  // 7. Use flag (#productTagNUseFlag) — marca la fila como "activa"
  onStep(STEPS.PROD_USE, { tagIndex });
  const useChk = await waitForElement(PT.useFlag(tagIndex), { signal });
  setChecked(useChk, true);

  onStep(STEPS.PROD_TAG_DONE, { tagIndex });
}

// Texto que aparece en el messagebox cuando GP1 considera que no hay cambios.
// Lo dejamos en lower-case porque comparamos con includes case-insensitive.
const NO_CHANGES_TEXT = 'no changes were made';

/**
 * Espera a que aparezca uno de los 2 messageboxes posibles después de clickear
 * SAVE: el de CONFIRM (los "all selected rows of information" → YES/NO) o el
 * de "No changes were made." (sólo OK).
 */
async function waitForSaveOutcomeMessagebox({ signal, timeout = 15000 }) {
  return waitFor(
    () => {
      const box = getTopMessagebox();
      if (!box) return null;
      const text = getMessageboxBodyText(box).toLowerCase();
      if (text.includes(MSGBOX_TEXTS.CONFIRM_SAVE.toLowerCase())) {
        return { kind: 'confirm' };
      }
      if (text.includes(NO_CHANGES_TEXT)) {
        return { kind: 'nochange' };
      }
      return null;
    },
    { description: 'messagebox post-save (confirm | nochange)', timeout, signal },
  );
}

/**
 * Click SAVE → maneja el outcome con retry para el caso "No changes were made.".
 *
 * Background: GP1 a veces reporta "No changes were made." en el primer
 * `formSubmit()` aunque los campos estén llenos correctamente (el usuario
 * verificó que un click manual en SAVE inmediatamente después funciona).
 * Sospechamos que el dirty-tracking de GP1 depende del orden/trust de los
 * eventos sintéticos. La solución pragmática: si aparece ese messagebox,
 * lo cerramos y reintentamos una vez — emula exactamente lo que hace el
 * usuario para destrabarlo.
 */
async function performSave({
  saveBtnSelector,
  successText,
  stepSave,
  stepConfirm,
  stepAck,
  onStep,
  signal,
  maxRetries = 1,
}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Blur del elemento activo: en Chrome el blur de algunos widgets sólo
    // se ejecuta cuando el focus se mueve. Si el último campo seteado quedó
    // enfocado, el commit de su value puede ser perezoso.
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      try { document.activeElement.blur(); } catch { /* noop */ }
    }
    await sleep(150, signal);

    onStep(stepSave, attempt > 0 ? { retry: attempt } : undefined);
    const saveBtn = await waitForElement(saveBtnSelector, { signal });
    saveBtn.click();

    const outcome = await waitForSaveOutcomeMessagebox({ signal });

    if (outcome.kind === 'confirm') {
      onStep(stepConfirm);
      await clickMessageboxButton('YES', { bodyContains: MSGBOX_TEXTS.CONFIRM_SAVE, signal });
      onStep(stepAck);
      await clickMessageboxButton('OK', { bodyContains: successText, signal });
      return;
    }

    // outcome.kind === 'nochange' → cerrar y reintentar (excepto si fue el último intento).
    await clickMessageboxButton('OK', { bodyContains: NO_CHANGES_TEXT, signal });
    await sleep(300, signal);

    if (attempt === maxRetries) {
      throw new Error(
        'GP1 reportó "No changes were made." de forma persistente — ' +
        'el modal quedó visualmente con los campos correctos pero el save no se commiteó.',
      );
    }
  }
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
