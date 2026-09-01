// State machine que recorre el listado de Global Shipping Rules y entra a cada
// detalle para capturarlo. Cruza navegaciones full-page de Magento, asi que el
// estado vive en storage y cada carga (mas cada storage.onChanged) dispara un
// tick que decide el proximo paso.
//
// LISTING:
//   ├─ Si una rule quedo en READING sin que el detalle la capturara → interrumpida.
//   ├─ Si no hay items → recorrer el listado completo y armarlos.
//   ├─ Tomar la proxima PENDING, marcarla READING y navegar a su detalle.
//   └─ Si no queda ninguna PENDING → finalizar.
//
// DETAIL:
//   ├─ Casar la URL con la rule en READING, leer campos + tarifas regionales.
//   └─ Guardar el resultado y navegar directo a la siguiente rule pendiente.

import { isAbortError, toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';
import {
  DEFAULT_LISTING_URL,
  DETAIL_URL_RE,
  FINISH_REASON,
  LOG_CAP,
  MAX_DETAIL_REDIRECTS,
  PAGE_TYPE,
  RULE_STATUS,
  RUN_PHASE,
} from '../../constants.js';
import { appendLog, getRun, setRun } from '../../state.js';
import { detectPage } from '../detector.js';
import { collectAllRules } from '../magento/grid.js';
import { readShippingRuleDetail } from '../magento/detail-page.js';

const log = logger('magento/global-shipping-rules');
let running = false;
let activeController = null;

// Se levanta al pedir una navegacion y solo lo baja la carga del documento
// nuevo (esta variable vive en la pagina). Sin esto, la escritura en storage que
// precede al location.href dispara otro tick por storage.onChanged: el navegador
// todavia no cambio de pagina, ese tick ve la rule en READING y la marca como
// interrumpida. El sintoma era que TODAS las rules terminaban en error.
let navigating = false;

export function abortActiveRun() {
  activeController?.abort();
}

/** Navega y bloquea los ticks hasta que cargue el documento nuevo. */
function goTo(url) {
  navigating = true;
  // Los formularios del admin cuelgan un onbeforeunload y bastaria un confirm
  // "Changes have been made" para dejar el proceso esperando una navegacion que
  // nunca ocurre (mismo cuidado que en lead-times).
  try { window.onbeforeunload = null; } catch { /* no-op */ }
  window.location.href = url;
}

export async function tickIfActive() {
  if (running || navigating || window !== window.top) return;
  running = true;
  const controller = new AbortController();
  activeController = controller;

  try {
    const run = await getRun();
    if (!run?.active) return;
    const page = detectPage();

    if (page.type === PAGE_TYPE.LISTING) {
      await onListing(run, page, controller.signal);
    } else if (page.type === PAGE_TYPE.DETAIL) {
      await onDetail(run, page, controller.signal);
    } else {
      log.debug('pagina fuera del flujo', { url: page.url });
    }
  } catch (err) {
    if (isAbortError(err, controller.signal)) {
      log.info('captura detenida');
    } else {
      log.error('tick fallo', err);
      await stopWithError(toMessage(err));
    }
  } finally {
    if (activeController === controller) activeController = null;
    running = false;
  }
}

async function onListing(initialRun, page, signal) {
  let run = initialRun;

  // El listado real trae el token `key` de Magento; guardarlo evita volver a la
  // URL generica (que en algunos ambientes redirige al dashboard).
  if (run.listingUrl !== page.url) {
    run.listingUrl = page.url;
    await setRun(run);
  }

  const interrupted = run.items?.find((item) => item.status === RULE_STATUS.READING);
  if (interrupted) {
    interrupted.status = RULE_STATUS.ERROR;
    interrupted.error = 'La navegacion de detalle se interrumpio antes de capturar los datos';
    await setRun(run);
    await appendLog({ level: 'error', message: `Rule ${labelOf(interrupted)}: lectura interrumpida` });
    run = await getRun();
    if (!run?.active) return;
  }

  if (!Array.isArray(run.items) || run.items.length === 0) {
    run.phase = RUN_PHASE.DISCOVERING;
    await setRun(run);
    await appendLog({ level: 'info', message: 'Leyendo todas las rules del listado' });

    const discoveryStartedAt = Date.now();
    const rules = await collectAllRules({ signal, onWarn: warnToLog });
    const discoveryMs = Date.now() - discoveryStartedAt;
    if (!rules.length) throw new Error('No se encontraron Global Shipping Rules');
    run = await getRun();
    if (!run?.active) return;

    metricsOf(run).discoveryMs += discoveryMs;
    run.items = rules.map((rule) => ({ ...rule, status: RULE_STATUS.PENDING, error: '' }));
    run.phase = RUN_PHASE.READING;
    run.currentRuleIndex = -1;
    await setRun(run);
    await appendLog({ level: 'info', message: `${rules.length} rules encontradas` });
    run = await getRun();
    if (!run?.active) return;
  }

  const claimed = claimNextPendingRule(run);
  if (!claimed) {
    await finalize(run);
    return;
  }

  recordNavigation(run);
  appendReadingLog(run, claimed, run.items.length);
  await setRun(run);
  goTo(claimed.item.editHref);
}

async function onDetail(run, page, signal) {
  const index = findActiveRuleIndex(run, page.ruleId);
  if (index === -1) {
    // Puede ser una recarga manual del detalle, o que el ID de la columna del
    // listado no coincida con el entity_id de la URL. Lo segundo rebotaria para
    // siempre entre listado y detalle, asi que se cuenta y se corta.
    const redirects = (run.detailRedirects || 0) + 1;
    log.warn('detalle sin rule activa', { ruleId: page.ruleId, redirects });
    if (redirects >= MAX_DETAIL_REDIRECTS) {
      await stopWithError(
        `No se pudo asociar el detalle ${page.ruleId} con ninguna rule en lectura despues de ${redirects} intentos`,
      );
      return;
    }
    run.detailRedirects = redirects;
    recordNavigation(run);
    await setRun(run);
    goTo(listingUrlOf(run));
    return;
  }

  const detailStartedAt = Date.now();
  try {
    const detail = await readShippingRuleDetail({ signal, onWarn: warnToLog });
    const latest = await getRun();
    if (!latest?.active) return;
    const latestIndex = findActiveRuleIndex(latest, page.ruleId);
    if (latestIndex === -1) return;
    const item = latest.items[latestIndex];
    item.detail = detail;
    item.status = RULE_STATUS.OK;
    item.capturedAt = Date.now();
    item.captureMs = detail.timing?.totalMs ?? Date.now() - detailStartedAt;
    latest.detailRedirects = 0;
    recordDetailMetrics(latest, item.captureMs, detail.timing?.regionalMs || 0);
    appendRunLog(latest, {
      level: 'info',
      message: `${labelOf(item)}: ${detail.fields.length} campos y ${detail.regionalRows.length} tarifas capturadas`,
    });
    const claimed = claimNextPendingRule(latest);
    if (claimed) {
      recordNavigation(latest);
      appendReadingLog(latest, claimed, latest.items.length);
    } else {
      finishRun(latest);
    }
    await setRun(latest);
    if (claimed) goTo(claimed.item.editHref);
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    const latest = await getRun();
    if (!latest?.active) return;
    const latestIndex = findActiveRuleIndex(latest, page.ruleId);
    if (latestIndex === -1) return;
    const item = latest.items[latestIndex];
    item.status = RULE_STATUS.ERROR;
    item.error = toMessage(err);
    item.captureMs = Date.now() - detailStartedAt;
    latest.detailRedirects = 0;
    recordDetailMetrics(latest, item.captureMs, 0);
    appendRunLog(latest, { level: 'error', message: `${labelOf(item)}: ${item.error}` });
    const claimed = claimNextPendingRule(latest);
    if (claimed) {
      recordNavigation(latest);
      appendReadingLog(latest, claimed, latest.items.length);
    } else {
      finishRun(latest);
    }
    await setRun(latest);
    if (claimed) goTo(claimed.item.editHref);
  }
}

async function finalize(run) {
  finishRun(run);
  await setRun(run);
}

function finishRun(run) {
  run.active = false;
  run.phase = RUN_PHASE.DONE;
  run.finishedAt = Date.now();
  run.finishReason = FINISH_REASON.DONE;
  run.currentRuleIndex = -1;
  const ok = run.items.filter((item) => item.status === RULE_STATUS.OK).length;
  const errors = run.items.filter((item) => item.status === RULE_STATUS.ERROR).length;
  appendRunLog(run, {
    level: errors ? 'warn' : 'info',
    message: `Proceso terminado: ${ok} ok, ${errors} con error`,
  });
}

async function stopWithError(message) {
  try {
    const run = await getRun();
    if (!run?.active) return;
    run.active = false;
    run.finishedAt = Date.now();
    run.finishReason = FINISH_REASON.ERROR;
    run.error = message;
    await setRun(run);
    await appendLog({ level: 'error', message: `Proceso detenido: ${message}` });
  } catch (storageError) {
    log.error('no se pudo guardar el error del run', storageError);
  }
}

/** Los drivers avisan por aca lo que no es fatal (una pagina que no avanzo, etc.). */
function warnToLog(message) {
  log.warn(message);
  appendLog({ level: 'warn', message }).catch(() => { /* el run pudo cerrarse */ });
}

function listingUrlOf(run) {
  return run?.listingUrl || DEFAULT_LISTING_URL;
}

/** IDs con los que una rule puede aparecer en la URL del detalle. */
function ruleIdsOf(item) {
  const fromHref = String(item?.editHref || '').match(DETAIL_URL_RE)?.[1];
  return [item?.id, fromHref].filter(Boolean).map(String);
}

function metricsOf(run) {
  const metrics = run.metrics || {};
  metrics.discoveryMs = Number(metrics.discoveryMs) || 0;
  metrics.detailMs = Number(metrics.detailMs) || 0;
  metrics.regionalMs = Number(metrics.regionalMs) || 0;
  metrics.detailCount = Number(metrics.detailCount) || 0;
  metrics.navigationCount = Number(metrics.navigationCount) || 0;
  run.metrics = metrics;
  return metrics;
}

function recordNavigation(run) {
  metricsOf(run).navigationCount += 1;
}

function recordDetailMetrics(run, detailMs, regionalMs) {
  const metrics = metricsOf(run);
  metrics.detailMs += detailMs;
  metrics.regionalMs += regionalMs;
  metrics.detailCount += 1;
}

export function claimNextPendingRule(run) {
  const items = Array.isArray(run?.items) ? run.items : [];
  const index = items.findIndex((item) => item.status === RULE_STATUS.PENDING);
  if (index === -1) return null;
  const item = items[index];
  item.status = RULE_STATUS.READING;
  item.error = '';
  run.phase = RUN_PHASE.READING;
  run.currentRuleIndex = index;
  return { index, item };
}

function appendRunLog(run, entry) {
  const entries = [...(Array.isArray(run.log) ? run.log : []), { ts: Date.now(), ...entry }];
  run.log = entries.slice(-LOG_CAP);
}

function appendReadingLog(run, claimed, total) {
  appendRunLog(run, {
    level: 'info',
    message: `Leyendo ${labelOf(claimed.item)} (${claimed.index + 1}/${total})`,
  });
}

export function findActiveRuleIndex(run, ruleId) {
  const items = run?.items || [];
  const target = String(ruleId ?? '');
  const byId = items.findIndex((item) =>
    item.status === RULE_STATUS.READING && ruleIdsOf(item).includes(target));
  if (byId !== -1) return byId;

  // Solo puede haber una rule en READING a la vez. Si el ID de la columna del
  // listado no es el entity_id que Magento pone en la URL, igual sabemos cual
  // estabamos leyendo; sin esta salida el proceso rebota listado/detalle.
  const reading = items.reduce(
    (acc, item, index) => (item.status === RULE_STATUS.READING ? [...acc, index] : acc),
    [],
  );
  if (reading.length !== 1) return -1;
  log.warn('detalle casado por descarte: el ID del listado no coincide con la URL', {
    ruleId: target,
    item: items[reading[0]]?.id,
  });
  return reading[0];
}

function labelOf(item) {
  return `${item.nameFe || 'Sin nombre'} (#${item.id})`;
}
