import { install } from '../shared/debug/index.js';
import { logger } from '../shared/utils/logger.js';
import * as colocarTags from '../features/colocar-tags/content/index.js';
import * as leadTimes   from '../features/lead-times/content/index.js';

// Importar el debug.js de cada feature auto-registra sus comandos.
// Para sumar una nueva feature: crear src/features/<feature>/debug.js
// y agregar el import acá.
import '../features/colocar-tags/debug.js';
import '../features/lead-times/debug.js';

const log = logger('content');
const version = chrome?.runtime?.getManifest?.()?.version;

install({ version, context: 'content' });
colocarTags.init();
leadTimes.init();

log.info('content script cargado', {
  url: location.href,
  isTopFrame: window === window.top,
});
