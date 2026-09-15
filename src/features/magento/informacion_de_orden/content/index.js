// Arranque del modulo "Informacion de Orden" en el content script.
//
// Ciclo de vida async (no tick-por-reload): la captura va por fetch y no navega,
// asi que el flujo corre entero en un documento. Solo el top frame coordina.

import { logger } from '../../../../shared/utils/logger.js';
import { subscribeToRun } from '../state.js';
import { wireAsyncRunLifecycle } from '../../../../shared/run-store/index.js';
import { abortActiveRun, reconcileOnInit, tickIfActive } from './flows/run.js';

const log = logger('magento/informacion-de-orden');

export function init() {
  wireAsyncRunLifecycle({
    subscribeToRun,
    tickIfActive,
    abortActiveRun,
    reconcileOnInit,
    topFrameOnly: true,
    log,
  });
}
