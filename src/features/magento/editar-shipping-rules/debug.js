import { cmd, register } from '../../../shared/debug/index.js';
import { BRIDGE } from '../constants.js';
import { askBridge } from '../content/bridge-client.js';
import { FINISH_REASON, FORM_NAMESPACE } from './constants.js';
import { fetchAllRules } from './content/catalog-fetch.js';
import { diagnose } from './content/detector.js';
import { tickIfActive } from './content/flows/run.js';
import { clearRun, getCatalog, getHistory, getRun, updateRun } from './state.js';

register('magentoEditarShippingRules', {
  diagnose: cmd(() => diagnose(), 'Pantalla actual, mensajes de Magento y boton Save'),
  // Solo lectura: no pasa `set`, asi que el bridge no toca el campo.
  field: cmd(
    () => askBridge(BRIDGE.OPS.SHIPPING_RULE_ACTIVE, { namespace: FORM_NAMESPACE }),
    'Lee "Active this shipping rule" del formulario abierto (sin cambiarlo)',
  ),
  rules: cmd(async () => {
    const { rules, totalRecords } = await fetchAllRules();
    return { totalRecords, loaded: rules.length, active: rules.filter((rule) => rule.isActive).length };
  }, 'Lee todas las rules por el endpoint del grid (solo lectura)'),
  catalog: cmd(() => getCatalog(), 'Catalogo guardado para el popup'),
  history: cmd(() => getHistory(), 'Corridas terminadas (antes/despues de cada rule)'),
  state: cmd(() => getRun(), 'Estado persistido de la corrida'),
  stop: cmd(() => updateRun((run) => ({
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: FINISH_REASON.CANCELLED,
  })), 'Detiene la corrida'),
  reset: cmd(async () => { await clearRun(); return true; }, 'Limpia la corrida'),
  tick: cmd(() => tickIfActive(), 'Fuerza un tick'),
});
