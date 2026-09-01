import { logger } from '../../../../shared/utils/logger.js';
import { wireReloadTickLifecycle } from '../../../../shared/run-store/index.js';
import { STORAGE_KEYS } from '../constants.js';
import { abortActiveRun, tickIfActive } from './flows/run.js';

const log = logger('magento/buscar-orden');

export function init() {
  wireReloadTickLifecycle({
    runKey: STORAGE_KEYS.RUN,
    tickIfActive,
    abortActiveRun,
    delay: 600,
    log,
  });
}
