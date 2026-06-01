// Flujo: aplicar 1 a 4 Tags de Oferta dentro del modal "Marketing Info" abierto.
// Asume que `searchProductBySku` ya abrió el modal #dialog2.
//
// La pantalla objetivo es la tabla "Additional Disclaimer Text" (ver Pedida.md):
// 4 filas fijas por tipo de oferta (1=Gift, 2=Discount, 3=Coupon, 4=Truck).
// Cada fila tiene: checkbox de selección (row chk), checkbox "Use", input de
// Description y dos inputs de fecha (Start/End Date, SIN hora).
//
// Por cada oferta que el usuario eligió:
//   1. Marcar el row chk (`#obsAdditionalDisclaimerText<N>Chk`) — esto le dice a
//      GP1 "esta fila cambió, inclúyela en el save". Es el dirty trigger.
//   2. Setear el checkbox "Use" (`...Flag`) según el toggle.
//   3. Setear la Description (`...Msg`) si se proporcionó.
//   4. Setear Start/End Date (`...StartDate` / `...EndDate`) si se proporcionaron.
// Después aplica el doble save (STG + PROD, opcional saltar PROD).
//
// Reutilizamos el patrón robusto de save de product-tag (`performSave` con
// retry ante "No changes were made.") como defensa en profundidad: es el mismo
// sistema GP1 y comparte sus quirks de dirty-tracking.

import { SELECTORS, STEPS, MSGBOX_TEXTS, OFFER_SELECTORS as OS, OFFER_MAX } from '../../constants.js';
import { setChecked, setInputValue } from '../../../../shared/dom/events.js';
import { sleep, waitFor, waitForElement } from '../../../../shared/dom/wait.js';
import {
  clickMessageboxButton,
  waitForNoMessagebox,
  getTopMessagebox,
  getMessageboxBodyText,
} from '../gp1/messagebox.js';
import { waitForModalClosed } from '../gp1/modal.js';
import { setDateOnlyRange } from '../gp1/daterange.js';
import { validateDateRange } from '../validators.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('colocar-tags:offer');

// Texto que aparece en el messagebox cuando GP1 considera que no hay cambios.
const NO_CHANGES_TEXT = 'no changes were made';

/**
 * Snapshot del estado de las 4 filas de oferta para diagnóstico.
 */
function snapshotOfferRows() {
  const rows = [];
  for (let i = 1; i <= OFFER_MAX; i++) {
    const chk   = document.querySelector(OS.rowChk(i));
    const flag  = document.querySelector(OS.useFlag(i));
    const msg   = document.querySelector(OS.msg(i));
    const start = document.querySelector(OS.startDate(i));
    const end   = document.querySelector(OS.endDate(i));
    rows.push({
      offerIndex: i,
      rowChk:     chk   ? chk.checked  : '<missing>',
      use:        flag  ? flag.checked : '<missing>',
      description: msg  ? msg.value     : '<missing>',
      startDate:  start ? start.value  : '<missing>',
      endDate:    end   ? end.value    : '<missing>',
    });
  }
  return rows;
}

/**
 * @param {object} args
 * @param {Array<OfferSpec>} args.offers  1..4 ofertas. Cada una:
 *   { index, label?, use, description, startDate, endDate }
 * @param {boolean} [args.skipProd=true]
 * @param {(step:string, detail?:object)=>void} [args.onStep]
 * @param {AbortSignal} [args.signal]
 */
export async function applyOfferTags(args) {
  const { offers, skipProd = true, onStep = () => {}, signal } = args;

  validateOffers(offers);

  log.info('applyOfferTags START', {
    count: offers.length,
    skipProd,
    offers: offers.map((o) => ({
      idx: o.index,
      label: o.label,
      use: o.use,
      hasDesc: Boolean(o.description),
      schedule: o.startDate || o.endDate ? `${o.startDate} → ${o.endDate}` : '(sin fechas)',
    })),
  });
  log.debug('snapshot pre-fill', snapshotOfferRows());

  // Llenar cada fila de oferta en orden de índice.
  for (const offer of offers) {
    if (signal?.aborted) break;
    await fillOfferRow({ offer, onStep, signal });
  }

  log.debug('snapshot pre-save', snapshotOfferRows());

  // Respiro para que los datepickers comiteen sus valores.
  await sleep(200, signal);

  // Dirty trigger reutilizable: re-marca (OFF→ON) los row chks de las ofertas
  // aplicadas justo antes de cada intento de save. Ver `dirtyTriggerOffers`.
  const dirtyNudge = () => dirtyTriggerOffers({ offers, signal });

  // === STG ===
  await performSave({
    saveBtnSelector: SELECTORS.saveStg,
    successText: MSGBOX_TEXTS.SUCCESS_STG,
    stepSave: STEPS.OFF_SAVE_STG,
    stepConfirm: STEPS.OFF_CONFIRM_STG,
    stepAck: STEPS.OFF_ACK_STG,
    dirtyNudge,
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
    stepSave: STEPS.OFF_SAVE_PROD,
    stepConfirm: STEPS.OFF_CONFIRM_PROD,
    stepAck: STEPS.OFF_ACK_PROD,
    dirtyNudge,
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

async function fillOfferRow({ offer, onStep, signal }) {
  const { index, label, use, description, startDate, endDate } = offer;
  const detail = { offerIndex: index, offerLabel: label };

  // 1. Row chk — SIEMPRE marcado para que GP1 detecte la fila en el save.
  onStep(STEPS.OFF_CHECK_ROW, detail);
  const rowChk = await waitForElement(OS.rowChk(index), { signal });
  const rowBefore = rowChk.checked;
  setChecked(rowChk, true);
  log.info(`fila ${index} (${label}) → rowChk`, {
    selector: OS.rowChk(index),
    before: rowBefore,
    after: rowChk.checked,
  });

  // 2. Use flag — según el toggle del usuario.
  onStep(STEPS.OFF_USE, { ...detail, use });
  const useFlag = await waitForElement(OS.useFlag(index), { signal });
  const useBefore = useFlag.checked;
  setChecked(useFlag, Boolean(use));
  log.debug(`fila ${index} → useFlag`, { before: useBefore, target: Boolean(use), after: useFlag.checked });

  // 3. Description (opcional).
  if (description != null && description !== '') {
    onStep(STEPS.OFF_DESC, detail);
    const msgEl = await waitForElement(OS.msg(index), { signal });
    setInputValue(msgEl, description);
    log.debug(`fila ${index} → description`, { length: description.length });
  }

  // 4. Fechas (opcionales; si vienen ambas, se setean con sentinel anti-rebote).
  if (startDate && endDate) {
    onStep(STEPS.OFF_DATES, { ...detail, startDate, endDate });
    const startEl = await waitForElement(OS.startDate(index), { signal });
    const endEl   = await waitForElement(OS.endDate(index),   { signal });
    setDateOnlyRange({ startEl, endEl, startDate, endDate });
    log.debug(`fila ${index} → fechas`, { start: startEl.value, end: endEl.value });
  }

  onStep(STEPS.OFF_ROW_DONE, detail);
}

/**
 * "Dirty trigger" para destrabar el dirty-tracking de GP1 (mismo bug que en
 * Product Tag: ver CLAUDE.md → "Quirk crítico — dirty trigger via
 * #productTag2Chk").
 *
 * Marcar el row chk una sola vez durante el llenado NO le alcanza a
 * `formSubmit()` para reconocer cambios — sigue saliendo "No changes were
 * made.". GP1 sólo registra el cambio cuando ve una transición fresca
 * `unchecked → checked` inmediatamente antes del submit. Por eso, justo antes
 * de cada intento de save, re-toggleamos (OFF→ON) el row chk de cada oferta
 * aplicada, dejándolo marcado.
 *
 * Sólo tocamos filas que el usuario está aplicando — nunca marcamos filas
 * vacías, así que es seguro (no se crean ofertas fantasma).
 */
async function dirtyTriggerOffers({ offers, signal }) {
  for (const offer of offers) {
    if (signal?.aborted) return;
    const chk = document.querySelector(OS.rowChk(offer.index));
    if (!chk) {
      log.warn(`dirty trigger: row chk de oferta ${offer.index} no encontrado`);
      continue;
    }
    // OFF→ON para garantizar que el último change event sea unchecked→checked.
    if (chk.checked) {
      setChecked(chk, false);
      await sleep(120, signal);
    }
    setChecked(chk, true);
    await sleep(120, signal);
    log.debug(`dirty trigger oferta ${offer.index} (${offer.label})`, { checked: chk.checked });
    if (!chk.checked) {
      log.error(`dirty trigger: row chk de oferta ${offer.index} NO quedó marcado`, {
        disabled: chk.disabled,
        offsetParent: chk.offsetParent === null ? 'null (oculto)' : 'visible',
      });
    }
  }
}

/**
 * Espera a que aparezca uno de los 2 messageboxes posibles tras SAVE:
 * el de CONFIRM ("all selected rows of information" → YES/NO) o el de
 * "No changes were made." (sólo OK).
 */
async function waitForSaveOutcomeMessagebox({ signal, timeout = 15000 }) {
  return waitFor(
    () => {
      const box = getTopMessagebox();
      if (!box) return null;
      const text = getMessageboxBodyText(box).toLowerCase();
      if (text.includes(MSGBOX_TEXTS.CONFIRM_SAVE.toLowerCase())) return { kind: 'confirm' };
      if (text.includes(NO_CHANGES_TEXT)) return { kind: 'nochange' };
      return null;
    },
    { description: 'messagebox post-save (confirm | nochange)', timeout, signal },
  );
}

/**
 * Click SAVE → maneja el outcome con retry ante "No changes were made."
 * (mismo patrón que product-tag: el dirty-tracking de GP1 a veces no detecta
 * los cambios al primer intento con eventos sintéticos; un re-click manual
 * destraba — lo emulamos).
 */
async function performSave({
  saveBtnSelector,
  successText,
  stepSave,
  stepConfirm,
  stepAck,
  dirtyNudge,
  onStep,
  signal,
  maxRetries = 2,
}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    log.info(`performSave attempt ${attempt + 1}/${maxRetries + 1}`, { saveBtnSelector });

    // Dirty trigger inmediatamente antes de cada click de save: re-marca los
    // row chks (OFF→ON) para que GP1 vea la transición fresca y reconozca
    // los cambios. Es lo que destraba el "No changes were made.".
    if (dirtyNudge) {
      try { await dirtyNudge(); } catch (err) { log.warn('dirtyNudge falló', err); }
    }

    // Blur del elemento activo para forzar el commit perezoso de datepickers.
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      try { document.activeElement.blur(); } catch { /* noop */ }
    }
    await sleep(150, signal);

    onStep(stepSave, attempt > 0 ? { retry: attempt } : undefined);
    const saveBtn = await waitForElement(saveBtnSelector, { signal });
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

    // outcome.kind === 'nochange' → cerrar y reintentar (salvo último intento).
    log.warn(`performSave: "No changes were made." en attempt ${attempt + 1} — ${attempt < maxRetries ? 'reintentando' : 'fallando'}`);
    await clickMessageboxButton('OK', { bodyContains: NO_CHANGES_TEXT, signal });
    await sleep(300, signal);

    if (attempt === maxRetries) {
      log.error('performSave: dirty-tracking persistente — snapshot al fallo', snapshotOfferRows());
      throw new Error(
        'GP1 reportó "No changes were made." de forma persistente — ' +
        'el modal quedó visualmente con las ofertas correctas pero el save no se commiteó.',
      );
    }
  }
}

function validateOffers(offers) {
  if (!Array.isArray(offers) || offers.length === 0) {
    throw new Error('Se requiere al menos 1 oferta');
  }
  if (offers.length > OFFER_MAX) {
    throw new Error(`Máximo ${OFFER_MAX} ofertas por SKU`);
  }
  const seen = new Set();
  offers.forEach((o) => {
    if (!o || typeof o !== 'object') throw new Error('Oferta inválida');
    if (!Number.isInteger(o.index) || o.index < 1 || o.index > OFFER_MAX) {
      throw new Error(`Oferta con index inválido: ${o.index}`);
    }
    if (seen.has(o.index)) throw new Error(`Oferta duplicada (index ${o.index})`);
    seen.add(o.index);
    // Las fechas son opcionales, pero si viene una debe venir la otra y ser válidas.
    if (o.startDate || o.endDate) {
      validateDateRange({
        prefix: `Oferta ${o.label || o.index}`,
        startDate: o.startDate,
        endDate: o.endDate,
      });
    }
  });
}
