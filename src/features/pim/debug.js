import { cmd, register } from '../../shared/debug/index.js';
import { SELECTORS } from './constants.js';
import { diagnose, isPimPage } from './content/detector.js';
import { resolveResult } from './content/parser.js';
import { searchSku } from './content/flows/search.js';
import { tickIfActive } from './content/flows/run.js';
import { clearRun, getDraft, getRun, setRun } from './state.js';

register('pim', {
  diagnose:  cmd(() => diagnose(), 'Diagnóstico de detección de la pantalla PIM y selectores'),
  detected:  cmd(() => isPimPage(), 'True si este frame tiene el buscador de PIM'),
  selectors: cmd(() => ({ ...SELECTORS }), 'Mapa de selectores que usa la feature'),
  result:    cmd((sku) => resolveResult(sku), 'Resultado actual de la grilla para un SKU: found/not-found/pending'),
  state:     cmd(() => getRun(), 'Estado persistido del run actual'),
  draft:     cmd(() => getDraft(), 'Borrador del formulario del popup'),

  check: cmd((sku) => searchSku(sku, {}), 'Verifica UN SKU end-to-end en STG → true si existe'),

  stop: cmd(async () => {
    const r = await getRun();
    if (!r) return null;
    r.active = false;
    r.finishReason = 'cancelled-manual';
    await setRun(r);
    return r;
  }, 'Marca el run como inactivo'),
  reset: cmd(async () => { await clearRun(); return 'ok'; }, 'Borra el estado del run de storage'),
  tick:  cmd(() => tickIfActive(), 'Fuerza un tick del runner en este frame'),
});
