import { logger } from '../../../shared/utils/logger.js';
import { STORAGE_KEYS } from '../constants.js';
import { tickIfActive } from './flows/run.js';
import { wireReloadTickLifecycle } from '../../../shared/run-store/index.js';

const log = logger('cupones/content');

export function init() {
  log.info('cupones init', { url: location.href });
  // Tick-por-reload: tick inicial (delay para el grid legacy de Magento) + tick
  // en cada cambio del run en storage. Sólo top frame. Ver shared/run-store.
  wireReloadTickLifecycle({ runKey: STORAGE_KEYS.RUN, tickIfActive, log });
}
