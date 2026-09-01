import { cmd, register } from '../../shared/debug/index.js';
// El apartado es un paraguas: este import registra tambien los comandos de sus
// modulos (`__extLgeCl.magentoBuscarOrden.*`).
import './buscar-orden/debug.js';
import { BRIDGE, FINISH_REASON, REGIONAL_PAGE_SIZE } from './constants.js';
import { clearRun, getRun, updateRun } from './state.js';
import { diagnose } from './content/detector.js';
import { parseDetailFields, parseListingRows, parseRegionalRows } from './content/parser.js';
import { askBridge } from './content/bridge-client.js';
import { expandDetailSections } from './content/magento/detail-page.js';
import { loadAllRegionalRows } from './content/magento/grid.js';
import { tickIfActive } from './content/flows/run.js';

register('magento', {
  diagnose: cmd(() => diagnose(), 'Diagnostico de Global Shipping Rules'),
  listing: cmd(() => parseListingRows(), 'Lee las rules visibles del listado'),
  detail: cmd(() => ({ fields: parseDetailFields(), regionalRows: parseRegionalRows() }), 'Lee el detalle visible'),
  expand: cmd(() => expandDetailSections(), 'Abre las secciones colapsadas del detalle'),
  // Radiografia del uiRegistry de Magento: dice si las tarifas ya estan en la
  // pagina, con que nombre y contra que endpoint las pide. Es la inspeccion que
  // hace falta para decidir si conviene pedir los detalles por HTTP directo.
  probe: cmd(() => askBridge(BRIDGE.OPS.PROBE), 'Radiografia de los UI components de Magento (bridge MAIN)'),
  expandRegional: cmd(
    () => askBridge(BRIDGE.OPS.EXPAND_REGIONAL, { size: REGIONAL_PAGE_SIZE }),
    'Pide todas las tarifas regionales de una via bridge',
  ),
  regional: cmd(
    async () => {
      let info = null;
      await loadAllRegionalRows({ onInfo: (value) => { info = value; } });
      return { info, rows: parseRegionalRows().length };
    },
    'Deja la grilla regional en una sola pagina (bridge, tamano de pagina o paginador)',
  ),
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
