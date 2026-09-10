// Arranque del apartado Magento en el content script. Es un paraguas: cada
// modulo (Global Shipping Rules, Buscar orden, Crear Softbundles) tiene su propio run en storage y
// su propia state machine, y aca se enganchan todos con una sola llamada desde
// `src/content/index.js`.

import { logger } from '../../../shared/utils/logger.js';
import { wireReloadTickLifecycle } from '../../../shared/run-store/index.js';
import { STORAGE_KEYS } from '../constants.js';
import { init as initBuscarOrden } from '../buscar-orden/content/index.js';
import { init as initSoftbundles } from '../softbundles/content/index.js';
import { abortActiveRun, tickIfActive } from './flows/run.js';

const log = logger('magento/content');

export function init() {
  log.info('magento init', { url: location.href });
  wireReloadTickLifecycle({
    runKey: STORAGE_KEYS.RUN,
    tickIfActive,
    abortActiveRun,
    delay: 0,
    log,
  });
  initBuscarOrden();
  initSoftbundles();
}
