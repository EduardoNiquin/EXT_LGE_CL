import { logger } from '../../../../shared/utils/logger.js';
import { wireReloadTickLifecycle } from '../../../../shared/run-store/index.js';
import { STORAGE_KEYS } from '../constants.js';
import { abortActiveRun, tickIfActive } from './flows/run.js';

const log = logger('magento/softbundles');

export function init() {
  wireReloadTickLifecycle({
    runKey: STORAGE_KEYS.RUN,
    tickIfActive,
    abortActiveRun,
    // El formulario del package rule monta sus campos Knockout despues del
    // load; los lectores esperan sus propios selectores, pero arrancar de
    // inmediato solo gasta reintentos.
    delay: 600,
    log,
  });
}
