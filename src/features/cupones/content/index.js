import { logger } from '../../../shared/utils/logger.js';
import { STORAGE_KEYS } from '../constants.js';
import { tickIfActive } from './flows/run.js';

const log = logger('cupones/content');

export function init() {
  if (window !== window.top) {
    log.debug('iframe — no se inicializa state machine en este frame');
    return;
  }
  log.info('cupones init', { url: location.href });

  // Tick inicial al cargar. Delay corto para dar tiempo al grid legacy de
  // Magento a montar las filas antes del primer check.
  setTimeout(() => { tickIfActive().catch(() => { /* logged inside */ }); }, 300);

  // Reaccionar a cambios del run en storage (start/stop desde el popup).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes[STORAGE_KEYS.RUN]) return;
    tickIfActive().catch(() => { /* logged inside */ });
  });
}
