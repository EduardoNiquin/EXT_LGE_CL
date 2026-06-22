import { logger } from '../../../shared/utils/logger.js';
import { STORAGE_KEYS } from '../constants.js';
import { tickIfActive } from './flows/run.js';
import { wireReloadTickLifecycle } from '../../../shared/run-store/index.js';

const log = logger('lead-times/content');

export function init() {
  log.info('lead-times init', { url: location.href });
  // Tick-por-reload: tick inicial (delay para que monte el grid) + tick en cada
  // cambio del run en storage. Sólo top frame. Ver shared/run-store.
  wireReloadTickLifecycle({ runKey: STORAGE_KEYS.RUN, tickIfActive, log });
}
