import { cmd, register } from '../../shared/debug/index.js';
import { SELECTORS } from './constants.js';
import { detectPage, diagnose } from './content/detector.js';
import { parseOrder } from './content/parser.js';
import { clearSearch, getSearch } from './state.js';
import { tickIfActive } from './content/flows/search.js';

register('ordenInfo', {
  diagnose: cmd(
    () => diagnose(),
    'Diagnóstico de detección de página y selectores',
  ),
  page: cmd(
    () => detectPage(),
    'Detecta si la página es order-view / listing / other',
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
  parse: cmd(
    () => parseOrder(),
    'Parsea la orden actual (grupos + alerts + transacciones decodificadas)',
  ),
  search: cmd(
    () => getSearch(),
    'Estado persistido de la búsqueda actual',
  ),
  reset: cmd(
    async () => { await clearSearch(); return 'ok'; },
    'Borra el estado de la búsqueda de storage',
  ),
  tick: cmd(
    () => tickIfActive(),
    'Fuerza un tick del flujo de búsqueda en este frame',
  ),
});
