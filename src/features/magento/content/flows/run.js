import { isAbortError, toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';
import { PAGE_TYPE, RULE_STATUS, RUN_PHASE } from '../../constants.js';
import { appendLog, getRun, setRun } from '../../state.js';
import { detectPage } from '../detector.js';
import { collectAllRules } from '../magento/grid.js';
import { readShippingRuleDetail } from '../magento/detail-page.js';

const log = logger('magento/global-shipping-rules');
let running = false;
let activeController = null;

export function abortActiveRun() {
  activeController?.abort();
}

export async function tickIfActive() {
  if (running || window !== window.top) return;
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
    run.listingUrl = page.url;
    await setRun(run);
    await appendLog({ level: 'info', message: 'Leyendo todas las rules del listado' });

    const rules = await collectAllRules({ signal });
    if (!rules.length) throw new Error('No se encontraron Global Shipping Rules');
    run = await getRun();
    if (!run?.active) return;

    run.items = rules.map((rule) => ({ ...rule, status: RULE_STATUS.PENDING, error: '' }));
    run.phase = RUN_PHASE.READING;
    run.currentRuleIndex = -1;
    await setRun(run);
    await appendLog({ level: 'info', message: `${rules.length} rules encontradas` });
    run = await getRun();
    if (!run?.active) return;
  }

  const nextIndex = run.items.findIndex((item) => item.status === RULE_STATUS.PENDING);
  if (nextIndex === -1) {
    await finalize(run);
    return;
  }

  const item = run.items[nextIndex];
  item.status = RULE_STATUS.READING;
  item.error = '';
  run.phase = RUN_PHASE.READING;
  run.currentRuleIndex = nextIndex;
  await setRun(run);
  await appendLog({
    level: 'info',
    message: `Leyendo ${labelOf(item)} (${nextIndex + 1}/${run.items.length})`,
  });
  window.location.href = item.editHref;
}

async function onDetail(run, page, signal) {
  const index = findActiveRuleIndex(run, page.ruleId);
  if (index === -1) {
    log.warn('detalle sin rule activa', { ruleId: page.ruleId });
    window.location.href = run.listingUrl;
    return;
  }

  try {
    const detail = await readShippingRuleDetail({ signal });
    const latest = await getRun();
    if (!latest?.active) return;
    const latestIndex = findActiveRuleIndex(latest, page.ruleId);
    if (latestIndex === -1) return;
    const item = latest.items[latestIndex];
    item.detail = detail;
    item.status = RULE_STATUS.OK;
    item.capturedAt = Date.now();
    await setRun(latest);
    await appendLog({
      level: 'info',
      message: `${labelOf(item)}: ${detail.fields.length} campos y ${detail.regionalRows.length} tarifas capturadas`,
    });
    window.location.href = latest.listingUrl;
  } catch (err) {
    const latest = await getRun();
    if (!latest?.active) return;
    const latestIndex = findActiveRuleIndex(latest, page.ruleId);
    if (latestIndex === -1) return;
    const item = latest.items[latestIndex];
    item.status = RULE_STATUS.ERROR;
    item.error = toMessage(err);
    await setRun(latest);
    await appendLog({ level: 'error', message: `${labelOf(item)}: ${item.error}` });
    window.location.href = latest.listingUrl;
  }
}

async function finalize(run) {
  run.active = false;
  run.phase = RUN_PHASE.DONE;
  run.finishedAt = Date.now();
  run.finishReason = 'done';
  await setRun(run);
  const ok = run.items.filter((item) => item.status === RULE_STATUS.OK).length;
  const errors = run.items.filter((item) => item.status === RULE_STATUS.ERROR).length;
  await appendLog({ level: errors ? 'warn' : 'info', message: `Proceso terminado: ${ok} ok, ${errors} con error` });
}

async function stopWithError(message) {
  try {
    const run = await getRun();
    if (!run?.active) return;
    run.active = false;
    run.finishedAt = Date.now();
    run.finishReason = 'error';
    run.error = message;
    await setRun(run);
    await appendLog({ level: 'error', message: `Proceso detenido: ${message}` });
  } catch (storageError) {
    log.error('no se pudo guardar el error del run', storageError);
  }
}

function findActiveRuleIndex(run, ruleId) {
  return run.items?.findIndex((item) =>
    item.status === RULE_STATUS.READING && String(item.id) === String(ruleId),
  ) ?? -1;
}

function labelOf(item) {
  return `${item.nameFe || 'Sin nombre'} (#${item.id})`;
}
