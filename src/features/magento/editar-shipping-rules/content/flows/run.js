// State machine que activa/desactiva las rules elegidas. Cruza navegaciones
// full-page de Magento (formulario -> Save -> listado), asi que el estado vive
// en storage y cada carga (mas cada storage.onChanged) dispara un tick.
//
// Solo actua la pestana que el popup reclamo (sessionStorage con el id del run):
// si hay otra pestana del admin abierta, no ejecuta la misma cola en paralelo.
//
// EDIT (formulario de una rule):
//   ├─ rule en APPLYING: leer `is_active` (bridge MAIN), confirmar que el
//   │   entity_id del formulario es la rule esperada, y:
//   │     ├─ ya estaba en el estado pedido -> UNCHANGED (no se guarda nada)
//   │     └─ si no -> fijar el campo, marcar SAVING y pulsar Save.
//   └─ rule en SAVING: Magento volvio al formulario despues del Save (lo hace
//       segun como se abrio): se cierra por el mensaje, igual que en el listado.
//
// LISTING (la otra pantalla a la que puede volver el Save):
//   └─ rule en SAVING: "has been saved" -> OK, mensaje de error -> ERROR.
//
// Al terminar la cola se vuelve a leer el grid (un GET) y se contrasta cada
// rule con el estado pedido: `verified` es lo que el listado muestra de verdad.

import { isAbortError, toMessage } from '../../../../../shared/errors/index.js';
import { sleep } from '../../../../../shared/dom/wait.js';
import { logger } from '../../../../../shared/utils/logger.js';
import { BRIDGE } from '../../../constants.js';
import { askBridge } from '../../../content/bridge-client.js';
import { activeLabel } from '../../catalog.js';
import {
  CLAIM_SESSION_KEY,
  EDIT_URL_RE,
  FINISH_REASON,
  FORM_NAMESPACE,
  FORM_READY_TIMEOUT_MS,
  ITEM_STATUS,
  LOG_CAP,
  MAX_REDIRECTS,
  PAGE_TYPE,
  RUN_PHASE,
  SAVE_TIMEOUT_MS,
  SELECTORS,
} from '../../constants.js';
import { getCatalog, getRun, pushHistory, setCatalog, setRun } from '../../state.js';
import { fetchAllRules } from '../catalog-fetch.js';
import { detectPage, fieldErrors, pageMessages, saveOutcome } from '../detector.js';

const log = logger('magento/editar-shipping-rules');
let running = false;
let activeController = null;

// Se levanta al pedir una navegacion (o pulsar Save) y solo lo baja la carga del
// documento nuevo. Sin esto, la escritura en storage que precede a la
// navegacion dispara otro tick en ESTA pagina, que veria la rule "en curso" y la
// daria por fallida (mismo quirk que Global Shipping Rules).
let navigating = false;

export function abortActiveRun() {
  activeController?.abort();
}

// -----------------------------------------------------------------------------
// Reclamo de la pestana
// -----------------------------------------------------------------------------

export function claimHere(runId) {
  try {
    sessionStorage.setItem(CLAIM_SESSION_KEY, String(runId || ''));
    return true;
  } catch {
    return false;
  }
}

export function isClaimedHere(run) {
  try {
    return Boolean(run?.id) && sessionStorage.getItem(CLAIM_SESSION_KEY) === run.id;
  } catch {
    return false;
  }
}

function releaseClaim() {
  try { sessionStorage.removeItem(CLAIM_SESSION_KEY); } catch { /* no-op */ }
}

// -----------------------------------------------------------------------------
// Tick
// -----------------------------------------------------------------------------

export async function tickIfActive() {
  if (running || navigating || window !== window.top) return;
  running = true;
  const controller = new AbortController();
  activeController = controller;

  try {
    const run = await getRun();
    if (!run?.active || !isClaimedHere(run)) return;
    const page = detectPage();

    if (page.type === PAGE_TYPE.EDIT) await onEdit(run, page, controller.signal);
    else if (page.type === PAGE_TYPE.LISTING) await onListing(run, controller.signal);
    else await onOther(run, page, controller.signal);
  } catch (err) {
    if (isAbortError(err, controller.signal)) {
      log.info('corrida detenida');
    } else {
      log.error('tick fallo', err);
      await stopWithError(toMessage(err));
    }
  } finally {
    if (activeController === controller) activeController = null;
    running = false;
  }
}

async function onEdit(run, page, signal) {
  const index = findCurrentIndex(run, page.ruleId);
  if (index === -1) {
    // Se abrio una rule que no es la que se esperaba (Magento redirigio a otra,
    // o una recarga manual): se reintenta la esperada o se sigue con la cola.
    const applying = run.items.find((item) => item.status === ITEM_STATUS.APPLYING);
    if (applying && !(await retryOrFail(run, applying, `Se abrio la rule #${page.ruleId} en vez de la esperada`))) return;
    await advance(run, signal);
    return;
  }
  const item = run.items[index];

  if (item.status === ITEM_STATUS.SAVING) {
    // Tras el Save Magento puede volver al MISMO formulario (medido) en vez de
    // al listado: lo que decide es el mensaje, no la pantalla.
    settleSaving(run, item);
    await advance(run, signal);
    return;
  }

  const state = await readActiveField(signal);
  if (!state.found) {
    failItem(run, item, `No se pudo leer el campo "Active this shipping rule": ${state.reason}`);
    await advance(run, signal);
    return;
  }
  if (state.entityId && state.entityId !== String(item.id)) {
    failItem(run, item, `El formulario abierto es la rule #${state.entityId}, no la #${item.id}; no se toco nada`);
    await advance(run, signal);
    return;
  }

  item.before = state.before;
  if (state.before === item.target) {
    item.status = ITEM_STATUS.UNCHANGED;
    item.after = state.before;
    item.changedAt = Date.now();
    item.note = `Ya estaba ${activeLabel(state.before).toLowerCase()}; no se guardo nada`;
    appendRunLog(run, { level: 'info', message: `${labelOf(item)}: ya estaba ${activeLabel(state.before).toLowerCase()}, sin cambio` });
    run.redirects = 0;
    await advance(run, signal);
    return;
  }

  const set = await askBridge(
    BRIDGE.OPS.SHIPPING_RULE_ACTIVE,
    { namespace: FORM_NAMESPACE, set: item.target },
    { signal },
  );
  if (!set.ok || !set.result?.found || set.result.after !== item.target) {
    failItem(run, item, `No se pudo cambiar el campo: ${set.ok ? set.result?.reason || 'el valor no quedo aplicado' : set.reason}`);
    await advance(run, signal);
    return;
  }

  const save = document.querySelector(SELECTORS.saveButton);
  if (!save) {
    failItem(run, item, 'No se encontro el boton Save del formulario');
    await advance(run, signal);
    return;
  }

  item.status = ITEM_STATUS.SAVING;
  item.after = item.target;
  run.redirects = 0;
  appendRunLog(run, {
    level: 'info',
    message: `${labelOf(item)}: ${activeLabel(item.before)} -> ${activeLabel(item.target)}, guardando...`,
  });

  // `navigating` ANTES de escribir: el storage.onChanged de esta misma
  // escritura llega en ~1 ms y veria la rule en SAVING sobre el formulario.
  navigating = true;
  await setRun(run);
  await pressSave(save, item, signal);
}

/**
 * Pulsa Save y espera a que la pestana deje el formulario. Si la navegacion no
 * arranca en SAVE_TIMEOUT_MS, Magento rechazo el formulario en el navegador
 * (validacion) y la rule queda en error. Si arranco, NO se toca nada aunque
 * tarde: navegar a otro lado cancelaria el guardado.
 */
async function pressSave(save, item, signal) {
  let leaving = false;
  const onLeave = () => { leaving = true; };
  window.addEventListener('beforeunload', onLeave);
  window.addEventListener('pagehide', onLeave);
  // Un onbeforeunload de la pagina con confirm dejaria el Save esperando una
  // respuesta que nadie da (mismo cuidado que lead-times).
  try { window.onbeforeunload = null; } catch { /* no-op */ }

  save.click();

  const deadline = Date.now() + SAVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(500, signal);
    if (leaving) return; // el documento nuevo sigue la corrida
  }
  if (leaving) return;

  window.removeEventListener('beforeunload', onLeave);
  window.removeEventListener('pagehide', onLeave);
  navigating = false;
  const latest = await getRun();
  if (!latest?.active) return;
  const current = latest.items.find((candidate) => candidate.id === item.id);
  if (!current || current.status !== ITEM_STATUS.SAVING) return;
  const reasons = [...fieldErrors(), ...pageMessages().errors];
  failItem(latest, current, reasons.length
    ? `Magento rechazo el formulario: ${reasons.slice(0, 3).join(' | ')}`
    : `Magento no salio del formulario ${Math.round(SAVE_TIMEOUT_MS / 1000)} s despues de pulsar Save`);
  current.after = current.before;
  await advance(latest, signal);
}

async function onListing(run, signal) {
  const saving = run.items.find((item) => item.status === ITEM_STATUS.SAVING);
  if (saving) settleSaving(run, saving);

  const applying = run.items.find((item) => item.status === ITEM_STATUS.APPLYING);
  if (applying && !(await retryOrFail(run, applying, 'Magento devolvio el listado en vez del formulario'))) return;

  await advance(run, signal);
}

async function onOther(run, page, signal) {
  const saving = run.items.find((item) => item.status === ITEM_STATUS.SAVING);
  if (saving) {
    // El Save salio del formulario pero no llego al listado: se da por
    // guardada y la verificacion final lo confirma o lo desmiente.
    saving.status = ITEM_STATUS.OK;
    saving.changedAt = Date.now();
    saving.note = `Tras guardar, Magento fue a ${page.url}; se confirma al final`;
    appendRunLog(run, { level: 'warn', message: `${labelOf(saving)}: ${saving.note}` });
    await advance(run, signal);
    return;
  }

  const applying = run.items.find((item) => item.status === ITEM_STATUS.APPLYING);
  if (applying) {
    // Tipicamente el dashboard: la key de la URL de edicion vencio.
    if (!(await retryOrFail(run, applying, `Magento redirigio a ${page.url}`))) return;
  }
  await advance(run, signal);
}

/**
 * Reintenta abrir el formulario de la rule; al pasar MAX_REDIRECTS la da por
 * perdida. Devuelve true si hay que seguir con la cola.
 */
async function retryOrFail(run, item, reason) {
  run.redirects = (Number(run.redirects) || 0) + 1;
  if (run.redirects >= MAX_REDIRECTS) {
    failItem(run, item, `${reason} (${run.redirects} intentos)`);
    run.redirects = 0;
    return true;
  }
  appendRunLog(run, { level: 'warn', message: `${labelOf(item)}: ${reason}; reintentando` });
  navigating = true;
  await setRun(run);
  goTo(item.editHref);
  return false;
}

/** Toma la siguiente rule pendiente y navega a su formulario, o cierra. */
async function advance(run, signal) {
  const index = run.items.findIndex((item) => item.status === ITEM_STATUS.PENDING);
  if (index === -1) {
    await verifyAndFinish(run, signal);
    return;
  }
  const item = run.items[index];
  item.status = ITEM_STATUS.APPLYING;
  item.error = '';
  run.currentIndex = index;
  appendRunLog(run, { level: 'info', message: `Abriendo ${labelOf(item)} (${index + 1}/${run.items.length})` });
  navigating = true;
  await setRun(run);
  goTo(item.editHref);
}

async function verifyAndFinish(run, signal) {
  run.phase = RUN_PHASE.VERIFYING;
  run.currentIndex = -1;
  appendRunLog(run, { level: 'info', message: 'Verificando el estado final en el listado...' });
  await setRun(run);

  try {
    const fresh = await fetchAllRules({ signal });
    const byId = new Map(fresh.rules.map((rule) => [rule.id, rule]));
    for (const item of run.items) {
      if (item.status !== ITEM_STATUS.OK && item.status !== ITEM_STATUS.UNCHANGED) continue;
      const actual = byId.get(String(item.id));
      if (!actual) {
        item.verified = null;
        continue;
      }
      item.verified = actual.isActive === item.target;
      if (!item.verified) {
        item.status = ITEM_STATUS.ERROR;
        item.after = actual.isActive;
        item.error = `El listado sigue mostrando la rule ${activeLabel(actual.isActive).toLowerCase()}`;
        appendRunLog(run, { level: 'error', message: `${labelOf(item)}: ${item.error}` });
      }
    }
    // El catalogo del popup queda al dia con lo que se acaba de cambiar.
    const previous = await getCatalog();
    await setCatalog({ ...(previous || {}), ...fresh, loadedAt: Date.now() });
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    appendRunLog(run, { level: 'warn', message: `No se pudo verificar en el listado: ${toMessage(err)}` });
  }

  const latest = await getRun();
  if (!latest?.active || latest.id !== run.id) return;
  finishRun(run, FINISH_REASON.DONE);
  await setRun(run);
  await pushHistory(run);
  releaseClaim();
}

function finishRun(run, reason) {
  run.active = false;
  run.phase = RUN_PHASE.DONE;
  run.finishedAt = Date.now();
  run.finishReason = reason;
  run.currentIndex = -1;
  const count = (status) => run.items.filter((item) => item.status === status).length;
  const errors = count(ITEM_STATUS.ERROR);
  appendRunLog(run, {
    level: errors ? 'warn' : 'info',
    message: `Terminado: ${count(ITEM_STATUS.OK)} cambiadas, ${count(ITEM_STATUS.UNCHANGED)} sin cambio, ${errors} con error`,
  });
}

async function stopWithError(message) {
  try {
    const run = await getRun();
    if (!run?.active) return;
    run.error = message;
    appendRunLog(run, { level: 'error', message: `Corrida detenida: ${message}` });
    finishRun(run, FINISH_REASON.ERROR);
    await setRun(run);
    await pushHistory(run);
    releaseClaim();
  } catch (storageError) {
    log.error('no se pudo guardar el error de la corrida', storageError);
  }
}

/**
 * Cierra la rule en SAVING segun lo que Magento dijo al volver del Save. Sin
 * mensaje de guardado ni de error se da por guardada y la verificacion final
 * contra el listado lo confirma o lo desmiente.
 */
function settleSaving(run, item) {
  const { saved, message, errors } = saveOutcome();
  run.redirects = 0;
  if (errors.length && !saved) {
    failItem(run, item, `Magento no guardo: ${errors.join(' | ')}`);
    item.after = item.before;
    return;
  }
  item.status = ITEM_STATUS.OK;
  item.changedAt = Date.now();
  item.note = message || 'Magento no mostro el mensaje de guardado; se confirma al final';
  appendRunLog(run, {
    level: saved ? 'info' : 'warn',
    message: `${labelOf(item)}: ahora ${activeLabel(item.after).toLowerCase()} (${item.note})`,
  });
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Espera a que el formulario registre `is_active` y lo lee (sin tocarlo). */
async function readActiveField(signal) {
  const deadline = Date.now() + FORM_READY_TIMEOUT_MS;
  let last = { found: false, reason: 'el formulario no cargo' };
  while (Date.now() < deadline) {
    const answer = await askBridge(BRIDGE.OPS.SHIPPING_RULE_ACTIVE, { namespace: FORM_NAMESPACE }, { signal });
    if (answer.aborted) throw new DOMException('cancelado', 'AbortError');
    if (answer.ok && answer.result?.found) return answer.result;
    last = { found: false, reason: answer.ok ? answer.result?.reason : answer.reason };
    await sleep(400, signal);
  }
  return last;
}

function goTo(url) {
  navigating = true;
  try { window.onbeforeunload = null; } catch { /* no-op */ }
  window.location.href = url;
}

function failItem(run, item, message) {
  item.status = ITEM_STATUS.ERROR;
  item.error = message;
  item.changedAt = Date.now();
  appendRunLog(run, { level: 'error', message: `${labelOf(item)}: ${message}` });
}

/** IDs con los que una rule puede aparecer en la URL de edicion. */
function idsOf(item) {
  const fromHref = String(item?.editHref || '').match(EDIT_URL_RE)?.[1];
  return [item?.id, fromHref].filter(Boolean).map(String);
}

export function findCurrentIndex(run, ruleId) {
  const target = String(ruleId ?? '');
  return (run?.items || []).findIndex((item) =>
    (item.status === ITEM_STATUS.APPLYING || item.status === ITEM_STATUS.SAVING)
    && idsOf(item).includes(target));
}

function appendRunLog(run, entry) {
  const entries = [...(Array.isArray(run.log) ? run.log : []), { ts: Date.now(), ...entry }];
  run.log = entries.slice(-LOG_CAP);
}

function labelOf(item) {
  return `#${item.id} ${item.nameBe || item.nameFe || ''}`.trim();
}
