// Corrida de "Crear Promo-Id": una promo con su lista de SKUs, hasta SAVE TO STG.
//
// Recorrido (el mismo que hace una persona, ver docs/features/crear-promo-id.md):
//   buscar los SKUs en el catalogo -> NEW -> Title/Tag/Body Copy/fechas/opciones
//   -> NEW de modelos (por partes, via bridge) -> Main Model -> SAVE TO STG ->
//   YES -> OK -> Promo-Id del listado.
// Los SKUs que no existen se reportan y la promo se crea con el resto.
// El SAVE TO PROD lo hace la persona (decision del usuario): al terminar se deja
// la promo nueva marcada en el listado STG para que solo tenga que apretarlo.

import {
  ADD_CHUNK, BRIDGE, FINISH_REASON, HEARTBEAT_MS, RUN_PHASE, RUN_PHASE_LABEL, SELECTORS, SKU_STATUS, TEXTS,
} from '../../constants.js';
import { itemsFromResolution, pickMainModels, resolveSkus } from '../../resolve.js';
import { appendLog, getRun, subscribeToRun, updateRun } from '../../state.js';
import { createTrace } from '../../trace.js';
import { askBridge } from '../bridge-client.js';
import { getCatalog } from '../catalog.js';
import { clickEl, setChecked, setInputValue } from '../../../../shared/dom/events.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { isAbortError, toMessage } from '../../../../shared/errors/index.js';
import {
  getMessageboxBodyText, getTopMessagebox, waitForMessagebox, waitForNoMessagebox,
} from '../../../colocar-tags/content/gp1/messagebox.js';
import { isVisible } from '../../../colocar-tags/content/gp1/modal.js';

const trace = createTrace('content');
const OWNER_KEY = 'crear-promo-id:owner';

let current = null; // { id, controller }

export function isRunning() {
  return Boolean(current);
}

// Lo que ve la persona en el popup (log del run) + el registro tecnico.
const info = (message, data) => { trace.info(message, data); return appendLog({ level: 'info', message }); };
const warn = (message, data) => { trace.warn(message, data); return appendLog({ level: 'warn', message }); };

function setPhase(phase) {
  return Promise.all([
    updateRun((run) => ({ ...run, phase, heartbeatAt: Date.now() })),
    info(RUN_PHASE_LABEL[phase]),
  ]);
}

function $(selector) {
  return document.querySelector(selector);
}

function dialogOpen() {
  return isVisible($(SELECTORS.dialog));
}

function buttonOf(box, label) {
  return Array.from(box.querySelectorAll('.ft .L-button button'))
    .find((b) => b.textContent.trim().toUpperCase() === label) || null;
}

/** Cierra los messagebox que hayan quedado abiertos (de una corrida anterior o de la persona). */
async function drainMessageboxes(signal) {
  for (let i = 0; i < 4; i += 1) {
    const box = getTopMessagebox();
    if (!box) return;
    trace.debug('messagebox abierto, se cierra', { text: getMessageboxBodyText(box) });
    const btn = buttonOf(box, 'OK') || buttonOf(box, 'NO') || buttonOf(box, 'YES');
    if (!btn) return;
    clickEl(btn);
    await sleep(250, signal);
  }
}

async function resolveList(run, signal) {
  const t0 = Date.now();
  const catalog = await getCatalog('B2C', { signal });
  const resolution = resolveSkus(run.skus, catalog.rows, { categoryMode: run.categoryMode });
  const items = itemsFromResolution(run.skus, resolution);
  const { ids: mainModelIds, warnings } = pickMainModels(resolution.models, run.mainSkus);
  trace.info('SKUs resueltos', {
    ms: Date.now() - t0,
    catalog: catalog.rows.length,
    cached: catalog.cached,
    found: resolution.models.length,
    notFound: resolution.notFound,
    ambiguous: resolution.ambiguous,
    repeated: resolution.repeated,
    rows: resolution.rowCount,
    mainModelIds,
  });
  await updateRun((r) => ({
    ...r,
    items,
    models: resolution.models.map((m) => ({
      modelId: m.modelId, sku: m.sku, salesModel: m.salesModel, modelName: m.modelName, rows: m.rows,
    })),
    mainModelIds,
    totalRows: resolution.rowCount,
  }));
  const missing = items.filter((it) => it.status !== SKU_STATUS.FOUND);
  await info(`${resolution.models.length} de ${run.skus.length} SKU(s) encontrados (${resolution.rowCount} filas).`);
  if (missing.length) await warn(`No se agregan ${missing.length}: ${missing.map((it) => it.sku).join(', ')}`);
  for (const w of warnings) await warn(w);
  if (!resolution.models.length) throw new Error('Ninguno de los SKUs existe en el catalogo B2C de GP1: no hay nada que crear.');
  return { models: resolution.models, mainModelIds };
}

async function openForm(signal) {
  await drainMessageboxes(signal);
  if (dialogOpen()) {
    // Un NEW a medio llenar (sin guardar): se cierra y se empieza limpio.
    trace.info('habia un formulario abierto: se cierra sin guardar');
    clickEl($(SELECTORS.dialogClose));
    await waitFor(() => !dialogOpen(), { timeout: 5000, signal, description: 'que se cierre el formulario anterior' });
  }
  const btn = $(SELECTORS.newBtn);
  if (!btn) throw new Error('No se encontro el boton NEW de Promotion Management.');
  btn.click();
  await waitFor(dialogOpen, { timeout: 15000, signal, description: 'el formulario NEW' });
  await sleep(300, signal);
}

function setRadio(group, value) {
  const radio = $(SELECTORS.radio(group, value));
  if (radio) setChecked(radio, true);
  else trace.warn(`no se encontro el radio ${group}=${value}`);
}

async function fillForm(config, signal) {
  const dialog = $(SELECTORS.dialog);
  const title = dialog.querySelector(SELECTORS.title);
  if (!title) throw new Error('No se encontro el campo Title.');
  setInputValue(title, config.title.trim());
  if (config.tag) setInputValue(dialog.querySelector(SELECTORS.tag), config.tag);
  if (config.bodyCopy) setInputValue(dialog.querySelector(SELECTORS.bodyCopy), config.bodyCopy);
  const dates = await askBridge(BRIDGE.OPS.SET_DATES, { startDate: config.startDate, endDate: config.endDate }, { signal });
  if (dates.startDate !== config.startDate || dates.endDate !== config.endDate) {
    await warn(`GP1 dejo las fechas en ${dates.startDate} ~ ${dates.endDate} (se pidio ${config.startDate} ~ ${config.endDate}).`);
  }
  setRadio('mDisplayDateUseFlag', config.displayDate ? 'Y' : 'N');
  setRadio('mReviewUseFlag', config.reviewUse ? 'Y' : 'N');
  setRadio('mHiddenFlag', config.hiddenUse ? 'Y' : 'N');
  await sleep(150, signal);
  trace.debug('formulario llenado', { title: title.value, dates });
}

async function addModels(models, signal) {
  // Filas en orden de la lista: las de un mismo modelo quedan juntas (asi se
  // numeran Order 1..N igual que una promo armada a mano).
  const queue = [];
  const lastRowOf = new Map();
  models.forEach((model) => model.rows.forEach((row) => {
    lastRowOf.set(model.modelId, queue.length);
    queue.push(row);
  }));

  let added = 0;
  for (let i = 0; i < queue.length; i += ADD_CHUNK) {
    const res = await askBridge(BRIDGE.OPS.ADD_MODELS, { rows: queue.slice(i, i + ADD_CHUNK) }, { signal });
    added += res.added;
    const sent = i + ADD_CHUNK;
    const done = new Set([...lastRowOf].filter(([, last]) => last < sent).map(([id]) => id));
    await updateRun((r) => ({
      ...r,
      heartbeatAt: Date.now(),
      addedRows: Math.min(sent, queue.length),
      items: r.items.map((it) => (it.status === SKU_STATUS.FOUND && done.has(it.modelId) ? { ...it, status: SKU_STATUS.ADDED } : it)),
    }));
  }
  if (added < queue.length) {
    await warn(`GP1 agrego ${added} de ${queue.length} filas (descarta las repetidas).`);
  }
  return added;
}

/**
 * SAVE TO STG. Si la pantalla rechaza (validacion), lanza con el texto del
 * aviso. Si pide confirmacion: YES (o NO en simulacion) y espera el resultado.
 * @returns {Promise<boolean>} true si guardo, false si fue simulacion
 */
async function saveToStg(signal, { dryRun = false } = {}) {
  await drainMessageboxes(signal);
  clickEl($(SELECTORS.saveStgBtn));
  const { box } = await waitForMessagebox({ timeout: 15000, signal });
  const text = getMessageboxBodyText(box);
  trace.info('SAVE TO STG: respuesta de la pantalla', { text });
  if (!text.toLowerCase().includes(TEXTS.CONFIRM_SAVE)) {
    const ok = buttonOf(box, 'OK');
    if (ok) clickEl(ok);
    throw new Error(`GP1 no acepto el guardado: ${text}`);
  }
  if (dryRun) {
    // Simulacion: GP1 ya valido todo (llego a "Do you want to save?"). NO y el
    // formulario queda abierto para revisarlo.
    clickEl(buttonOf(box, 'NO'));
    return false;
  }
  // Ultima oportunidad de cancelar: despues del YES el guardado ya va.
  if (signal.aborted) {
    const no = buttonOf(box, 'NO');
    if (no) clickEl(no);
    throw new DOMException('cancelado', 'AbortError');
  }
  await updateRun((r) => ({ ...r, saving: true }));
  clickEl(buttonOf(box, 'YES'));

  // Desde aqui no se escucha el abort: el servidor ya esta guardando.
  const t0 = Date.now();
  const result = await waitFor(() => {
    const top = getTopMessagebox();
    const body = getMessageboxBodyText(top).toLowerCase();
    if (body.includes(TEXTS.SUCCESS)) return { ok: true, box: top };
    if (body.includes(TEXTS.FAILED)) return { ok: false, box: top };
    return null;
  }, { timeout: 180000, interval: 200, description: 'la respuesta del guardado' });
  const resultText = getMessageboxBodyText(result.box);
  trace.info(`respuesta del guardado en ${Date.now() - t0} ms`, { ok: result.ok, text: resultText });
  const ok = buttonOf(result.box, 'OK');
  if (ok) clickEl(ok);
  if (!result.ok) throw new Error(`GP1 respondio: ${resultText || 'The operation was failed.'}`);
  await waitForNoMessagebox({ timeout: 10000 }).catch(() => {});
  return true;
}

function listPromotions(config) {
  return askBridge(BRIDGE.OPS.LIST, { from: config.startDate, to: config.endDate, title: config.title.trim() });
}

async function findNewPromotion(config, beforeIds) {
  const title = config.title.trim();
  for (let i = 0; i < 10; i += 1) {
    const rows = await listPromotions(config).catch(() => []);
    const fresh = rows
      .filter((r) => r.title?.trim() === title && !beforeIds.has(r.promotionId))
      .sort((a, b) => String(b.promotionId).localeCompare(String(a.promotionId)));
    if (fresh.length) return fresh[0];
    trace.debug(`Promo-Id todavia no aparece en el listado (intento ${i + 1})`, { rows: rows.length });
    await sleep(1000);
  }
  return null;
}

async function markInList(config, promotionId) {
  // Deja la promo nueva visible y marcada en el listado STG, lista para SAVE TO PROD.
  const idInput = document.querySelector('input[name="schPromotionId"]');
  const titleInput = document.querySelector('input[name="schTitle"]');
  if (idInput) setInputValue(idInput, promotionId);
  else if (titleInput) setInputValue(titleInput, config.title.trim());
  $(SELECTORS.searchBtn)?.click();
  for (let i = 0; i < 20; i += 1) {
    await sleep(300);
    const res = await askBridge(BRIDGE.OPS.MARK_STG_ROW, { promotionId }).catch(() => ({ marked: false }));
    if (res.marked) return true;
  }
  trace.warn('no se pudo marcar la fila en el listado STG', { promotionId });
  return false;
}

async function finish(id, patch) {
  sessionStorage.removeItem(OWNER_KEY);
  trace.info('corrida terminada', patch);
  await trace.flush();
  await updateRun((r) => (r.id === id && r.active ? { ...r, active: false, finishedAt: Date.now(), ...patch } : r));
}

/**
 * Ejecuta la corrida guardada en storage con este `id`. El que llama ya
 * respondio al popup; esto sigue solo.
 */
export async function startRun(id) {
  if (current) throw new Error('Ya hay una corrida en curso en esta pestana.');
  const run = await getRun();
  if (!run || run.id !== id || !run.active) {
    trace.warn('START para una corrida que ya no esta activa', { id, stored: run?.id, active: run?.active });
    return;
  }

  const controller = new AbortController();
  const { signal } = controller;
  current = { id, controller };
  sessionStorage.setItem(OWNER_KEY, id);
  trace.info('corrida aceptada en este frame', {
    id, url: location.href, isTopFrame: window === window.top, skus: run.skus.length, dryRun: Boolean(run.config.dryRun),
  });

  const heartbeat = setInterval(() => {
    updateRun((r) => (r.id === id && r.active ? { ...r, heartbeatAt: Date.now() } : r)).catch(() => {});
  }, HEARTBEAT_MS);
  const unsubscribe = subscribeToRun((next) => {
    if (!next || next.id !== id || next.cancelRequested || !next.active) controller.abort();
  });

  const { config } = run;
  try {
    await setPhase(RUN_PHASE.RESOLVING);
    const { models, mainModelIds } = await resolveList(run, signal);

    const before = await listPromotions(config).catch(() => []);
    const beforeIds = new Set(before.map((r) => r.promotionId));

    await setPhase(RUN_PHASE.OPENING);
    await openForm(signal);

    await setPhase(RUN_PHASE.FILLING);
    await fillForm(config, signal);

    await setPhase(RUN_PHASE.MODELS);
    const added = await addModels(models, signal);
    await info(`${added} fila(s) de modelo en la promo.`);

    await setPhase(RUN_PHASE.MAIN);
    const { mains } = await askBridge(BRIDGE.OPS.SET_MAIN, { modelIds: mainModelIds }, { signal });
    const mainNames = models.filter((m) => mainModelIds.includes(m.modelId)).map((m) => m.salesModel);
    await info(`${mains} Main Model: ${mainNames.join(', ')}`);

    await setPhase(RUN_PHASE.SAVING);
    const saved = await saveToStg(signal, { dryRun: config.dryRun });
    if (!saved) {
      await info('Simulacion: GP1 acepto todo y se respondio NO. El formulario quedo abierto para revisarlo; no se guardo nada.');
      await finish(id, { phase: RUN_PHASE.DONE, finishReason: FINISH_REASON.DONE, simulated: true });
      return;
    }
    await info('Guardado en STG.');

    await setPhase(RUN_PHASE.FINDING);
    const promo = await findNewPromotion(config, beforeIds);
    if (!promo) {
      await warn('Se guardo, pero no se encontro el Promo-Id en el listado. Buscalo por el titulo.');
      await finish(id, { phase: RUN_PHASE.DONE, finishReason: FINISH_REASON.DONE });
      return;
    }
    await info(`Promo-Id creado: ${promo.promotionId} (${promo.modelCnt ?? '?'} modelos).`);
    await updateRun((r) => ({ ...r, promotionId: promo.promotionId }));
    const marked = await markInList(config, promo.promotionId);
    if (marked) await info('Quedo marcada en el listado STG: solo falta SAVE TO PROD.');
    await finish(id, { phase: RUN_PHASE.DONE, finishReason: FINISH_REASON.DONE, promotionId: promo.promotionId, marked });
  } catch (err) {
    const latest = await getRun().catch(() => null);
    if (isAbortError(err, signal) && !latest?.saving) {
      // Cancelado antes del YES: nada quedo guardado. Se cierra el formulario.
      await drainMessageboxes().catch(() => {});
      if (dialogOpen()) clickEl($(SELECTORS.dialogClose));
      await info('Cancelado. No se guardo nada.');
      await finish(id, { finishReason: FINISH_REASON.CANCELLED });
    } else {
      trace.error(`fallo en la fase "${latest?.phase}": ${toMessage(err)}`, err);
      await appendLog({ level: 'error', message: toMessage(err) });
      // El formulario queda abierto a proposito: la persona ve lo que se cargo.
      await finish(id, { finishReason: FINISH_REASON.ERROR, error: toMessage(err) });
    }
  } finally {
    clearInterval(heartbeat);
    unsubscribe();
    current = null;
  }
}

/**
 * Al cargar la pantalla: si este frame era el dueno de una corrida activa, la
 * pestana se recargo a mitad (el formulario sin guardar se perdio).
 */
export async function reconcileOnInit() {
  const owner = sessionStorage.getItem(OWNER_KEY);
  if (!owner) return;
  const run = await getRun();
  sessionStorage.removeItem(OWNER_KEY);
  if (!run?.active || run.id !== owner) return;
  trace.warn('la pestana se recargo durante la corrida', { phase: run.phase, saving: run.saving });
  await appendLog({ level: 'warn', message: 'La pestana se recargo durante la corrida.' });
  await updateRun((r) => ({
    ...r, active: false, finishedAt: Date.now(), finishReason: FINISH_REASON.INTERRUPTED,
    error: r.saving ? 'La pestana se recargo durante el guardado: revisa el listado STG antes de reintentar.' : 'La pestana se recargo antes de guardar: no se guardo nada.',
  }));
}
