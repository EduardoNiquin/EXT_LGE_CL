import { logger } from '../../../shared/utils/logger.js';
import { STORAGE_KEYS } from '../constants.js';
import { tickIfActive } from './flows/run.js';

const log = logger('lead-times/content');

export function init() {
  if (window !== window.top) {
    log.debug('iframe — no se inicializa state machine en este frame');
    return;
  }
  log.info('lead-times init', { url: location.href });

  // Tick inicial al cargar la página.
  // Pequeño delay para dejar que Magento monte el grid antes del primer check.
  setTimeout(() => { tickIfActive().catch(() => { /* logged inside */ }); }, 300);

  // Reaccionar a cambios en el storage (cuando el popup dispara o detiene un run).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes[STORAGE_KEYS.RUN]) return;
    tickIfActive().catch(() => { /* logged inside */ });
  });
}
