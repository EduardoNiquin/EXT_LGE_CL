// Export del listado completo de package rules a CSV (padre -> hijo).
//
// Trabajo aparte del de creacion: es SOLO LECTURA y NO navega. Magento ya
// publica los hijos en la columna "Related Product" del propio listado, asi
// que alcanza con recorrer sus paginas — no hace falta entrar a ninguna regla,
// que es lo unico caro (una carga de pagina por cada una).
//
// Como no navega, todo el recorrido cabe en un solo tick. Igual el estado vive
// en storage: asi el resultado sobrevive a cerrar el popup, y si una recarga
// corta el recorrido a la mitad se ve por que se quedo.

import { isAbortError, toMessage } from '../../../../../shared/errors/index.js';
import { logger } from '../../../../../shared/utils/logger.js';
import {
  EXPORT_PHASE,
  FINISH_REASON,
  PAGE_TYPE,
  WEBSITE_LABEL,
} from '../../constants.js';
import { appendExportLog, getExport, getRun, updateExport } from '../../state.js';
import { buildExistingMatrix, matrixToCsv } from '../../csv.js';
import { detectPage } from '../detector.js';
import { collectAllBundles, ensureWebsite, waitForGridReady } from '../magento/listing.js';

const log = logger('magento/softbundles');

let running = false;
let activeController = null;

export function abortActiveExport() {
  activeController?.abort();
}

export async function exportTick() {
  if (running || window !== window.top) return;
  const current = await getExport();
  if (!current?.active) return;

  running = true;
  const controller = new AbortController();
  activeController = controller;
  try {
    await runExport(controller.signal);
  } catch (err) {
    if (isAbortError(err, controller.signal)) {
      log.info('export detenido');
      await finishExport(FINISH_REASON.CANCELLED, 'Export detenido.');
    } else {
      log.error('export fallo', err);
      await finishExport(FINISH_REASON.ERROR, toMessage(err));
    }
  } finally {
    if (activeController === controller) activeController = null;
    running = false;
  }
}

async function runExport(signal) {
  // Los dos trabajos viven en el mismo listado y se pisarian los filtros y el
  // paginador. La creacion manda: es la que puede quedar a medio camino.
  const creation = await getRun();
  if (creation?.active) {
    await finishExport(FINISH_REASON.ERROR, 'Hay una creacion de bundles en curso. Espera a que termine o detenla antes de leer el listado.');
    return;
  }

  const page = detectPage();
  if (page.type !== PAGE_TYPE.LISTING) {
    await finishExport(FINISH_REASON.ERROR, 'Abri el listado de Package Rule en esta pestana y volve a intentarlo.');
    return;
  }

  await waitForGridReady({ signal }).catch(() => { /* lo decide el website */ });

  // Sin website elegido el listado dice "0 records found" aunque haya miles de
  // reglas: exportar ahi devolveria un CSV vacio que parece un dato real.
  const website = await ensureWebsite(WEBSITE_LABEL, { signal });
  if (website.missing) {
    await finishExport(FINISH_REASON.ERROR, `No se pudo seleccionar el website "${WEBSITE_LABEL}" en el listado.`);
    return;
  }
  if (website.navigating) {
    // El cambio de scope recarga la pagina; el tick de la carga nueva sigue.
    await appendExportLog({ level: 'info', message: `Cambiando el website a "${WEBSITE_LABEL}"...` });
    return;
  }

  await updateExport((state) => ({ ...state, phase: EXPORT_PHASE.READING }));

  const rules = await collectAllBundles({
    signal,
    onWarn: (message) => appendExportLog({ level: 'warn', message }).catch(() => { /* export cerrado */ }),
    onProgress: ({ page: pageNumber, rules: count, total }) => {
      updateExport((state) => ({ ...state, pages: pageNumber, rules: count, total })).catch(() => { /* export cerrado */ });
    },
  });

  const matrix = buildExistingMatrix(rules);
  const withChildren = rules.filter((rule) => rule.relatedProducts.length).length;

  await updateExport((state) => ({
    ...state,
    active: false,
    phase: EXPORT_PHASE.DONE,
    finishedAt: Date.now(),
    finishReason: FINISH_REASON.DONE,
    rules: rules.length,
    rows: matrix.rows.length,
    csv: matrixToCsv(matrix),
  }));
  await appendExportLog({
    level: 'info',
    message: `${rules.length} package rule(s) leidas (${withChildren} con ofertas): ${matrix.rows.length} fila(s) padre-hijo.`,
  });
}

async function finishExport(reason, message) {
  const state = await getExport();
  if (!state?.active) return;
  await updateExport((current) => ({
    ...current,
    active: false,
    phase: EXPORT_PHASE.DONE,
    finishedAt: Date.now(),
    finishReason: reason,
    error: reason === FINISH_REASON.ERROR ? message : '',
  }));
  await appendExportLog({ level: reason === FINISH_REASON.ERROR ? 'error' : 'warn', message });
}
