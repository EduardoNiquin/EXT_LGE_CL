import { cmd, register } from '../../shared/debug/index.js';
import { FINISH_REASON } from './constants.js';
import { clearRun, getRun, updateRun } from './state.js';
import { diagnose } from './content/detector.js';
import { parseDetailFields, parseListingRows, parseRegionalRows } from './content/parser.js';
import { expandDetailSections } from './content/magento/detail-page.js';
import { tickIfActive } from './content/flows/run.js';

register('magento', {
  diagnose: cmd(() => diagnose(), 'Diagnostico de Global Shipping Rules'),
  listing: cmd(() => parseListingRows(), 'Lee las rules visibles del listado'),
  detail: cmd(() => ({ fields: parseDetailFields(), regionalRows: parseRegionalRows() }), 'Lee el detalle visible'),
  expand: cmd(() => expandDetailSections(), 'Abre las secciones colapsadas del detalle'),
  state: cmd(() => getRun(), 'Estado persistido del proceso'),
  stop: cmd(() => updateRun((run) => ({
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: FINISH_REASON.CANCELLED,
  })), 'Detiene el proceso'),
  reset: cmd(async () => { await clearRun(); return true; }, 'Limpia el proceso'),
  tick: cmd(() => tickIfActive(), 'Fuerza un tick del proceso'),
});
