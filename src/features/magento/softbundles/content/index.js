import { logger } from '../../../../shared/utils/logger.js';
import { wireReloadTickLifecycle } from '../../../../shared/run-store/index.js';
import { STORAGE_KEYS } from '../constants.js';
import { abortActiveRun, tickIfActive } from './flows/run.js';
import { abortActiveExport, exportTick } from './flows/export.js';

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

  // El export del listado es un trabajo aparte (solo lectura, sin navegar) con
  // su propia clave en storage, asi que lleva su propio ciclo de vida. Arranca
  // antes que el otro porque no depende de que haya un formulario montado.
  wireReloadTickLifecycle({
    runKey: STORAGE_KEYS.EXPORT,
    tickIfActive: exportTick,
    abortActiveRun: abortActiveExport,
    delay: 300,
    log,
  });
}
