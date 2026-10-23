import { cmd, register } from '../../shared/debug/index.js';
import { BRIDGE, SELECTORS } from './constants.js';
import { diagnose, isPromotionPage } from './content/detector.js';
import { askBridge } from './content/bridge-client.js';
import { parseSkuText } from './parse-input.js';
import { resolveSkus } from './resolve.js';
import { clearRun, getDraft, getRun } from './state.js';

register('crearPromoId', {
  diagnose:  cmd(() => diagnose(), 'Deteccion de Promotion Management en este frame'),
  detected:  cmd(() => isPromotionPage(), 'True si este frame es Promotion Management'),
  selectors: cmd(() => ({ ...SELECTORS }), 'Selectores que usa la feature'),
  bridge:    cmd(() => askBridge(BRIDGE.OPS.STATE), 'Estado del bridge MAIN (RUI, hook, formulario abierto, filas)'),
  catalog:   cmd(async () => {
    const { rows } = await askBridge(BRIDGE.OPS.CATALOG, { bizType: 'B2C' });
    return { rows: rows.length, models: new Set(rows.map((r) => r.modelId)).size };
  }, 'Baja el catalogo de modelos B2C (solo lectura)'),
  resolve:   cmd(async (text) => {
    const { rows } = await askBridge(BRIDGE.OPS.CATALOG, { bizType: 'B2C' });
    return resolveSkus(parseSkuText(text).skus, rows);
  }, 'Resuelve una lista de SKUs (texto, uno por linea) contra el catalogo'),
  list:      cmd((from, to, title = '') => askBridge(BRIDGE.OPS.LIST, { from, to, title }), 'Listado STG por fechas (YYYY-MM-DD) y titulo'),
  state:     cmd(() => getRun(), 'Corrida guardada en storage'),
  draft:     cmd(() => getDraft(), 'Borrador del popup'),
  reset:     cmd(async () => { await clearRun(); return 'ok'; }, 'Borra la corrida de storage'),
});
