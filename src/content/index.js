import { install } from '../shared/debug/index.js';
import { logger } from '../shared/utils/logger.js';
import { installGlobalErrorCapture } from '../shared/diagnostics/index.js';
import * as colocarTags from '../features/colocar-tags/content/index.js';
import * as leadTimes   from '../features/lead-times/content/index.js';
import * as cupones     from '../features/cupones/content/index.js';
import * as ordenInfo   from '../features/orden-info/content/index.js';
import * as starkoms    from '../features/starkoms/content/index.js';
import * as lgcom       from '../features/lgcom/content/index.js';
import * as sellerCenterFalabella from '../features/seller-center-falabella/content/index.js';

// Importar el debug.js de cada feature auto-registra sus comandos.
// Para sumar una nueva feature: crear src/features/<feature>/debug.js
// y agregar el import acá.
import '../features/colocar-tags/debug.js';
import '../features/lead-times/debug.js';
import '../features/cupones/debug.js';
import '../features/orden-info/debug.js';
import '../features/starkoms/debug.js';
import '../features/lgcom/debug.js';
import '../features/seller-center-falabella/debug.js';

const log = logger('content');
const version = chrome?.runtime?.getManifest?.()?.version;

install({ version, context: 'content' });
installGlobalErrorCapture('content');
colocarTags.init();
leadTimes.init();
cupones.init();
ordenInfo.init();
starkoms.init();
lgcom.init();
sellerCenterFalabella.init();

log.info('content script cargado', {
  url: location.href,
  isTopFrame: window === window.top,
});
