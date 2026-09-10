// State machine de "Crear Softbundles". Cruza navegaciones full-page del admin
// de Magento, asi que el estado vive en storage y cada carga (mas cada
// storage.onChanged) dispara un tick que decide el proximo paso.
//
// LISTING:
//   ├─ Dejar el website correcto (cambiarlo navega: se suelta el tick).
//   ├─ Cerrar el bundle que volvio de guardarse y marcar como interrumpido
//   │  cualquiera que se quedo a medias.
//   ├─ Revisar (una sola vez) que SKU padre ya tiene package rule.
//   └─ Tomar el proximo PENDIENTE y pulsar "Add New Package".
//
// NEW:    llenar el formulario del padre y pulsar "Save and Continue Edit".
// EDIT:   crear una oferta por producto hijo (AJAX, sin navegar) y pulsar "Save".
//
// En modo simulacion el recorrido se detiene antes del primer guardado: se
// llena el formulario del padre (lo que valida que el SKU exista en Magento) y
// se vuelve al listado sin crear nada.

import { isAbortError, toMessage } from '../../../../../shared/errors/index.js';
import { logger } from '../../../../../shared/utils/logger.js';
import {
  BUNDLE_STATUS,
  CHILD_STATUS,
  FINISH_REASON,
  MAX_REDIRECTS,
  PAGE_TYPE,
  RUN_PHASE,
  SKIP_REASON,
  TEXTS,
  WEBSITE_LABEL,
} from '../../constants.js';
import { appendLog, getRun, updateRun } from '../../state.js';
import { sameSku } from '../../parse-input.js';
import { detectPage } from '../detector.js';
import { hasSuccess, readMessages } from '../parser.js';
import {
  clearFilters,
  clickAddPackage,
  ensureWebsite,
  findExistingRule,
  waitForGridReady,
} from '../magento/listing.js';
import {
  clickSave,
  clickSaveAndContinue,
  fillParentForm,
} from '../magento/parent-form.js';
import { closeOfferModal, createOffer, findOfferModal, readOfferSkus } from '../magento/offer-modal.js';

const log = logger('magento/softbundles');
let running = false;
let activeController = null;

// Se levanta al pedir una navegacion y solo lo baja la carga del documento
// nuevo. Sin esto, la escritura en storage que precede al click de guardado
// dispara otro tick por storage.onChanged: el navegador todavia no cambio de
// pagina, ese tick ve el bundle a medio crear y lo marca como interrumpido.
let navigating = false;

export function abortActiveRun() {
  activeController?.abort();
}

function markNavigating() {
  navigating = true;
  try { window.onbeforeunload = null; } catch { /* no-op */ }
}

function goTo(url) {
  markNavigating();
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

    if (page.type === PAGE_TYPE.LISTING) await onListing(run, page, controller.signal);
    else if (page.type === PAGE_TYPE.NEW) await onNew(run, page, controller.signal);
    else if (page.type === PAGE_TYPE.EDIT) await onEdit(run, page, controller.signal);
    else log.debug('pagina fuera del flujo', { url: page.url });
  } catch (err) {
    if (isAbortError(err, controller.signal)) {
      log.info('proceso detenido');
    } else {
      log.error('tick fallo', err);
      await stopWithError(toMessage(err));
    }
  } finally {
    if (activeController === controller) activeController = null;
    running = false;
  }
}

// -----------------------------------------------------------------------------
// listado
// -----------------------------------------------------------------------------

async function onListing(initialRun, page, signal) {
  let run = initialRun;

  if (run.listingUrl !== page.url) {
    run = await updateRun((current) => ({ ...current, listingUrl: page.url }));
    if (!run?.active) return;
  }

  await waitForGridReady({ signal }).catch(() => { /* seguimos: el website manda */ });

  const website = await ensureWebsite(WEBSITE_LABEL, { signal });
  if (website.missing) {
    await stopWithError(`No se pudo seleccionar el website "${WEBSITE_LABEL}" en el listado${website.available?.length ? ` (disponibles: ${website.available.join(', ')})` : ''}.`);
    return;
  }
  if (website.navigating) {
    markNavigating();
    await appendLog({ level: 'info', message: `Cambiando el website a "${WEBSITE_LABEL}"` });
    return;
  }

  run = await reconcileOnListing(run);
  if (!run?.active) return;

  run = await checkExistingRules(run, signal);
  if (!run?.active) return;

  await startNextBundle(run, signal);
}

/** Cierra el bundle que volvio del guardado y marca los que se quedaron a medias. */
async function reconcileOnListing(run) {
  const saving = run.items.findIndex((item) => item.status === BUNDLE_STATUS.SAVING);
  const creating = run.items.findIndex((item) => item.status === BUNDLE_STATUS.CREATING);
  if (saving === -1 && creating === -1) return run;

  const saved = hasSuccess(TEXTS.RULE_SAVED);
  const magentoErrors = readMessages().errors;

  const updated = await updateRun((current) => {
    const items = current.items.map((item, index) => {
      if (index === saving) {
        const failed = item.children.filter((child) => child.status === CHILD_STATUS.ERROR).length;
        if (!saved) {
          return {
            ...item,
            status: BUNDLE_STATUS.ERROR,
            error: magentoErrors[0] || 'Magento no confirmo el guardado del package rule.',
          };
        }
        return {
          ...item,
          status: failed ? BUNDLE_STATUS.PARTIAL : BUNDLE_STATUS.OK,
          error: failed ? `${failed} oferta(s) no se pudieron crear` : '',
        };
      }
      if (index === creating) {
        return {
          ...item,
          status: BUNDLE_STATUS.ERROR,
          error: 'La creacion se interrumpio antes de terminar (se volvio al listado).',
        };
      }
      return item;
    });
    return { ...current, items };
  });

  if (saving !== -1) {
    const item = updated.items[saving];
    await appendLog({
      level: item.status === BUNDLE_STATUS.OK ? 'info' : 'warn',
      message: item.status === BUNDLE_STATUS.OK
        ? `${item.parentSku}: bundle creado (${item.children.length} oferta(s))`
        : `${item.parentSku}: ${item.error}`,
    });
  }
  if (creating !== -1) {
    await appendLog({ level: 'error', message: `${updated.items[creating].parentSku}: creacion interrumpida` });
  }
  return updated;
}

/**
 * Marca como omitidos los SKU padre que ya tienen un package rule. Se hace una
 * sola vez y en el listado: son consultas AJAX del grid, sin navegar.
 */
async function checkExistingRules(initialRun, signal) {
  let run = initialRun;
  if (!run.config?.skipExisting) return run;
  if (!run.items.some((item) => item.status === BUNDLE_STATUS.PENDING && !item.checkedExisting)) return run;

  run = await updateRun((current) => ({ ...current, phase: RUN_PHASE.CHECKING }));
  await appendLog({ level: 'info', message: 'Revisando cuales SKU ya tienen package rule...' });

  for (let index = 0; index < run.items.length; index += 1) {
    const item = run.items[index];
    if (item.status !== BUNDLE_STATUS.PENDING || item.checkedExisting) continue;

    let result = { found: false, id: '' };
    let failure = '';
    try {
      result = await findExistingRule(item.parentSku, { signal });
    } catch (err) {
      if (isAbortError(err, signal)) throw err;
      failure = toMessage(err);
    }

    run = await updateRun((current) => ({
      ...current,
      items: current.items.map((candidate, position) => (position === index
        ? {
          ...candidate,
          checkedExisting: true,
          status: result.found ? BUNDLE_STATUS.SKIPPED : candidate.status,
          skipReason: result.found ? SKIP_REASON.ALREADY_EXISTS : candidate.skipReason,
          error: result.found ? `Ya existe el package rule ${result.id}` : candidate.error,
        }
        : candidate)),
    }));
    if (!run?.active) return run;

    if (failure) {
      await appendLog({ level: 'warn', message: `No se pudo revisar ${item.parentSku} en el listado (${failure}); se crea igual.` });
    } else if (result.found) {
      await appendLog({ level: 'warn', message: `${item.parentSku}: ya existe el package rule ${result.id}, se omite.` });
    }
  }

  await clearFilters({ signal }).catch(() => { /* el listado queda filtrado, no es fatal */ });
  const skipped = run.items.filter((item) => item.status === BUNDLE_STATUS.SKIPPED).length;
  await appendLog({
    level: 'info',
    message: skipped ? `${skipped} bundle(s) ya existian y se omiten` : 'Ningun SKU tenia package rule previo',
  });
  return getRun();
}

/** Toma el proximo bundle pendiente y entra a "Add New Package". Si no queda, cierra. */
async function startNextBundle(run, signal) {
  const nextIndex = run.items.findIndex((item) => item.status === BUNDLE_STATUS.PENDING);
  if (nextIndex === -1) {
    await finalize(FINISH_REASON.DONE);
    return;
  }

  const item = run.items[nextIndex];
  const updated = await updateRun((current) => ({
    ...current,
    phase: RUN_PHASE.CREATING,
    currentIndex: nextIndex,
    redirects: 0,
    items: current.items.map((candidate, index) => (index === nextIndex
      ? { ...candidate, status: BUNDLE_STATUS.CREATING, error: '' }
      : candidate)),
  }));
  if (!updated?.active) return;

  await appendLog({
    level: 'info',
    message: `${item.parentSku}: creando bundle (${nextIndex + 1}/${run.items.length})`,
  });
  markNavigating();
  await clickAddPackage({ signal });
}

// -----------------------------------------------------------------------------
// formulario del padre
// -----------------------------------------------------------------------------

async function onNew(run, page, signal) {
  const index = findCreatingIndex(run);
  if (index === -1) {
    await bounceToListing(run, 'formulario nuevo sin bundle en curso');
    return;
  }
  const item = run.items[index];

  try {
    await fillParentForm({
      parentSku: item.parentSku,
      config: run.config,
      signal,
      onStep: (step) => log.debug('paso del formulario', { step, sku: item.parentSku }),
      onInfo: (message) => appendLog({ level: 'info', message }).catch(() => { /* run cerrado */ }),
    });
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    await failBundle(index, toMessage(err));
    goTo(run.listingUrl);
    return;
  }

  const fresh = await getRun();
  if (!fresh?.active) return;

  if (fresh.config?.dryRun) {
    await updateRun((current) => ({
      ...current,
      items: current.items.map((candidate, position) => (position === index
        ? { ...candidate, status: BUNDLE_STATUS.SIMULATED, error: '' }
        : candidate)),
    }));
    await appendLog({
      level: 'info',
      message: `${item.parentSku}: formulario completo (simulacion, no se guarda). ${item.children.length} oferta(s) quedan sin verificar.`,
    });
    goTo(fresh.listingUrl);
    return;
  }

  await appendLog({ level: 'debug', message: `${item.parentSku}: guardando el package rule` });
  markNavigating();
  clickSaveAndContinue();
}

// -----------------------------------------------------------------------------
// pantalla de edicion: las ofertas
// -----------------------------------------------------------------------------

async function onEdit(run, page, signal) {
  const index = findCreatingIndex(run, page.packageId);
  if (index === -1) {
    await bounceToListing(run, `pantalla de edicion ${page.packageId} sin bundle en curso`);
    return;
  }

  let current = await updateRun((state) => ({
    ...state,
    redirects: 0,
    items: state.items.map((candidate, position) => (position === index
      ? { ...candidate, packageId: page.packageId, editUrl: page.url }
      : candidate)),
  }));
  if (!current?.active) return;

  const item = current.items[index];
  if (hasSuccess(TEXTS.RULE_SAVED)) {
    await appendLog({ level: 'info', message: `${item.parentSku}: package rule ${page.packageId} guardado` });
  }

  // Ofertas que ya figuran en la grilla (una recarga a mitad de camino no tiene
  // por que repetirlas: se crearian dos veces).
  const existing = readOfferSkus();
  if (existing.length) {
    current = await updateRun((state) => ({
      ...state,
      items: state.items.map((candidate, position) => (position === index
        ? {
          ...candidate,
          children: candidate.children.map((child) => (child.status === CHILD_STATUS.PENDING
            && existing.some((sku) => sameSku(sku, child.sku))
            ? { ...child, status: CHILD_STATUS.OK }
            : child)),
        }
        : candidate)),
    }));
    if (!current?.active) return;
  }

  const children = current.items[index].children;
  for (let position = 0; position < children.length; position += 1) {
    if (children[position].status !== CHILD_STATUS.PENDING) continue;
    const child = children[position];

    let outcome = null;
    let failure = '';
    try {
      outcome = await createOffer({
        child,
        config: current.config,
        dryRun: false,
        signal,
        onStep: (step) => log.debug('paso de la oferta', { step, sku: child.sku }),
        onInfo: (message) => appendLog({ level: 'info', message }).catch(() => { /* run cerrado */ }),
      });
    } catch (err) {
      if (isAbortError(err, signal)) throw err;
      failure = toMessage(err);
      await closeOfferModal(findOfferModal(), signal);
    }

    current = await updateRun((state) => ({
      ...state,
      items: state.items.map((candidate, itemIndex) => (itemIndex === index
        ? {
          ...candidate,
          children: candidate.children.map((candidateChild, childIndex) => (childIndex === position
            ? {
              ...candidateChild,
              status: failure ? CHILD_STATUS.ERROR : CHILD_STATUS.OK,
              error: failure,
              chosenSku: outcome?.chosenSku || candidateChild.chosenSku || '',
            }
            : candidateChild)),
        }
        : candidate)),
    }));
    if (!current?.active) return;

    await appendLog({
      level: failure ? 'error' : 'info',
      message: failure
        ? `${item.parentSku} / ${child.sku}: ${failure}`
        : `${item.parentSku} / ${outcome.chosenSku}: oferta creada`,
    });
  }

  const finished = (await getRun());
  if (!finished?.active) return;

  const failed = finished.items[index].children.filter((child) => child.status === CHILD_STATUS.ERROR).length;
  await appendLog({
    level: failed ? 'warn' : 'debug',
    message: failed
      ? `${item.parentSku}: ${failed} oferta(s) con error; se guarda el bundle igual`
      : `${item.parentSku}: guardando el bundle`,
  });

  await updateRun((state) => ({
    ...state,
    items: state.items.map((candidate, position) => (position === index
      ? { ...candidate, status: BUNDLE_STATUS.SAVING }
      : candidate)),
  }));
  markNavigating();
  clickSave();
}

// -----------------------------------------------------------------------------
// utilidades
// -----------------------------------------------------------------------------

/**
 * Casa la pantalla abierta con el bundle en curso. Solo puede haber uno en
 * CREATING, asi que el package_id sirve de confirmacion, no de llave.
 */
export function findCreatingIndex(run, packageId = '') {
  const items = run?.items || [];
  if (packageId) {
    const byId = items.findIndex((item) =>
      item.status === BUNDLE_STATUS.CREATING && String(item.packageId) === String(packageId));
    if (byId !== -1) return byId;
  }
  return items.findIndex((item) => item.status === BUNDLE_STATUS.CREATING);
}

/** Vuelve al listado cuando la pantalla no se puede asociar a ningun bundle. */
async function bounceToListing(run, reason) {
  const redirects = (run.redirects || 0) + 1;
  log.warn('pantalla sin bundle en curso', { reason, redirects });
  if (redirects >= MAX_REDIRECTS) {
    await stopWithError(`No se pudo asociar la pantalla con ningun bundle despues de ${redirects} intentos (${reason}).`);
    return;
  }
  await updateRun((current) => ({ ...current, redirects }));
  goTo(run.listingUrl);
}

async function failBundle(index, message) {
  await updateRun((current) => ({
    ...current,
    items: current.items.map((item, position) => (position === index
      ? { ...item, status: BUNDLE_STATUS.ERROR, error: message }
      : item)),
  }));
  const run = await getRun();
  await appendLog({ level: 'error', message: `${run?.items?.[index]?.parentSku || 'bundle'}: ${message}` });
}

async function finalize(reason, message) {
  const run = await updateRun((current) => ({
    ...current,
    active: false,
    phase: RUN_PHASE.DONE,
    finishedAt: Date.now(),
    finishReason: reason,
  }));

  const items = run?.items || [];
  const ok = items.filter((item) => item.status === BUNDLE_STATUS.OK).length;
  const partial = items.filter((item) => item.status === BUNDLE_STATUS.PARTIAL).length;
  const errors = items.filter((item) => item.status === BUNDLE_STATUS.ERROR).length;
  const skipped = items.filter((item) => item.status === BUNDLE_STATUS.SKIPPED).length;
  const simulated = items.filter((item) => item.status === BUNDLE_STATUS.SIMULATED).length;

  await appendLog({
    level: errors || partial ? 'warn' : 'info',
    message: message || (simulated
      ? `Simulacion terminada: ${simulated} bundle(s) verificados, ${errors} con error, ${skipped} omitidos`
      : `Proceso terminado: ${ok} bundle(s) creados, ${partial} parciales, ${errors} con error, ${skipped} omitidos`),
  });
}

async function stopWithError(message) {
  try {
    const run = await getRun();
    if (!run?.active) return;
    await updateRun((current) => ({
      ...current,
      active: false,
      finishedAt: Date.now(),
      finishReason: FINISH_REASON.ERROR,
      error: message,
    }));
    await appendLog({ level: 'error', message: `Proceso detenido: ${message}` });
  } catch (storageError) {
    log.error('no se pudo guardar el error del run', storageError);
  }
}
