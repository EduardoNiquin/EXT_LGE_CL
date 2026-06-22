import { install } from '../shared/debug/index.js';
import { installGlobalErrorCapture } from '../shared/diagnostics/index.js';
import { logger } from '../shared/utils/logger.js';
import { onMessage } from '../shared/messaging/messaging.js';

const log = logger('service-worker');
const version = chrome?.runtime?.getManifest?.()?.version;

install({ version, context: 'service-worker' });
installGlobalErrorCapture('service-worker');

chrome.runtime.onInstalled.addListener((details) => {
  log.info('Extensión instalada/actualizada', { reason: details?.reason, version });
});

onMessage((message) => {
  log.debug('mensaje recibido', message);
});
