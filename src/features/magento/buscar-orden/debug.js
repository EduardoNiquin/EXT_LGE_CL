import { cmd, register } from '../../../shared/debug/index.js';
import { FINISH_REASON } from './constants.js';
import { buildMatrix } from './csv.js';
import { buildCriteria, describeCriteria, evaluateOrder } from './match.js';
import { clearRun, getDraft, getRun, updateRun } from './state.js';
import { diagnose } from './content/detector.js';
import { parseOrderRows, parseOrderTransactions } from './content/parser.js';
import { readRecordsFound } from './content/grid.js';
import { gridDateRange, tickIfActive } from './content/flows/run.js';

register('magentoBuscarOrden', {
  diagnose: cmd(() => diagnose(), 'Diagnostico de la pagina actual (listado o detalle)'),
  rows: cmd(() => parseOrderRows(), 'Ordenes visibles del listado'),
  records: cmd(() => readRecordsFound(), 'Cantidad de ordenes que reporta el grid'),
  transactions: cmd(() => parseOrderTransactions(), 'Transacciones de la orden abierta'),
  evaluate: cmd(async () => {
    const run = await getRun();
    const criteria = buildCriteria(run?.config || (await getDraft()) || {});
    return { criteria: describeCriteria(criteria), ...evaluateOrder(parseOrderTransactions(), criteria) };
  }, 'Evalua la orden abierta contra los criterios guardados'),
  dates: cmd(async () => gridDateRange((await getRun())?.config || (await getDraft()) || {}), 'Rango en el formato del datepicker'),
  csv: cmd(async (onlyMatches = true) => buildMatrix(await getRun(), { onlyMatches }), 'Matriz del CSV (headers + filas)'),
  state: cmd(() => getRun(), 'Estado persistido de la busqueda'),
  draft: cmd(() => getDraft(), 'Ultimo formulario guardado'),
  stop: cmd(() => updateRun((run) => ({
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: FINISH_REASON.CANCELLED,
  })), 'Detiene la busqueda'),
  reset: cmd(async () => { await clearRun(); return true; }, 'Limpia la busqueda'),
  tick: cmd(() => tickIfActive(), 'Fuerza un tick de la busqueda'),
});
