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
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('colocar-tags:product');

/**
 * Captura un snapshot del estado de las filas de Product Tag para diagnóstico.
 * Lo logueamos en momentos clave (antes/después de cada fase) para entender
 * qué ve realmente el DOM cuando aparece "No changes were made.".
 */
function snapshotTagRows() {
  const rows = [];
  for (let i = 1; i <= 2; i++) {
    const chk      = document.querySelector(PT.chk(i));
    const catSel   = document.querySelector(PT.categorySel(i));
    const groupIn  = document.querySelector(PT.groupInput(i));
    const valueIn  = document.querySelector(PT.valueInput(i));
    const typeSel  = document.querySelector(PT.typeSel(i));
    const useFlag  = document.querySelector(PT.useFlag(i));
    const userType = document.querySelector(PT.userType(i));
    const bDay     = document.querySelector(PT.beginDay(i));
    const bTime    = document.querySelector(PT.beginTime(i));
    const eDay     = document.querySelector(PT.endDay(i));
    const eTime    = document.querySelector(PT.endTime(i));

    rows.push({
      tagIndex:    i,
      rowChk:      chk      ? chk.checked       : '<missing>',
      category:    catSel   ? catSel.value      : '<missing>',
      group:       groupIn  ? groupIn.value     : '<missing>',
      tag:         valueIn  ? valueIn.value     : '<missing>',
      type:        typeSel  ? typeSel.value     : '<missing>',
      typeOptions: typeSel
        ? Array.from(typeSel.options).map((o) => o.value + (o.hidden ? '(hidden)' : ''))
        : '<missing>',
      typePtrEvents: typeSel ? typeSel.style.pointerEvents || '<default>' : '<missing>',
      useFlag:     useFlag  ? useFlag.checked   : '<missing>',
      userType:    userType ? userType.value    : '<missing>',
      beginDay:    bDay     ? bDay.value        : '<missing>',
      beginTime:   bTime    ? bTime.value       : '<missing>',
      endDay:      eDay     ? eDay.value        : '<missing>',
      endTime:     eTime    ? eTime.value       : '<missing>',
    });
  }
  return rows;
}

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

  log.info('applyProductTags START', {
    tagCount: tags.length,
    skipProd,
    userType,
    tags: tags.map((t, i) => ({
      idx: i + 1,
      category: t.category,
      group: t.group,
      tag: t.tag,
      type: t.type,
      schedule: `${t.beginDay} ${t.beginTime} → ${t.endDay} ${t.endTime}`,
    })),
  });
  log.debug('snapshot pre-fase1', snapshotTagRows());

  // FASE 1: llenar todos los campos de cada fila en orden (1 → 2), SIN marcar
  // el checkbox de la fila todavía. El "row chk" (#productTagNChk) es lo que
  // le indica a GP1 "esta fila tiene data nueva, inclúyela en el save". Si
  // lo marcamos al principio, GP1 toma snapshot del estado vacío y al
  // formSubmit() detecta "no changes". Marcarlo al final actúa como el commit
  // explícito de la fila (igual a como lo hace un usuario humano).
  for (let i = 0; i < tags.length; i++) {
    const tagIndex = i + 1;
    const tag = tags[i];
    log.info(`FASE 1 — llenando fila ${tagIndex}`, { category: tag.category, group: tag.group, tag: tag.tag, type: tag.type });
    await fillTagRow({ tagIndex, tag, userType, onStep, signal });
  }
  log.debug('snapshot post-fase1', snapshotTagRows());

  // FASE 2: re-setear los Type. El handler de `productTagCategory2.on('change')`
  // (ver Pedida.md líneas 11691-11713) PISA `productTag1Type` según la
  // combinación cat1/cat2 (ej. si cat1='Promotion' y cat2='Product' fuerza
  // Tag1.Type='gradient'). Cuando se aplican 2 tags, el seteo de Tag1.Type
  // dentro de fillTagRow(1) queda invalidado al setear cat2 en fillTagRow(2).
  // Reaplicar al final garantiza el valor que pidió el usuario.
  for (let i = 0; i < tags.length; i++) {
    const tagIndex = i + 1;
    const typeSel = await waitForElement(PT.typeSel(tagIndex), { signal });
    const before = typeSel.value;
    setSelectValue(typeSel, tags[i].type);
    log.info(`FASE 2 — Tag ${tagIndex} Type re-aplicado`, {
      before,
      target: tags[i].type,
      after: typeSel.value,
      options: Array.from(typeSel.options).map((o) => o.value),
      pointerEvents: typeSel.style.pointerEvents || '<default>',
    });
  }

  // FASE 3: marcar los checkboxes de fila al final, en orden, con respiro
  // entre cada uno para que GP1 registre la "inclusión" de cada fila antes
  // de que entre la siguiente (y antes del formSubmit).
  for (let i = 0; i < tags.length; i++) {
    const tagIndex = i + 1;
    onStep(STEPS.PROD_CHECK_ROW, { tagIndex });
    const rowChk = await waitForElement(PT.chk(tagIndex), { signal });
    const before = rowChk.checked;
    setChecked(rowChk, true);
    log.info(`FASE 3 — Tag ${tagIndex} rowChk marcado`, {
      selector: PT.chk(tagIndex),
      before,
      after: rowChk.checked,
      disabled: rowChk.disabled,
    });
    await sleep(150, signal);
  }

  // FASE 4 — "dirty trigger" sobre #productTag2Chk.
  //
  // Bug observado de GP1: marcar `#productTag1Chk` (y llenar la fila 1) no le
  // alcanza al dirty-tracking de `formSubmit()` para reconocer cambios — sigue
  // saliendo "No changes were made.". Pero si se toca `#productTag2Chk`, GP1
  // SÍ reconoce los cambios y guarda la fila 1 normal. Lo descubrió el
  // usuario probando manualmente.
  //
  // Estrategia: toggle de `productTag2Chk` (ON→OFF si estaba off, o OFF→ON si
  // ya estaba on porque hay 2 tags). El estado final queda igual que antes
  // del toggle, así que no agregamos ni quitamos data — solo destrabamos el
  // dirty flag.
  await dirtyTriggerTag2({ signal });

  log.debug('snapshot pre-save', snapshotTagRows());

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
  const catBefore = catSel.value;
  setSelectValue(catSel, category);
  log.debug(`fila ${tagIndex} → category`, {
    selector: PT.categorySel(tagIndex),
    before: catBefore,
    target: category,
    after: catSel.value,
    optionsAvailable: Array.from(catSel.options).map((o) => o.value),
  });
  // El siguiente combo (group) se populates dependiente de category — sleep corto.
  await sleep(150, signal);

  // 2. Group (combobox, depende de category — opciones dinámicas de GP1)
  onStep(STEPS.PROD_GROUP, { tagIndex, group });
  log.debug(`fila ${tagIndex} → group: abriendo combobox`, { target: group });
  const groupResult = await selectComboboxByInput({
    inputSelector: PT.groupInput(tagIndex),
    label: group,
    signal,
  });
  log.debug(`fila ${tagIndex} → group seleccionado`, {
    matchType: groupResult.matchType,
    inputValue: document.querySelector(PT.groupInput(tagIndex))?.value,
  });
  await sleep(150, signal);

  // 3. Tag value (combobox, depende de group)
  onStep(STEPS.PROD_TAG_VALUE, { tagIndex, tag: tagValue });
  log.debug(`fila ${tagIndex} → tag-value: abriendo combobox`, { target: tagValue });
  const valueResult = await selectComboboxByInput({
    inputSelector: PT.valueInput(tagIndex),
    label: tagValue,
    signal,
  });
  log.debug(`fila ${tagIndex} → tag-value seleccionado`, {
    matchType: valueResult.matchType,
    inputValue: document.querySelector(PT.valueInput(tagIndex))?.value,
  });

  // 4. Type (select: gradient/solid/line). NOTA: si hay 2 tags, el handler de
  // cat2 puede pisar este valor — el orquestador lo re-setea en FASE 2 luego
  // de llenar ambas filas.
  onStep(STEPS.PROD_TYPE, { tagIndex, type });
  const typeSel = await waitForElement(PT.typeSel(tagIndex), { signal });
  const typeBefore = typeSel.value;
  setSelectValue(typeSel, type);
  log.debug(`fila ${tagIndex} → type`, {
    before: typeBefore,
    target: type,
    after: typeSel.value,
    options: Array.from(typeSel.options).map((o) => o.value + (o.hidden ? '(hidden)' : '')),
    pointerEvents: typeSel.style.pointerEvents || '<default>',
  });

  // 5. User Type — siempre "ALL" salvo override (el visible es `select#useTypeN`)
  onStep(STEPS.PROD_USER_TYPE, { tagIndex, userType });
  const userTypeSel = await waitForElement(PT.userType(tagIndex), { signal });
  setSelectValue(userTypeSel, userType);
  log.debug(`fila ${tagIndex} → userType=${userTypeSel.value}`);

  // 6. Schedule — vía setDateRange para evitar el rebote por orden de seteo
  // (ver gp1/daterange.js).
  onStep(STEPS.PROD_DATES, { tagIndex, beginDay, beginTime, endDay, endTime });
  const beginDayEl  = await waitForElement(PT.beginDay(tagIndex),  { signal });
  const beginTimeEl = await waitForElement(PT.beginTime(tagIndex), { signal });
  const endDayEl    = await waitForElement(PT.endDay(tagIndex),    { signal });
  const endTimeEl   = await waitForElement(PT.endTime(tagIndex),   { signal });
  setDateRange({ beginDayEl, beginTimeEl, endDayEl, endTimeEl, beginDay, beginTime, endDay, endTime });
  log.debug(`fila ${tagIndex} → schedule`, {
    beginDay:  beginDayEl.value,
    beginTime: beginTimeEl.value,
    endDay:    endDayEl.value,
    endTime:   endTimeEl.value,
  });

  // 7. Use flag (#productTagNUseFlag) — marca la fila como "activa"
  onStep(STEPS.PROD_USE, { tagIndex });
  const useChk = await waitForElement(PT.useFlag(tagIndex), { signal });
  const useFlagBefore = useChk.checked;
  setChecked(useChk, true);
  log.debug(`fila ${tagIndex} → useFlag`, { before: useFlagBefore, after: useChk.checked });

  onStep(STEPS.PROD_TAG_DONE, { tagIndex });
}

// Texto que aparece en el messagebox cuando GP1 considera que no hay cambios.
// Lo dejamos en lower-case porque comparamos con includes case-insensitive.
const NO_CHANGES_TEXT = 'no changes were made';

/**
 * Marca `#productTag2Chk` y LO DEJA marcado para forzar el dirty-tracking de
 * GP1. Si ya estaba marcado (caso 2 tags), hace un OFF→ON para garantizar
 * que el change event final sea unchecked→checked (el que GP1 detecta).
 *
 * Comportamiento observado del bug: hay que dejar `productTag2Chk` marcado
 * AL MOMENTO DE `formSubmit()` para que GP1 reconozca cambios — un toggle
 * que vuelva al estado original no sirve, GP1 compara estado actual vs
 * snapshot inicial. GP1 ignora silenciosamente la fila 2 si no tiene tag
 * value, así que dejarla marcada con campos vacíos es seguro.
 *
 * Ver CLAUDE.md → "Quirk crítico — dirty trigger via productTag2Chk".
 */
async function dirtyTriggerTag2({ signal }) {
  const tag2Chk = await waitForElement(PT.chk(2), { signal, timeout: 1500 }).catch(() => null);
  if (!tag2Chk) {
    log.warn('FASE 4 — productTag2Chk no encontrado, skipping dirty trigger');
    return;
  }
  const startState = tag2Chk.checked;
  log.info('FASE 4 — dirty trigger sobre #productTag2Chk', { startState, selector: PT.chk(2) });

  if (tag2Chk.checked) {
    // Caso 2 tags: ya está marcado de FASE 3. Toggle OFF→ON para que el
    // último change event tenga la transición que GP1 quiere ver.
    setChecked(tag2Chk, false);
    log.debug('  toggle OFF', { actual: tag2Chk.checked });
    await sleep(120, signal);
  }
  setChecked(tag2Chk, true);
  log.debug('  toggle ON', { actual: tag2Chk.checked, expected: true });
  await sleep(200, signal);

  if (!tag2Chk.checked) {
    log.error('FASE 4 — productTag2Chk NO quedó marcado tras setChecked(true)', {
      disabled: tag2Chk.disabled,
      hidden: tag2Chk.hidden,
      offsetParent: tag2Chk.offsetParent === null ? 'null (oculto)' : 'visible',
    });
  }
}

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
    log.info(`performSave attempt ${attempt + 1}/${maxRetries + 1}`, {
      saveBtnSelector,
      activeElement: document.activeElement?.tagName + (document.activeElement?.id ? `#${document.activeElement.id}` : ''),
    });

    // Blur del elemento activo: en Chrome el blur de algunos widgets sólo
    // se ejecuta cuando el focus se mueve. Si el último campo seteado quedó
    // enfocado, el commit de su value puede ser perezoso.
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      try { document.activeElement.blur(); } catch { /* noop */ }
    }
    await sleep(150, signal);

    onStep(stepSave, attempt > 0 ? { retry: attempt } : undefined);
    const saveBtn = await waitForElement(saveBtnSelector, { signal });
    log.debug('clickeando save', {
      saveBtn: saveBtn.outerHTML.slice(0, 200),
      tag1Chk:  document.querySelector(PT.chk(1))?.checked,
      tag2Chk:  document.querySelector(PT.chk(2))?.checked,
      tag1Val:  document.querySelector(PT.valueInput(1))?.value,
      tag2Val:  document.querySelector(PT.valueInput(2))?.value,
    });
    saveBtn.click();

    const outcome = await waitForSaveOutcomeMessagebox({ signal });
    log.info(`performSave outcome=${outcome.kind}`);

    if (outcome.kind === 'confirm') {
      onStep(stepConfirm);
      await clickMessageboxButton('YES', { bodyContains: MSGBOX_TEXTS.CONFIRM_SAVE, signal });
      onStep(stepAck);
      await clickMessageboxButton('OK', { bodyContains: successText, signal });
      log.info('performSave ✓ confirmado y ack OK');
      return;
    }

    // outcome.kind === 'nochange' → cerrar y reintentar (excepto si fue el último intento).
    log.warn(`performSave: "No changes were made." en attempt ${attempt + 1} — dismissando y ${attempt < maxRetries ? 'reintentando' : 'fallando'}`);
    await clickMessageboxButton('OK', { bodyContains: NO_CHANGES_TEXT, signal });
    await sleep(300, signal);

    if (attempt === maxRetries) {
      log.error('performSave: dirty-tracking persistente — snapshot al momento del fallo', snapshotTagRows());
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
