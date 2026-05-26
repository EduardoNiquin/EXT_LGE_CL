import { cmd, register } from '../../shared/debug/index.js';
import { SELECTORS } from './constants.js';
import { detectPage, diagnose } from './content/detector.js';
import { parseListingRows, getActiveFilters, getRecordsFound, getTotalPages } from './content/parser.js';
import { clearRun, getRun, setRun } from './state.js';
import { tickIfActive } from './content/flows/run.js';

register('leadTimes', {
  diagnose: cmd(
    () => diagnose(),
    'Diagnóstico de detección de página y selectores',
  ),
  page: cmd(
    () => detectPage(),
    'Detecta si la página actual es listing/edit/other',
  ),
  selectors: cmd(
    () => ({ ...SELECTORS }),
    'Mapa de selectores que usa la feature',
  ),
  check: cmd(
    () => Object.fromEntries(
      Object.entries(SELECTORS).map(([k, sel]) => [k, Boolean(document.querySelector(sel))]),
    ),
    'true/false por cada selector contra el DOM actual',
  ),
  parseRows: cmd(
    () => parseListingRows(),
    'Filas del grid (sólo válido en el listing)',
  ),
  filters: cmd(
    () => getActiveFilters(),
    'Filtros activos en el grid',
  ),
  records: cmd(
    () => ({ records: getRecordsFound(), pages: getTotalPages() }),
    'Totales del grid: { records, pages }',
  ),
  state: cmd(
    () => getRun(),
    'Estado persistido del run actual',
  ),
  stop: cmd(
    async () => {
      const r = await getRun();
      if (!r) return null;
      r.active = false;
      r.finishReason = 'cancelled-manual';
      await setRun(r);
      return r;
    },
    'Marca el run como inactivo (no detiene un tick en vuelo)',
  ),
  reset: cmd(
    async () => { await clearRun(); return 'ok'; },
    'Borra todo el estado del run de storage',
  ),
  tick: cmd(
    () => tickIfActive(),
    'Fuerza un tick del state machine en este frame',
  ),
});
