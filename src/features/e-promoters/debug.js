// Comandos de debug de "E-promoters" → window.__extLgeCl.epromoters.*
// Se registran en el contexto del service worker (donde corre el proceso).

import { register, cmd } from '../../shared/debug/index.js';
import { clearResult, clearRun, getResult, getRun } from './state.js';
import { runInforme, cancelInforme } from './background/informe.js';
import { processReport } from './shared/report.js';
import { SOURCE } from './constants.js';

register('epromoters', {
  run: cmd(
    ({ from, to } = {}) => runInforme({ source: SOURCE.API, from, to }),
    'Corre el informe desde la API: run({from:"2026-06-01", to:"2026-06-20"})',
  ),
  runCsv: cmd(
    ({ text, from, to } = {}) => runInforme({ source: SOURCE.CSV, text, from, to }),
    'Corre el informe desde un CSV: runCsv({text, from, to})',
  ),
  process: cmd(
    ({ records, from, to } = {}) => processReport(records || [], { from, to }),
    'Aplica el pipeline a un array de registros (puro, sin descargar)',
  ),
  cancel: cmd(() => cancelInforme(), 'Cancela la corrida en curso'),
  state: cmd(() => getRun(), 'Devuelve el estado de la corrida actual'),
  result: cmd(async () => {
    const r = await getResult();
    return r ? { filename: r.filename, bytes: r.csv?.length || 0 } : null;
  }, 'Metadata del ultimo CSV generado'),
  reset: cmd(async () => { await clearRun(); await clearResult(); return true; }, 'Limpia el estado y el resultado'),
});
